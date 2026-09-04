import { describe, expect, it } from 'vitest';
import { validateProductionObservation, type ProductionObservationState } from '../../src/domain/production-observation.js';

const healthy: ProductionObservationState = {
  currentMigration: '003_discovery_migration_scope.sql',
  expectedMigration: '003_discovery_migration_scope.sql',
  databaseName: 'seedexchange_production',
  databaseSizeBytes: 10_000_000,
  connections: 5,
  maxConnections: 100,
  longRunningQueries: 0,
  idleInTransaction: 0,
  failedOutbox: 0,
  stalePendingOutbox: 0,
  staleProcessingOutbox: 0,
  sitemapRegularFile: true,
  sitemapByteSize: 1000,
  sitemapAgeMinutes: 30,
  sitemapHasOrganization: true,
  sitemapHasProduct: true,
};

describe('production discovery observation snapshot', () => {
  it('accepts a healthy sanitized operational snapshot', () => {
    expect(validateProductionObservation(healthy)).toEqual([]);
  });

  it('rejects connection pressure and stuck database work', () => {
    expect(validateProductionObservation({ ...healthy, connections: 80, longRunningQueries: 1, idleInTransaction: 1 }))
      .toEqual(expect.arrayContaining([
        'Database connections reached at least 80% of max_connections.',
        'A production database query has been active for more than 30 seconds.',
        'A production database session has been idle in transaction for more than 60 seconds.',
      ]));
  });

  it('rejects queue failures and stale or incomplete sitemap evidence', () => {
    expect(validateProductionObservation({ ...healthy, failedOutbox: 1, stalePendingOutbox: 2, sitemapAgeMinutes: 91, sitemapHasProduct: false }))
      .toEqual(expect.arrayContaining([
        'The production email outbox contains failed messages.',
        'The production email outbox contains messages pending for more than five minutes.',
        'The generated production sitemap is older than 90 minutes.',
        'The generated production sitemap is missing the representative product.',
      ]));
  });
});
