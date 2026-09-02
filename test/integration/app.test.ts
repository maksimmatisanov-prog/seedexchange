import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const query = vi.fn(async (sql: string) => {
  if (sql.includes('(SELECT count(*) FROM organizations')) {
    return { rows: [{ organizations: '0', products: '0', exchanges: '0' }], rowCount: 1 };
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
    expect(response.json().status).toBe('ok');
    expect(query).not.toHaveBeenCalled();
  });

  it('renders the public shell and canonical navigation', async () => {
    const response = await app.inject({ method: 'GET', url: '/' });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Seeds with a documented history.');
    for (const path of ['/directory', '/marketplace', '/exchange', '/search', '/cart', '/login', '/register']) {
      expect(response.body).toContain(`href="${path}"`);
    }
  });

  it('redirects the legacy route query to a canonical path', async () => {
    const response = await app.inject({ method: 'GET', url: '/?_route=/marketplace' });
    expect(response.statusCode).toBe(301);
    expect(response.headers.location).toBe('/marketplace');
  });
});
