export type ProductionObservationState = {
  currentMigration: string | null;
  expectedMigration: string;
  databaseName: string;
  databaseSizeBytes: number;
  connections: number;
  maxConnections: number;
  longRunningQueries: number;
  idleInTransaction: number;
  failedOutbox: number;
  stalePendingOutbox: number;
  staleProcessingOutbox: number;
  sitemapRegularFile: boolean;
  sitemapByteSize: number;
  sitemapAgeMinutes: number | null;
  sitemapHasOrganization: boolean;
  sitemapHasProduct: boolean;
};

export function validateProductionObservation(state: ProductionObservationState): string[] {
  const errors: string[] = [];
  if (state.currentMigration !== state.expectedMigration) errors.push(`Expected migration ${state.expectedMigration}, received ${String(state.currentMigration)}.`);
  if (state.databaseName !== 'seedexchange_production') errors.push('Observation is not connected to the isolated production database.');
  if (!Number.isSafeInteger(state.databaseSizeBytes) || state.databaseSizeBytes < 1) errors.push('Production database size is unavailable.');
  if (!Number.isSafeInteger(state.connections) || !Number.isSafeInteger(state.maxConnections) || state.connections < 1 || state.maxConnections < 1) errors.push('Database connection capacity is unavailable.');
  else if (state.connections / state.maxConnections >= 0.8) errors.push('Database connections reached at least 80% of max_connections.');
  if (state.longRunningQueries !== 0) errors.push('A production database query has been active for more than 30 seconds.');
  if (state.idleInTransaction !== 0) errors.push('A production database session has been idle in transaction for more than 60 seconds.');
  if (state.failedOutbox !== 0) errors.push('The production email outbox contains failed messages.');
  if (state.stalePendingOutbox !== 0) errors.push('The production email outbox contains messages pending for more than five minutes.');
  if (state.staleProcessingOutbox !== 0) errors.push('The production email outbox contains messages processing for more than fifteen minutes.');
  if (!state.sitemapRegularFile || state.sitemapByteSize < 1) errors.push('The generated production sitemap is missing, empty or not a regular file.');
  if (state.sitemapAgeMinutes === null || state.sitemapAgeMinutes > 90) errors.push('The generated production sitemap is older than 90 minutes.');
  if (!state.sitemapHasOrganization) errors.push('The generated production sitemap is missing the representative organization.');
  if (!state.sitemapHasProduct) errors.push('The generated production sitemap is missing the representative product.');
  return errors;
}
