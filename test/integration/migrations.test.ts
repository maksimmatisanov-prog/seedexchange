import { afterAll, describe, expect, it } from 'vitest';

const databaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)('PostgreSQL migrations', () => {
  let close: (() => Promise<void>) | undefined;

  afterAll(async () => close?.());

  it('applies to an empty database and is a checksum-verified no-op on repeat', async () => {
    process.env.DATABASE_URL = databaseUrl!;
    const [{ migrate }, { pool }] = await Promise.all([import('../../src/db/migrate.js'), import('../../src/db/pool.js')]);
    close = () => pool.end();
    const first = await migrate();
    const second = await migrate();
    expect(first.applied).toEqual(['001_platform.sql', '002_legacy_compatibility.sql', '003_discovery_migration_scope.sql']);
    expect(second.applied).toEqual([]);
    expect(second.current).toBe('003_discovery_migration_scope.sql');
    const tables = await pool.query<{ total: string }>("SELECT count(*)::text total FROM information_schema.tables WHERE table_schema='public'");
    expect(Number(tables.rows[0].total)).toBeGreaterThan(30);
  });
});
