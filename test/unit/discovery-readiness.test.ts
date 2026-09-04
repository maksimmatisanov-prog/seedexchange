import { describe, expect, it } from 'vitest';
import { validateDiscoveryDataReadiness, type DiscoveryDataReadiness } from '../../src/domain/discovery-readiness.js';

const ready: DiscoveryDataReadiness = {
  currentMigration: '003_discovery_migration_scope.sql',
  expectedMigration: '003_discovery_migration_scope.sql',
  migrationRunStatus: 'succeeded',
  migrationRunScope: 'discovery',
  sourceFingerprint: 'a'.repeat(64),
  approvedOrganizations: 1,
  verifiedPlatformAdmins: 1,
  activeExternalProducts: 10,
  activeExchanges: 0,
  forbiddenCommerceRows: 0,
  paymentCapabilityOrganizations: 0,
  invalidDiscoveryProducts: 0,
  openSupplierBatches: 0,
  failedSitemapBatches: 0,
  pendingProductReviews: 0,
};

describe('discovery production data readiness', () => {
  it('accepts a migrated external-only dataset with no payment state', () => {
    expect(validateDiscoveryDataReadiness(ready)).toEqual([]);
  });

  it('fails closed on commerce data, capabilities and incomplete moderation', () => {
    const errors = validateDiscoveryDataReadiness({
      ...ready,
      forbiddenCommerceRows: 1,
      paymentCapabilityOrganizations: 1,
      invalidDiscoveryProducts: 1,
      openSupplierBatches: 1,
      pendingProductReviews: 1,
    });
    expect(errors).toContain('Commerce tables contain rows during discovery launch.');
    expect(errors).toContain('An organization retains marketplace or Stripe capabilities.');
    expect(errors).toContain('Products outside the HTTPS external-offer contract exist.');
    expect(errors).toContain('Supplier batches are still awaiting review.');
    expect(errors).toContain('Products are still awaiting moderation.');
  });

  it('requires the bundled schema and a successful discovery import fingerprint', () => {
    const errors = validateDiscoveryDataReadiness({ ...ready, currentMigration: '002_legacy_compatibility.sql', migrationRunScope: 'full' });
    expect(errors).toContain('Expected migration 003_discovery_migration_scope.sql, received 002_legacy_compatibility.sql.');
    expect(errors).toContain('No successful fingerprinted discovery import was found.');
  });
});
