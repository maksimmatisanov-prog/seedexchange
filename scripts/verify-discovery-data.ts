import { pool } from '../src/db/pool.js';
import { config } from '../src/config.js';
import { validateDiscoveryDataReadiness, type DiscoveryDataReadiness } from '../src/domain/discovery-readiness.js';
import { verifyMediaInventory, type MediaAssetRecord } from '../src/domain/media-verification.js';
import { isExternalHttpsUrl } from '../src/domain/public-url.js';
import {
  DISCOVERY_ALLOWED_TARGET_TABLES,
  DISCOVERY_FORBIDDEN_TARGET_TABLES,
  quotePostgresIdentifier,
} from '../src/domain/legacy-migration.js';

const expectedMigration = process.argv[2] || '003_discovery_migration_scope.sql';
const forbiddenCommerceExpression = DISCOVERY_FORBIDDEN_TARGET_TABLES
  .map((table) => `(SELECT count(*) FROM ${quotePostgresIdentifier(table)})`)
  .join('+');

try {
  const [migration, run, counts, mediaRows, productUrls, schemaTables] = await Promise.all([
    pool.query<{ version: string }>('SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1'),
    pool.query<{ status: string; scope: string; source_fingerprint: string }>(`SELECT status,scope,source_fingerprint
      FROM legacy_migration_runs WHERE mode='import' ORDER BY completed_at DESC NULLS LAST,started_at DESC LIMIT 1`),
    pool.query<Record<string, string>>(`SELECT
      (SELECT count(*) FROM organizations WHERE status='approved')::text approved_organizations,
      (SELECT count(*) FROM users WHERE role='platform_admin' AND email_verified_at IS NOT NULL)::text verified_platform_admins,
      (SELECT count(*) FROM products WHERE status='active' AND purchase_mode='external')::text active_external_products,
      (SELECT count(*) FROM exchange_listings WHERE status='active')::text active_exchanges,
      (${forbiddenCommerceExpression})::text forbidden_commerce_rows,
      (SELECT count(*) FROM organizations WHERE marketplace_enabled OR stripe_account_id IS NOT NULL OR stripe_charges_enabled OR stripe_payouts_enabled)::text payment_capability_organizations,
      (SELECT count(*) FROM supplier_publication_batches WHERE status='pending_review')::text open_supplier_batches,
      (SELECT count(*) FROM supplier_publication_batches WHERE status='approved' AND sitemap_status='failed')::text failed_sitemap_batches,
      (SELECT count(*) FROM products WHERE status='pending_review')::text pending_product_reviews`),
    pool.query<MediaAssetRecord>('SELECT storage_key,mime_type,byte_size,width_px,height_px,sha256,is_active FROM media_assets ORDER BY storage_key'),
    pool.query<{ purchase_mode: string; external_purchase_url: string | null; image_url: string | null }>(
      'SELECT purchase_mode,external_purchase_url,image_url FROM products',
    ),
    pool.query<{ table_name: string }>(`SELECT table_name FROM information_schema.tables
      WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name`),
  ]);
  const media = await verifyMediaInventory(mediaRows.rows, config.MEDIA_ROOT);
  const row = counts.rows[0];
  const migrationRun = run.rows[0];
  const classifiedTables = new Set<string>([...DISCOVERY_ALLOWED_TARGET_TABLES, ...DISCOVERY_FORBIDDEN_TARGET_TABLES]);
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
    unclassifiedTables: schemaTables.rows.map(({ table_name }) => table_name).filter((table) => !classifiedTables.has(table)),
    paymentCapabilityOrganizations: Number(row.payment_capability_organizations),
    invalidDiscoveryProducts: productUrls.rows.filter((product) =>
      product.purchase_mode !== 'external'
      || !isExternalHttpsUrl(product.external_purchase_url)
      || (Boolean(product.image_url?.trim()) && !isExternalHttpsUrl(product.image_url)),
    ).length,
    openSupplierBatches: Number(row.open_supplier_batches),
    failedSitemapBatches: Number(row.failed_sitemap_batches),
    pendingProductReviews: Number(row.pending_product_reviews),
    mediaReady: media.ready,
  };
  const errors = validateDiscoveryDataReadiness(state);
  console.log(JSON.stringify({ ready: errors.length === 0, ...state, media: { databaseRows: media.databaseRows, files: media.files, errors: media.errors }, errors }, null, 2));
  if (errors.length) process.exitCode = 1;
} finally {
  await pool.end();
}
