import { pool } from '../src/db/pool.js';
import { validateDiscoveryDataReadiness, type DiscoveryDataReadiness } from '../src/domain/discovery-readiness.js';

const expectedMigration = process.argv[2] || '003_discovery_migration_scope.sql';

try {
  const [migration, run, counts] = await Promise.all([
    pool.query<{ version: string }>('SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1'),
    pool.query<{ status: string; scope: string; source_fingerprint: string }>(`SELECT status,scope,source_fingerprint
      FROM legacy_migration_runs WHERE mode='import' ORDER BY completed_at DESC NULLS LAST,started_at DESC LIMIT 1`),
    pool.query<Record<string, string>>(`SELECT
      (SELECT count(*) FROM organizations WHERE status='approved')::text approved_organizations,
      (SELECT count(*) FROM users WHERE role='platform_admin' AND email_verified_at IS NOT NULL)::text verified_platform_admins,
      (SELECT count(*) FROM products WHERE status='active' AND purchase_mode='external')::text active_external_products,
      (SELECT count(*) FROM exchange_listings WHERE status='active')::text active_exchanges,
      ((SELECT count(*) FROM shipping_zones)+(SELECT count(*) FROM seller_shipping_zones)+(SELECT count(*) FROM orders)+
       (SELECT count(*) FROM seller_orders)+(SELECT count(*) FROM order_items)+(SELECT count(*) FROM inventory_reservations)+
       (SELECT count(*) FROM stripe_events)+(SELECT count(*) FROM seller_transfers)+(SELECT count(*) FROM delivery_cases)+
       (SELECT count(*) FROM reviews)+(SELECT count(*) FROM review_responses))::text forbidden_commerce_rows,
      (SELECT count(*) FROM organizations WHERE marketplace_enabled OR stripe_account_id IS NOT NULL OR stripe_charges_enabled OR stripe_payouts_enabled)::text payment_capability_organizations,
      (SELECT count(*) FROM products WHERE purchase_mode<>'external' OR external_purchase_url IS NULL OR external_purchase_url!~*'^https://')::text invalid_discovery_products,
      (SELECT count(*) FROM supplier_publication_batches WHERE status='pending_review')::text open_supplier_batches,
      (SELECT count(*) FROM supplier_publication_batches WHERE status='approved' AND sitemap_status='failed')::text failed_sitemap_batches,
      (SELECT count(*) FROM products WHERE status='pending_review')::text pending_product_reviews`),
  ]);
  const row = counts.rows[0];
  const migrationRun = run.rows[0];
  const state: DiscoveryDataReadiness = {
    currentMigration: migration.rows[0]?.version ?? null,
    expectedMigration,
    migrationRunStatus: migrationRun?.status ?? null,
    migrationRunScope: migrationRun?.scope ?? null,
    sourceFingerprint: migrationRun?.source_fingerprint ?? null,
    approvedOrganizations: Number(row.approved_organizations),
    verifiedPlatformAdmins: Number(row.verified_platform_admins),
    activeExternalProducts: Number(row.active_external_products),
    activeExchanges: Number(row.active_exchanges),
    forbiddenCommerceRows: Number(row.forbidden_commerce_rows),
    paymentCapabilityOrganizations: Number(row.payment_capability_organizations),
    invalidDiscoveryProducts: Number(row.invalid_discovery_products),
    openSupplierBatches: Number(row.open_supplier_batches),
    failedSitemapBatches: Number(row.failed_sitemap_batches),
    pendingProductReviews: Number(row.pending_product_reviews),
  };
  const errors = validateDiscoveryDataReadiness(state);
  console.log(JSON.stringify({ ready: errors.length === 0, ...state, errors }, null, 2));
  if (errors.length) process.exitCode = 1;
} finally {
  await pool.end();
}
