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
});
