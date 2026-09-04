import type { PoolClient } from 'pg';
import { config } from '../config.js';
import { pool } from '../db/pool.js';
import {
  ORESHKA_PILOT_IDS,
  catalogAcceptanceRate,
  decodeCatalogBody,
  externalUrlWithTracking,
  validateSupplierCatalog,
  type CatalogRejection,
  type NormalizedCatalogItem,
} from '../domain/supplier-catalog.js';

const MAX_FEED_BYTES = 20 * 1024 * 1024;

export type SupplierSyncOptions = {
  location: string;
  organizationSlug?: string;
  source?: string;
  commit?: boolean;
  syncLive?: boolean;
  token?: string;
};

export type SupplierSyncSummary = {
  mode: 'dry-run' | 'staging-write';
  source: string;
  received: number;
  accepted: number;
  rejected: number;
  acceptance_rate: number;
  pilot_missing: string[];
  sync_live: boolean;
  live_updated: number;
  review_required: number;
  live_stale: number;
  stale: number;
  errors: CatalogRejection[];
};

function validateSource(value: string): string {
  const source = value.trim().toLowerCase();
  if (!/^[a-z0-9_-]{2,80}$/.test(source)) throw new Error('Invalid supplier source.');
  return source;
}

export async function loadSupplierCatalog(location: string, token = ''): Promise<unknown[]> {
  let body: string;
  if (/^https:\/\//i.test(location)) {
    const response = await fetch(location, {
      headers: {
        accept: 'text/csv, application/json',
        'user-agent': 'SeedexchangeCatalogSync/1.0',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Supplier feed returned HTTP ${response.status}.`);
    if (!response.url.startsWith('https://')) throw new Error('Supplier feed redirected outside HTTPS.');
    const length = Number(response.headers.get('content-length') || 0);
    if (length > MAX_FEED_BYTES) throw new Error('Supplier feed exceeds 20 MB.');
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > MAX_FEED_BYTES) throw new Error('Supplier feed exceeds 20 MB.');
    body = new TextDecoder().decode(bytes);
  } else {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(location)) throw new Error('Supplier feed must be a local file or an HTTPS URL.');
    const { readFile } = await import('node:fs/promises');
    const { stat } = await import('node:fs/promises');
    const metadata = await stat(location);
    if (!metadata.isFile()) throw new Error('Supplier feed must be a file or an HTTPS URL.');
    if (metadata.size > MAX_FEED_BYTES) throw new Error('Supplier feed exceeds 20 MB.');
    body = await readFile(location, 'utf8');
  }
  return decodeCatalogBody(body, location);
}

function itemParameters(organizationId: string, source: string, item: NormalizedCatalogItem): unknown[] {
  return [
    organizationId, source, item.external_id, item.item_group_id, item.sku, item.name, item.description,
    item.category, item.source_category, item.botanical_name, item.price_cents, item.compare_at_price_cents,
    item.currency, item.stock_quantity, item.packet_quantity, item.origin_country, item.compliance_flag,
    JSON.stringify(item.image_urls), item.external_purchase_url, item.source_updated_at, JSON.stringify(item),
  ];
}

function contentChanged(row: Record<string, unknown>): boolean {
  const images = Array.isArray(row.image_urls) ? row.image_urls : [];
  const expected: Record<string, unknown> = {
    name: row.name,
    description: row.description,
    category: row.category,
    botanical_name: row.botanical_name,
    packet_quantity: row.packet_quantity,
    origin_country: row.origin_country,
    compliance_flag: row.compliance_flag,
    image_url: images[0] || null,
    external_purchase_url: row.external_purchase_url ? externalUrlWithTracking(String(row.external_purchase_url)) : null,
  };
  return Object.entries(expected).some(([field, value]) => String(row[`product_${field}`] ?? '') !== String(value ?? ''));
}

async function applyCatalog(client: PoolClient, organizationId: string, source: string, accepted: NormalizedCatalogItem[], summary: SupplierSyncSummary): Promise<void> {
  const run = await client.query<{ id: string }>('INSERT INTO supplier_catalog_imports(organization_id,source) VALUES($1,$2) RETURNING id', [organizationId, source]);
  const runId = run.rows[0].id;
  await client.query(`UPDATE supplier_catalog_items SET validation_status='stale'
    WHERE organization_id=$1 AND source=$2 AND validation_status=ANY($3::text[])`, [organizationId, source, ['ready', 'imported', 'review_required']]);

  for (const item of accepted) {
    await client.query(`INSERT INTO supplier_catalog_items
      (organization_id,source,external_id,item_group_id,sku,name,description,category,source_category,botanical_name,
       price_cents,compare_at_price_cents,currency,stock_quantity,packet_quantity,origin_country,compliance_flag,image_urls,
       external_purchase_url,source_updated_at,validation_status,validation_errors,payload)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,$19,$20,'ready',NULL,$21::jsonb)
      ON CONFLICT(organization_id,source,external_id) DO UPDATE SET
       item_group_id=EXCLUDED.item_group_id,sku=EXCLUDED.sku,name=EXCLUDED.name,description=EXCLUDED.description,
       category=EXCLUDED.category,source_category=EXCLUDED.source_category,botanical_name=EXCLUDED.botanical_name,
       price_cents=EXCLUDED.price_cents,compare_at_price_cents=EXCLUDED.compare_at_price_cents,currency=EXCLUDED.currency,
       stock_quantity=EXCLUDED.stock_quantity,packet_quantity=EXCLUDED.packet_quantity,origin_country=EXCLUDED.origin_country,
       compliance_flag=EXCLUDED.compliance_flag,image_urls=EXCLUDED.image_urls,external_purchase_url=EXCLUDED.external_purchase_url,
       source_updated_at=EXCLUDED.source_updated_at,
       validation_status=CASE WHEN supplier_catalog_items.imported_product_id IS NULL THEN 'ready' ELSE 'imported' END,
       validation_errors=NULL,payload=EXCLUDED.payload,last_seen_at=now()`, itemParameters(organizationId, source, item));
  }

  await client.query(`UPDATE supplier_catalog_items sci SET validation_status='ready'
    FROM products p WHERE p.id=sci.imported_product_id AND sci.organization_id=$1 AND sci.source=$2 AND p.status='rejected'`, [organizationId, source]);
  const stale = await client.query<{ count: string }>(`SELECT count(*)::text count FROM supplier_catalog_items
    WHERE organization_id=$1 AND source=$2 AND validation_status='stale'`, [organizationId, source]);
  summary.stale = Number(stale.rows[0].count);

  if (summary.sync_live) await syncPublishedProducts(client, organizationId, source, summary);
  const status = summary.rejected || summary.pilot_missing.length ? 'completed_with_errors' : 'succeeded';
  await client.query(`UPDATE supplier_catalog_imports SET status=$1,accepted_count=$2,rejected_count=$3,stale_count=$4,
    report=$5::jsonb,completed_at=now() WHERE id=$6`, [status, summary.accepted, summary.rejected, summary.stale, JSON.stringify(summary), runId]);
}

async function syncPublishedProducts(client: PoolClient, organizationId: string, source: string, summary: SupplierSyncSummary): Promise<void> {
  const published = await client.query<Record<string, unknown>>(`SELECT sci.*,
    p.id product_id,p.name product_name,p.description product_description,p.category product_category,
    p.botanical_name product_botanical_name,p.packet_quantity product_packet_quantity,p.origin_country product_origin_country,
    p.compliance_flag product_compliance_flag,p.image_url product_image_url,p.external_purchase_url product_external_purchase_url
    FROM supplier_catalog_items sci JOIN products p ON p.id=sci.imported_product_id
    WHERE sci.organization_id=$1 AND sci.source=$2 AND sci.validation_status='imported'
      AND p.status='active' AND p.purchase_mode='external'`, [organizationId, source]);
  for (const row of published.rows) {
    if (contentChanged(row)) {
      await client.query("UPDATE products SET source_sync_status='review_required' WHERE id=$1", [row.product_id]);
      await client.query("UPDATE supplier_catalog_items SET validation_status='review_required' WHERE id=$1", [row.id]);
      summary.review_required += 1;
    } else {
      await client.query(`UPDATE products SET price_cents=$1,compare_at_price_cents=$2,stock_quantity=$3,
        source_updated_at=$4,source_sync_status='current',updated_at=now() WHERE id=$5`,
      [row.price_cents, row.compare_at_price_cents, row.stock_quantity, row.source_updated_at, row.product_id]);
      summary.live_updated += 1;
    }
  }
  const missing = await client.query<{ id: string }>(`SELECT p.id FROM supplier_catalog_items sci JOIN products p ON p.id=sci.imported_product_id
    WHERE sci.organization_id=$1 AND sci.source=$2 AND sci.validation_status='stale'
      AND p.status='active' AND p.purchase_mode='external'`, [organizationId, source]);
  if (missing.rows.length) {
    await client.query("UPDATE products SET stock_quantity=0,source_sync_status='stale',updated_at=now() WHERE id=ANY($1::bigint[])", [missing.rows.map((row) => row.id)]);
    summary.live_stale = missing.rows.length;
  }
}

export async function syncSupplierCatalog(options: SupplierSyncOptions): Promise<SupplierSyncSummary> {
  const source = validateSource(options.source ?? 'oreshka-meta');
  const raw = await loadSupplierCatalog(options.location, options.token ?? config.ORESHKA_FEED_TOKEN);
  const { accepted, rejected } = validateSupplierCatalog(raw);
  const acceptanceRate = catalogAcceptanceRate(raw.length, accepted.length);
  const pilotMissing = options.location.toLowerCase().includes('feed-fb.csv')
    ? ORESHKA_PILOT_IDS.filter((id) => !accepted.some((item) => item.external_id === id))
    : [];
  const summary: SupplierSyncSummary = {
    mode: options.commit ? 'staging-write' : 'dry-run', source, received: raw.length, accepted: accepted.length,
    rejected: rejected.length, acceptance_rate: Number(acceptanceRate.toFixed(5)), pilot_missing: pilotMissing,
    sync_live: Boolean(options.syncLive), live_updated: 0, review_required: 0, live_stale: 0, stale: 0, errors: rejected,
  };
  if (acceptanceRate < 0.99) throw new Error(`Feed acceptance rate ${(acceptanceRate * 100).toFixed(2)}% is below 99%. No staging data was written.`);
  if (!options.commit) return summary;

  const organizationSlug = options.organizationSlug ?? 'oreshka-seeds';
  const client = await pool.connect();
  try {
    const organization = await client.query<{ id: string }>("SELECT id FROM organizations WHERE slug=$1 AND status='approved'", [organizationSlug]);
    if (!organization.rows[0]) throw new Error('Approved Oreshka organization was not found.');
    await client.query('BEGIN');
    try {
      await applyCatalog(client, organization.rows[0].id, source, accepted, summary);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
    return summary;
  } finally {
    client.release();
  }
}
