import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const query = vi.fn(async (sql: string, params?: unknown[]) => {
  if (sql.includes('SELECT version FROM schema_migrations')) {
    return { rows: [{ version: '002_legacy_compatibility.sql' }], rowCount: 1 };
  }
  if (sql.includes('(SELECT count(*) FROM organizations')) {
    return { rows: [{ organizations: '2', products: '1', exchanges: '1' }], rowCount: 1 };
  }
  if (sql.includes('FROM organizations o LEFT JOIN')) {
    return { rows: [{ id: 'org-1', name: 'Northern Seed Library', slug: 'northern-seed-library', type: 'seed_bank', country: 'Finland', description: 'A regional collection focused on resilient northern varieties.', specialties: null, founder_slot: 1 }], rowCount: 1 };
  }
  if (sql.includes('FROM products p JOIN organizations o')) {
    const slug = params?.[0];
    if (sql.includes('WHERE p.slug=$1') && slug === 'arctic-pea') {
      return { rows: [{ id: 'product-1', name: 'Arctic pea', botanical_name: 'Pisum sativum', slug: 'arctic-pea', category: 'vegetables', description: 'A cold-hardy pea from an approved collection.', price_cents: '600', compare_at_price_cents: null, currency: 'USD', stock_quantity: 8, image_url: null, purchase_mode: 'external', external_purchase_url: 'https://seller.example/arctic-pea', organization_name: 'Northern Seed Library', organization_slug: 'northern-seed-library' }], rowCount: 1 };
    }
    return { rows: [{ id: 'product-1', name: 'Arctic pea', botanical_name: 'Pisum sativum', slug: 'arctic-pea', category: 'vegetables', price_cents: '600', compare_at_price_cents: null, currency: 'USD', stock_quantity: 8, image_url: null, purchase_mode: 'external', external_purchase_url: 'https://seller.example/arctic-pea', organization_name: 'Northern Seed Library', organization_slug: 'northern-seed-library' }], rowCount: 1 };
  }
  if (sql.includes('FROM exchange_listings x JOIN organizations o')) {
    return { rows: [{ id: 'exchange-1', title: 'Northern field pea', species: 'Pisum sativum', quantity_available: '20 packets', mode: 'exchange', description: 'Surplus from the current collection cycle.', organization_name: 'Northern Seed Library', organization_slug: 'northern-seed-library' }], rowCount: 1 };
  }
  return { rows: [], rowCount: 0 };
});

vi.mock('../../src/db/pool.js', () => ({
  pool: { query, connect: vi.fn(), on: vi.fn(), end: vi.fn() },
}));

describe('public application', () => {
  let app: Awaited<ReturnType<typeof import('../../src/app.js')['buildApp']>>;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    const { buildApp } = await import('../../src/app.js');
    app = await buildApp();
  });

  afterAll(async () => app.close());

  it('keeps the process health check independent from PostgreSQL', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok', launchPhase: 'discovery', commerceEnabled: false });
    expect(query).not.toHaveBeenCalled();
  });

  it('renders the public shell and canonical navigation', async () => {
    const response = await app.inject({ method: 'GET', url: '/' });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Seeds with a known origin.');
    expect(response.body).toContain('Recently added seed records');
    expect(response.body).toContain('Collections behind the seeds');
    expect(response.body).toContain('Northern Seed Library');
    expect(response.body).toContain('At source');
    expect(response.body).toContain('aria-label="Archive totals"');
    for (const path of ['/directory', '/marketplace', '/exchange', '/search', '/login', '/register']) {
      expect(response.body).toContain(`href="${path}"`);
    }
    expect(response.body).not.toContain('href="/cart"');
  });

  it('reports and enforces the discovery launch boundary', async () => {
    const ready = await app.inject({ method: 'GET', url: '/ready' });
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toMatchObject({ launchPhase: 'discovery', commerceEnabled: false, connectEnabled: false, marketplacePaymentsEnabled: false, payoutWorkerEnabled: false });
    expect((await app.inject({ method: 'GET', url: '/cart' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/cart/add', payload: {} })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/checkout/create', payload: {} })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/webhook/stripe', payload: {} })).statusCode).toBe(404);
  });

  it('keeps approved external offers visible without an internal purchase path', async () => {
    const response = await app.inject({ method: 'GET', url: '/product/arctic-pea' });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('href="https://seller.example/arctic-pea"');
    expect(response.body).toContain('The seller completes this purchase on its own website.');
    expect(response.body).not.toContain('action="/cart/add"');
  });

  it('redirects the legacy route query to a canonical path', async () => {
    const response = await app.inject({ method: 'GET', url: '/?_route=/marketplace' });
    expect(response.statusCode).toBe(301);
    expect(response.headers.location).toBe('/marketplace');
  });
});
