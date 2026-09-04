export type DiscoveryDataReadiness = {
  currentMigration: string | null;
  expectedMigration: string;
  migrationRunStatus: string | null;
  migrationRunScope: string | null;
  sourceFingerprint: string | null;
  approvedOrganizations: number;
  verifiedPlatformAdmins: number;
  activeExternalProducts: number;
  activeExchanges: number;
  forbiddenCommerceRows: number;
  paymentCapabilityOrganizations: number;
  invalidDiscoveryProducts: number;
  openSupplierBatches: number;
  failedSitemapBatches: number;
  pendingProductReviews: number;
  mediaReady: boolean;
};

export function validateDiscoveryDataReadiness(state: DiscoveryDataReadiness): string[] {
  const errors: string[] = [];
  if (state.currentMigration !== state.expectedMigration) errors.push(`Expected migration ${state.expectedMigration}, received ${String(state.currentMigration)}.`);
  if (state.migrationRunStatus !== 'succeeded' || state.migrationRunScope !== 'discovery' || !state.sourceFingerprint) {
    errors.push('No successful fingerprinted discovery import was found.');
  }
  if (state.approvedOrganizations < 1) errors.push('No approved organization is available.');
  if (state.verifiedPlatformAdmins < 1) errors.push('No verified platform administrator is available.');
  if (state.activeExternalProducts < 1) errors.push('No active external product is available.');
  if (state.forbiddenCommerceRows !== 0) errors.push('Commerce tables contain rows during discovery launch.');
  if (state.paymentCapabilityOrganizations !== 0) errors.push('An organization retains marketplace or Stripe capabilities.');
  if (state.invalidDiscoveryProducts !== 0) errors.push('Products outside the HTTPS external-offer contract exist.');
  if (state.openSupplierBatches !== 0) errors.push('Supplier batches are still awaiting review.');
  if (state.failedSitemapBatches !== 0) errors.push('An approved supplier batch has a failed sitemap state.');
  if (state.pendingProductReviews !== 0) errors.push('Products are still awaiting moderation.');
  if (!state.mediaReady) errors.push('The first-party media inventory is incomplete or does not match PostgreSQL.');
  return errors;
}
