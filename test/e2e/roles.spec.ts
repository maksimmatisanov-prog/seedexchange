import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import pg from 'pg';

const acceptanceEnabled = process.env.PLAYWRIGHT_MUTATING_ACCEPTANCE === '1';
const databaseUrl = process.env.TEST_DATABASE_URL;
const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:4000';
const runId = randomUUID().replaceAll('-', '');
const password = 'Acceptance-only-password-2026!';
const passwordHash = '$2b$12$iQzAVZRdMnLVhv/exym3vu0xPp6FGBNW0yaP10TvjKgMx9ohZeFte';
const emails = {
  buyer: `acceptance-buyer-${runId}@example.test`,
  member: `acceptance-member-${runId}@example.test`,
  seller: `acceptance-seller-${runId}@example.test`,
  admin: `acceptance-admin-${runId}@example.test`,
};

let database: pg.Pool;
let organizationId: string;
let productId: string;
let productSlug: string;
let sellerUserId: string;
let adminUserId: string;

async function login(page: Page, email: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.locator('main')).toContainText(email);
}

test.describe('buyer, seller and administrator acceptance', () => {
  test.describe.configure({ mode: 'serial' });
  test.skip(!acceptanceEnabled, 'Set PLAYWRIGHT_MUTATING_ACCEPTANCE=1 for an isolated local test database.');

  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-1440', 'Role acceptance runs once; responsive behavior is covered by the public suite.');
  });

  test.beforeAll(async ({}, testInfo) => {
    if (testInfo.project.name !== 'desktop-1440') return;
    if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required for mutating acceptance tests.');
    const applicationUrl = new URL(baseUrl);
    const testDatabaseUrl = new URL(databaseUrl);
    const loopbackHosts = new Set(['127.0.0.1', 'localhost', '::1']);
    if (!loopbackHosts.has(applicationUrl.hostname) || !loopbackHosts.has(testDatabaseUrl.hostname)) {
      throw new Error('Mutating acceptance tests are restricted to a loopback application and database.');
    }
    if (!/(?:_test|_acceptance)$/.test(testDatabaseUrl.pathname.slice(1))) {
      throw new Error('The isolated database name must end in _test or _acceptance.');
    }
    if (process.env.DATABASE_URL !== databaseUrl) {
      throw new Error('DATABASE_URL and TEST_DATABASE_URL must identify the same isolated database.');
    }

    database = new pg.Pool({ connectionString: databaseUrl, max: 2 });
    const client = await database.connect();
    try {
      await client.query('BEGIN');
      const userIds = new Map<string, string>();
      for (const [role, email] of Object.entries(emails)) {
        const platformRole = role === 'admin' ? 'platform_admin' : role === 'seller' ? 'org_admin' : role === 'member' ? 'org_member' : 'buyer';
        const result = await client.query<{ id: string }>(`INSERT INTO users(email,email_verified_at,password_hash,role)
          VALUES($1,now(),$2,$3) RETURNING id`, [email, passwordHash, platformRole]);
        userIds.set(role, result.rows[0].id);
      }
      const organization = await client.query<{ id: string }>(`INSERT INTO organizations(type,name,slug,country,description,status,seller_status,marketplace_enabled,verified_at)
        VALUES('grower',$1,$2,'Poland','Acceptance organization used only by the isolated browser test suite.','approved','active',true,now()) RETURNING id`,
      [`Acceptance Grower ${runId}`, `acceptance-grower-${runId}`]);
      organizationId = organization.rows[0].id;
      await client.query(`INSERT INTO organization_members(organization_id,user_id,role) VALUES($1,$2,'member'),($1,$3,'admin')`,
        [organizationId, userIds.get('member'), userIds.get('seller')]);
      sellerUserId = userIds.get('seller')!;
      adminUserId = userIds.get('admin')!;
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });

  test.afterAll(async () => {
    if (!database) return;
    await database.query('DELETE FROM exchange_listings WHERE organization_id=$1', [organizationId]);
    await database.query('DELETE FROM seller_shipping_zones WHERE organization_id=$1', [organizationId]);
    await database.query('DELETE FROM products WHERE organization_id=$1', [organizationId]);
    await database.query('DELETE FROM organizations WHERE id=$1', [organizationId]);
    await database.query(`DELETE FROM audit_events WHERE actor_user_id IN
      (SELECT id FROM users WHERE email=ANY($1::text[]))`, [Object.values(emails)]);
    await database.query('DELETE FROM users WHERE email=ANY($1::text[])', [Object.values(emails)]);
    await database.end();
  });

  test('buyer can use account but cannot enter seller or admin workspaces', async ({ page }) => {
    await login(page, emails.buyer);
    expect((await page.goto(`/seller/organization/${organizationId}`))?.status()).toBe(403);
    expect((await page.goto('/admin'))?.status()).toBe(403);
    await page.goto('/account');
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/$/);
    expect((await page.goto('/account'))?.status()).toBe(401);
  });

  test('ordinary organization member cannot enter the seller workspace', async ({ page }) => {
    await login(page, emails.member);
    await expect(page.locator(`a[href="/seller/organization/${organizationId}"]`)).toHaveCount(0);
    expect((await page.goto(`/seller/organization/${organizationId}`))?.status()).toBe(403);
  });

  test('organization administrator can enter its seller workspace but not platform administration', async ({ page }) => {
    await login(page, emails.seller);
    await expect(page.locator(`a[href="/seller/organization/${organizationId}"]`)).toBeVisible();
    await page.goto(`/seller/organization/${organizationId}`);
    await expect(page.getByRole('heading', { name: `Acceptance Grower ${runId}` })).toBeVisible();
    expect((await page.goto('/admin'))?.status()).toBe(403);
  });

  test('organization administrator writes through CSRF-protected seller forms with audit events', async ({ page }) => {
    await login(page, emails.seller);
    await page.goto(`/seller/organization/${organizationId}`);

    const rejectedShipping = await page.context().request.post('/seller/shipping', { form: {
      csrf: 'invalid', organization_id: organizationId, name: `Rejected ${runId}`, countries: 'PL', rate: '1.00',
    } });
    expect(rejectedShipping.status()).toBe(403);

    const productName = `Acceptance Tomato ${runId}`;
    const productSku = `ACC-${runId}`;
    const productForm = page.locator('form[action="/seller/product"]');
    await productForm.getByLabel('Name', { exact: true }).fill(productName);
    await productForm.getByLabel('SKU').fill(productSku);
    await productForm.getByLabel('Botanical name').fill('Solanum lycopersicum');
    await productForm.getByLabel('Category').fill('Tomato');
    await productForm.getByLabel('Description').fill('Acceptance-only documented tomato seed lot for RBAC verification.');
    await productForm.getByLabel('Price EUR').fill('3.45');
    await productForm.getByLabel('Stock').fill('12');
    await productForm.getByLabel('Packet quantity').fill('20 seeds');
    await productForm.getByRole('button', { name: 'Submit product for review' }).click();
    await expect(page).toHaveURL(new RegExp(`/seller/organization/${organizationId}$`));
    await expect(page.locator('.record-list')).toContainText(productName);

    const shippingName = `EU tracked ${runId}`;
    const shippingForm = page.locator('form[action="/seller/shipping"]');
    await shippingForm.getByLabel('Name').fill(shippingName);
    await shippingForm.getByLabel('Country codes').fill('pl,de');
    await shippingForm.getByLabel('Rate EUR').fill('4.25');
    await shippingForm.getByRole('button', { name: 'Add shipping zone' }).click();

    const exchangeTitle = `Acceptance exchange ${runId}`;
    const exchangeForm = page.locator('form[action="/seller/exchange"]');
    await exchangeForm.getByLabel('Mode').selectOption('exchange');
    await exchangeForm.getByLabel('Title').fill(exchangeTitle);
    await exchangeForm.getByLabel('Species').fill('Phaseolus vulgaris');
    await exchangeForm.getByLabel('Quantity').fill('5 packets');
    await exchangeForm.getByLabel('Description').fill('Acceptance-only exchange listing created by the isolated test suite.');
    await exchangeForm.getByRole('button', { name: 'Publish listing' }).click();

    const product = await database.query<{id:string;slug:string;status:string;price_cents:string;stock_quantity:number}>(
      'SELECT id,slug,status,price_cents,stock_quantity FROM products WHERE organization_id=$1 AND sku=$2', [organizationId, productSku]);
    expect(product.rows[0]).toMatchObject({ status: 'pending_review', price_cents: '345', stock_quantity: 12 });
    productId = product.rows[0].id;
    productSlug = product.rows[0].slug;
    expect((await database.query('SELECT 1 FROM seller_shipping_zones WHERE organization_id=$1 AND name=$2 AND countries=$3 AND rate_cents=$4', [organizationId, shippingName, 'PL,DE', 425])).rowCount).toBe(1);
    expect((await database.query('SELECT 1 FROM exchange_listings WHERE organization_id=$1 AND title=$2 AND mode=$3', [organizationId, exchangeTitle, 'exchange'])).rowCount).toBe(1);
    expect((await database.query(`SELECT 1 FROM audit_events WHERE actor_user_id=$1 AND event_name=ANY($2::text[])`,
      [sellerUserId, ['product.submitted_for_review','shipping_zone.created','exchange.published']])).rowCount).toBe(3);
  });

  test('platform administrator moderates the seller product and can enter any seller workspace', async ({ page }) => {
    await login(page, emails.admin);
    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: 'Platform administration' })).toBeVisible();
    const productArticle = page.locator('article').filter({ hasText: `Acceptance Tomato ${runId}` });
    await productArticle.getByRole('button', { name: 'approve' }).click();
    await expect(page).toHaveURL(/\/admin$/);
    expect((await database.query<{status:string}>('SELECT status FROM products WHERE id=$1', [productId])).rows[0].status).toBe('active');
    expect((await database.query('SELECT 1 FROM audit_events WHERE actor_user_id=$1 AND entity_type=$2 AND entity_id=$3 AND event_name=$4',
      [adminUserId, 'product', productId, 'product.approved'])).rowCount).toBe(1);
    expect((await page.goto(`/product/${productSlug}`))?.status()).toBe(200);
    await page.goto(`/seller/organization/${organizationId}`);
    await expect(page.getByRole('heading', { name: `Acceptance Grower ${runId}` })).toBeVisible();
  });
});
