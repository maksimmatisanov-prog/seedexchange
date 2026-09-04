import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateProductionDatabaseIdentity, type ProductionDatabaseIdentity } from '../../src/domain/production-database.js';

const healthy: ProductionDatabaseIdentity = {
  databaseName: 'seedexchange_production',
  roleName: 'seedexchange_production',
  serverAddress: '127.0.0.1',
  databaseOwner: 'seedexchange_production',
  roleCanLogin: true,
  roleElevated: false,
};

describe('production database identity', () => {
  it('accepts the dedicated least-privilege loopback identity', () => {
    expect(validateProductionDatabaseIdentity(healthy)).toEqual([]);
  });

  it('rejects staging identity, socket transport, wrong ownership and elevated privileges', () => {
    expect(validateProductionDatabaseIdentity({
      ...healthy,
      databaseName: 'seedexchange_staging',
      roleName: 'seedexchange',
      serverAddress: '',
      databaseOwner: 'postgres',
      roleCanLogin: false,
      roleElevated: true,
    })).toEqual([
      'Connected database is not seedexchange_production.',
      'Connected role is not seedexchange_production.',
      'Production database connection is not using the approved IPv4 loopback endpoint.',
      'The production database is not owned by seedexchange_production.',
      'The production database role cannot log in.',
      'The production database role has elevated cluster privileges.',
    ]);
  });

  it('fails through the operational CLI without exposing connection credentials', () => {
    const password = 'private-db-password-that-must-not-appear';
    const databaseUrl = `postgresql://seedexchange_production:${password}@127.0.0.1:1/seedexchange_production`;
    const execution = spawnSync(process.execPath, [
      path.resolve('node_modules/tsx/dist/cli.mjs'),
      path.resolve('scripts/verify-production-database.ts'),
    ], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 10_000,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        SESSION_SECRET: 'a-secure-random-session-value-1234567890',
        DATABASE_URL: databaseUrl,
        DB_POOL_MAX: '1',
      },
    });
    expect(execution.status, execution.stderr).toBe(1);
    expect(JSON.parse(execution.stdout)).toEqual({
      ready: false,
      errors: ['Production database connection and identity verification failed.'],
    });
    expect(`${execution.stdout}\n${execution.stderr}`).not.toContain(password);
    expect(`${execution.stdout}\n${execution.stderr}`).not.toContain(databaseUrl);
  });
});
