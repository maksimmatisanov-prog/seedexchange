import { randomUUID } from 'node:crypto';
import bcrypt from 'bcrypt';
import { expect, test, type Page } from '@playwright/test';
import pg from 'pg';

const acceptanceEnabled = process.env.PLAYWRIGHT_MUTATING_ACCEPTANCE === '1';
const databaseUrl = process.env.TEST_DATABASE_URL;
const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:4000';
const runId = randomUUID().replaceAll('-', '');
const password = `Acceptance-${runId}!`;
const emails = {
  buyer: `acceptance-buyer-${runId}@example.test`,
  member: `acceptance-member-${runId}@example.test`,
  seller: `acceptance-seller-${runId}@example.test`,
  admin: `acceptance-admin-${runId}@example.test`,
};

let database: pg.Pool;
let organizationId: string;

async function login(page: Page, email: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.locator('main')).toContainText(email);
}

test.describe('buyer, seller and administrator acceptance', () => {
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
    const hash = await bcrypt.hash(password, 12);
    const client = await database.connect();
    try {
      await client.query('BEGIN');
      const userIds = new Map<string, string>();
      for (const [role, email] of Object.entries(emails)) {
        const platformRole = role === 'admin' ? 'platform_admin' : role === 'seller' ? 'org_admin' : role === 'member' ? 'org_member' : 'buyer';
        const result = await client.query<{ id: string }>(`INSERT INTO users(email,email_verified_at,password_hash,role)
          VALUES($1,now(),$2,$3) RETURNING id`, [email, hash, platformRole]);
        userIds.set(role, result.rows[0].id);
      }
      const organization = await client.query<{ id: string }>(`INSERT INTO organizations(type,name,slug,country,description,status,seller_status,marketplace_enabled,verified_at)
        VALUES('grower',$1,$2,'Poland','Acceptance organization used only by the isolated browser test suite.','approved','active',true,now()) RETURNING id`,
      [`Acceptance Grower ${runId}`, `acceptance-grower-${runId}`]);
      organizationId = organization.rows[0].id;
      await client.query(`INSERT INTO organization_members(organization_id,user_id,role) VALUES($1,$2,'member'),($1,$3,'admin')`,
        [organizationId, userIds.get('member'), userIds.get('seller')]);
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

  test('platform administrator can enter administration and any seller workspace', async ({ page }) => {
    await login(page, emails.admin);
    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: 'Platform administration' })).toBeVisible();
    await page.goto(`/seller/organization/${organizationId}`);
    await expect(page.getByRole('heading', { name: `Acceptance Grower ${runId}` })).toBeVisible();
  });
});
