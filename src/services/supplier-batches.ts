import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { pool } from '../db/pool.js';
import {
  supplierProductSlug,
  supplierSnapshotErrors,
  supplierSnapshotFromRow,
  supplierSnapshotHash,
  type SupplierSnapshot,
} from '../domain/supplier-catalog.js';

export const SUPPLIER_BATCH_LIMIT = 200;
const SAMPLE_SIZE = 12;
export type SupplierBatchType = 'publication' | 'content_review';

type CandidateRow = Record<string, unknown> & { id: string; imported_product_id: string | null };
type BatchEntry = { row: CandidateRow; snapshot: SupplierSnapshot; hash: string; errors: string[]; slug: string; productId: string | null };
export type SupplierBatchSummary = {
  mode: 'dry-run' | 'pending-review-write'; batch_type: SupplierBatchType; source: string; organization: string;
  selected: number; limit: number; snapshot_hash: string; report: Record<string, unknown>; batch_id: string | null;
};

function validateOptions(sourceValue: string, limit: number, batchType: SupplierBatchType): string {
  const source = sourceValue.trim().toLowerCase();
  if (!/^[a-z0-9_-]{2,80}$/.test(source)) throw new Error('Invalid supplier source.');
  if (!Number.isInteger(limit) || limit < 1 || limit > SUPPLIER_BATCH_LIMIT) throw new Error('Batch limit must be between 1 and 200.');
  if (!['publication', 'content_review'].includes(batchType)) throw new Error('Batch type must be publication or content_review.');
  return source;
}

function batchReport(entries: BatchEntry[], batchType: SupplierBatchType): Record<string, unknown> {
  const categories: Record<string, number> = {};
  const prices: number[] = [];
  let errorCount = 0;
  for (const entry of entries) {
    categories[entry.snapshot.category] = (categories[entry.snapshot.category] ?? 0) + 1;
    prices.push(entry.snapshot.price_cents);
    errorCount += entry.errors.length;
  }
  return {
    batch_type: batchType,
    categories: Object.fromEntries(Object.entries(categories).sort(([left], [right]) => left.localeCompare(right))),
    prices: {
      currency: entries[0]?.snapshot.currency ?? null,
      minimum_cents: prices.length ? Math.min(...prices) : null,
      maximum_cents: prices.length ? Math.max(...prices) : null,
      average_cents: prices.length ? Math.round(prices.reduce((total, price) => total + price, 0) / prices.length) : null,
    },
    error_count: errorCount,
    samples: entries.slice(0, SAMPLE_SIZE).map(({ snapshot }) => ({
      external_id: snapshot.external_id, name: snapshot.name, image_url: snapshot.image_url,
      external_purchase_url: snapshot.external_purchase_url,
    })),
  };
}

async function candidates(client: PoolClient, organizationId: string, source: string, limit: number, batchType: SupplierBatchType): Promise<CandidateRow[]> {
  if (batchType === 'publication') {
    const result = await client.query<CandidateRow>(`SELECT sci.*,p.id reuse_product_id,p.status reuse_product_status,
      p.sku reuse_product_sku,p.slug reuse_product_slug,p.external_id reuse_external_id,p.external_source reuse_external_source
      FROM supplier_catalog_items sci LEFT JOIN products p ON p.id=sci.imported_product_id
      WHERE sci.organization_id=$1 AND sci.source=$2 AND sci.validation_status='ready' AND sci.stock_quantity>0
        AND (sci.imported_product_id IS NULL OR (p.status='rejected' AND p.organization_id=sci.organization_id
          AND p.external_source=sci.source AND p.external_id=sci.external_id))
      ORDER BY sci.external_id,sci.id LIMIT $3`, [organizationId, source, limit]);
    return result.rows;
  }
  const result = await client.query<CandidateRow>(`SELECT sci.* FROM supplier_catalog_items sci JOIN products p ON p.id=sci.imported_product_id
    WHERE sci.organization_id=$1 AND sci.source=$2 AND sci.validation_status='review_required'
      AND p.source_sync_status='review_required' AND p.status='active'
    ORDER BY sci.external_id,sci.id LIMIT $3`, [organizationId, source, limit]);
  return result.rows;
}

async function buildEntries(client: PoolClient, rows: CandidateRow[]): Promise<BatchEntry[]> {
  const entries: BatchEntry[] = [];
  const seenSkus = new Set<string>();
  const seenSlugs = new Set<string>();
  for (const row of rows) {
    const snapshot = supplierSnapshotFromRow(row);
    const errors = supplierSnapshotErrors(snapshot);
    const slug = row.reuse_product_slug ? String(row.reuse_product_slug) : supplierProductSlug(snapshot.name, snapshot.external_id);
    const productId = row.imported_product_id ? String(row.imported_product_id) : null;
    if (productId && row.reuse_product_sku !== undefined && String(row.reuse_product_sku) !== snapshot.sku) errors.push('SKU differs from the rejected product and cannot change.');
    if (seenSkus.has(snapshot.sku)) errors.push('Duplicate SKU inside this batch.');
    if (seenSlugs.has(slug)) errors.push('Duplicate slug inside this batch.');
    seenSkus.add(snapshot.sku);
    seenSlugs.add(slug);
    const owners = await client.query<{ id: string; key: string }>(`SELECT id,'sku' key FROM products WHERE sku=$1
      UNION ALL SELECT id,'slug' key FROM products WHERE slug=$2`, [snapshot.sku, slug]);
    if (owners.rows.some((owner) => owner.key === 'sku' && owner.id !== productId)) errors.push('SKU already belongs to another product.');
    if (owners.rows.some((owner) => owner.key === 'slug' && owner.id !== productId)) errors.push('Slug already belongs to another product.');
    entries.push({ row, snapshot, hash: supplierSnapshotHash(snapshot), errors, slug, productId });
  }
  return entries;
}

async function stagePublicationProduct(client: PoolClient, organizationId: string, source: string, entry: BatchEntry): Promise<string> {
  const snapshot = entry.snapshot;
  if (entry.productId) {
    const reused = await client.query<{ id: string }>(`UPDATE products SET source_updated_at=$1,source_sync_status='current',purchase_mode='external',
      external_purchase_url=$2,name=$3,category=$4,botanical_name=$5,description=$6,origin_country=$7,packet_quantity=$8,
      price_cents=$9,compare_at_price_cents=$10,currency=$11,stock_quantity=$12,image_url=$13,compliance_flag=$14,
      status='pending_review',updated_at=now()
      WHERE id=$15 AND status='rejected' AND organization_id=$16 AND external_source=$17 AND external_id=$18 AND sku=$19 RETURNING id`,
    [snapshot.source_updated_at, snapshot.external_purchase_url, snapshot.name, snapshot.category, snapshot.botanical_name,
      snapshot.description, snapshot.origin_country, snapshot.packet_quantity, snapshot.price_cents, snapshot.compare_at_price_cents,
      snapshot.currency, snapshot.stock_quantity, snapshot.image_url, snapshot.compliance_flag, entry.productId, organizationId,
      source, snapshot.external_id, snapshot.sku]);
    if (!reused.rows[0]) throw new Error('A rejected product cannot be safely reused.');
    return reused.rows[0].id;
  }
  const inserted = await client.query<{ id: string }>(`INSERT INTO products
    (organization_id,external_source,external_id,source_updated_at,source_sync_status,purchase_mode,external_purchase_url,
     sku,name,slug,category,botanical_name,description,origin_country,packet_quantity,price_cents,compare_at_price_cents,
     currency,stock_quantity,image_url,compliance_flag,status)
    VALUES($1,$2,$3,$4,'current','external',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,'pending_review') RETURNING id`,
  [organizationId, source, snapshot.external_id, snapshot.source_updated_at, snapshot.external_purchase_url, snapshot.sku,
    snapshot.name, entry.slug, snapshot.category, snapshot.botanical_name, snapshot.description, snapshot.origin_country,
    snapshot.packet_quantity, snapshot.price_cents, snapshot.compare_at_price_cents, snapshot.currency,
    snapshot.stock_quantity, snapshot.image_url, snapshot.compliance_flag]);
  return inserted.rows[0].id;
}

export async function prepareSupplierBatch(options: {
  organizationSlug?: string; source?: string; limit?: number; batchType?: SupplierBatchType; commit?: boolean;
} = {}): Promise<SupplierBatchSummary> {
  const organizationSlug = options.organizationSlug ?? 'oreshka-seeds';
  const limit = options.limit ?? SUPPLIER_BATCH_LIMIT;
  const batchType = options.batchType ?? 'publication';
  const source = validateOptions(options.source ?? 'oreshka-meta', limit, batchType);
  const client = await pool.connect();
  try {
    const organization = await client.query<{ id: string }>("SELECT id FROM organizations WHERE slug=$1 AND status='approved'", [organizationSlug]);
    if (!organization.rows[0]) throw new Error('Approved supplier organization was not found.');
    const organizationId = organization.rows[0].id;
    const openScope = `${organizationId}:${source}`;
    const open = await client.query('SELECT id FROM supplier_publication_batches WHERE open_scope=$1', [openScope]);
    if (open.rows[0]) throw new Error('An open batch already exists for this organization and source.');
    const entries = await buildEntries(client, await candidates(client, organizationId, source, limit, batchType));
    const report = batchReport(entries, batchType);
    const snapshotHash = createHash('sha256').update(entries.map((entry) => entry.hash).join('')).digest('hex');
    const summary: SupplierBatchSummary = {
      mode: options.commit ? 'pending-review-write' : 'dry-run', batch_type: batchType, source, organization: organizationSlug,
      selected: entries.length, limit, snapshot_hash: snapshotHash, report, batch_id: null,
    };
    if (!options.commit || !entries.length) return summary;

    await client.query('BEGIN');
    try {
      const batch = await client.query<{ id: string }>(`INSERT INTO supplier_publication_batches
        (organization_id,source,batch_type,open_scope,item_count,error_count,snapshot_hash,report)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb) RETURNING id`,
      [organizationId, source, batchType, openScope, entries.length, Number(report.error_count), snapshotHash, JSON.stringify(report)]);
      const batchId = batch.rows[0].id;
      for (let index = 0; index < entries.length; index += 1) {
        const entry = entries[index];
        const productId = batchType === 'publication'
          ? await stagePublicationProduct(client, organizationId, source, entry)
          : entry.productId;
        if (!productId) throw new Error('A content-review item is missing its product.');
        if (batchType === 'publication') {
          await client.query("UPDATE supplier_catalog_items SET validation_status='imported',imported_product_id=$1 WHERE id=$2", [productId, entry.row.id]);
        }
        await client.query(`INSERT INTO supplier_publication_batch_items
          (batch_id,supplier_catalog_item_id,product_id,position,action,snapshot,snapshot_hash,validation_errors)
          VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8::jsonb)`,
        [batchId, entry.row.id, productId, index + 1, batchType === 'publication' ? 'create' : 'update',
          JSON.stringify(entry.snapshot), entry.hash, entry.errors.length ? JSON.stringify(entry.errors) : null]);
      }
      await client.query(`INSERT INTO audit_events(actor_user_id,entity_type,entity_id,event_name,payload)
        VALUES(NULL,'supplier_publication_batch',$1,'supplier_batch.prepared',$2::jsonb)`,
      [batchId, JSON.stringify({ type: batchType, count: entries.length, snapshot_hash: snapshotHash })]);
      await client.query('COMMIT');
      summary.batch_id = batchId;
      return summary;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  } finally {
    client.release();
  }
}

export async function moderateSupplierBatch(batchId: string, decision: 'approve' | 'reject', actorUserId: string): Promise<void> {
  if (!/^\d+$/.test(batchId)) throw Object.assign(new Error('Supplier batch not found.'), { statusCode: 404 });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    try {
      const batchResult = await client.query<Record<string, unknown>>(
        "SELECT * FROM supplier_publication_batches WHERE id=$1 AND status='pending_review' FOR UPDATE", [batchId],
      );
      const batch = batchResult.rows[0];
      if (!batch) throw Object.assign(new Error('Open supplier batch not found.'), { statusCode: 404 });
      const items = await client.query<Record<string, unknown>>(
        'SELECT * FROM supplier_publication_batch_items WHERE batch_id=$1 ORDER BY position FOR UPDATE', [batchId],
      );
      if (!items.rows.length || items.rows.length !== Number(batch.item_count)) throw Object.assign(new Error('Batch item count is inconsistent.'), { statusCode: 409 });

      if (decision === 'approve') {
        if (Number(batch.error_count) > 0) throw Object.assign(new Error('A batch with validation errors cannot be approved.'), { statusCode: 409 });
        const hashes: string[] = [];
        for (const item of items.rows) {
          if (item.validation_errors) throw Object.assign(new Error('A batch item has validation errors.'), { statusCode: 409 });
          const currentResult = await client.query<Record<string, unknown>>('SELECT * FROM supplier_catalog_items WHERE id=$1 FOR UPDATE', [item.supplier_catalog_item_id]);
          const current = currentResult.rows[0];
          if (!current) throw Object.assign(new Error('A staged supplier item is missing.'), { statusCode: 409 });
          const snapshot = supplierSnapshotFromRow(current);
          const hash = supplierSnapshotHash(snapshot);
          if (hash !== item.snapshot_hash) throw Object.assign(new Error('The supplier snapshot changed. Prepare a new batch.'), { statusCode: 409 });
          hashes.push(hash);
          const productResult = await client.query<Record<string, unknown>>('SELECT * FROM products WHERE id=$1 FOR UPDATE', [item.product_id]);
          const product = productResult.rows[0];
          if (!product) throw Object.assign(new Error('A batch product is missing.'), { statusCode: 409 });
          if (item.action === 'create') {
            const activated = await client.query(`UPDATE products SET status='active',source_sync_status='current',publication_batch_id=$1,updated_at=now()
              WHERE id=$2 AND status='pending_review' RETURNING id`, [batchId, product.id]);
            if (!activated.rows[0]) throw Object.assign(new Error('A batch product left pending review.'), { statusCode: 409 });
          } else {
            if (product.status !== 'active' || product.purchase_mode !== 'external' || product.source_sync_status !== 'review_required') {
              throw Object.assign(new Error('A content-review product changed state.'), { statusCode: 409 });
            }
            await client.query(`UPDATE products SET source_updated_at=$1,source_sync_status='current',external_purchase_url=$2,
              sku=$3,name=$4,slug=$5,category=$6,botanical_name=$7,description=$8,origin_country=$9,packet_quantity=$10,
              price_cents=$11,compare_at_price_cents=$12,currency=$13,stock_quantity=$14,image_url=$15,compliance_flag=$16,
              publication_batch_id=$17,updated_at=now() WHERE id=$18`,
            [snapshot.source_updated_at, snapshot.external_purchase_url, snapshot.sku, snapshot.name,
              supplierProductSlug(snapshot.name, snapshot.external_id), snapshot.category, snapshot.botanical_name,
              snapshot.description, snapshot.origin_country, snapshot.packet_quantity, snapshot.price_cents,
              snapshot.compare_at_price_cents, snapshot.currency, snapshot.stock_quantity, snapshot.image_url,
              snapshot.compliance_flag, batchId, product.id]);
            await client.query("UPDATE supplier_catalog_items SET validation_status='imported' WHERE id=$1", [current.id]);
          }
        }
        const currentBatchHash = createHash('sha256').update(hashes.join('')).digest('hex');
        if (currentBatchHash !== batch.snapshot_hash) throw Object.assign(new Error('The batch checksum is inconsistent.'), { statusCode: 409 });
        await client.query(`UPDATE supplier_publication_batches SET status='approved',open_scope=NULL,approved_by_user_id=$1,
          reviewed_at=now(),sitemap_status='pending',sitemap_error=NULL WHERE id=$2`, [actorUserId, batchId]);
      } else {
        for (const item of items.rows) {
          if (item.action !== 'create') continue;
          await client.query("UPDATE products SET status='rejected',publication_batch_id=$1,updated_at=now() WHERE id=$2 AND status='pending_review'", [batchId, item.product_id]);
          await client.query("UPDATE supplier_catalog_items SET validation_status='ready' WHERE id=$1 AND imported_product_id=$2", [item.supplier_catalog_item_id, item.product_id]);
        }
        await client.query(`UPDATE supplier_publication_batches SET status='rejected',open_scope=NULL,approved_by_user_id=$1,
          reviewed_at=now() WHERE id=$2`, [actorUserId, batchId]);
      }
      await client.query(`INSERT INTO audit_events(actor_user_id,entity_type,entity_id,event_name,payload)
        VALUES($1,'supplier_publication_batch',$2,$3,$4::jsonb)`,
      [actorUserId, batchId, `supplier_batch.${decision === 'approve' ? 'approved' : 'rejected'}`,
        JSON.stringify({ count: items.rows.length, snapshot_hash: batch.snapshot_hash })]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  } finally {
    client.release();
  }
}
