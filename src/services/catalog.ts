import { config } from '../config.js';
import { pool } from '../db/pool.js';

export type OrganizationCard = { id: string; name: string; slug: string; type: string; country: string; description: string; specialties: string | null; founder_slot: number | null };
export type ProductCard = { id: string; name: string; botanical_name: string | null; slug: string; category: string | null; price_cents: string; compare_at_price_cents: string | null; currency: string; stock_quantity: number; image_url: string | null; purchase_mode: string; external_purchase_url: string | null; organization_name: string; organization_slug: string };
export type ExchangeCard = { id: string; title: string; species: string | null; quantity_available: string | null; mode: string; description: string; organization_name: string; organization_slug: string };

export async function homeModel() {
  const [counts, organizations, products, exchanges] = await Promise.all([
    pool.query<{ organizations: string; products: string; exchanges: string }>(`SELECT
      (SELECT count(*) FROM organizations WHERE status='approved') organizations,
      (SELECT count(*) FROM products WHERE status='active' AND purchase_mode=ANY($1::text[]) AND (purchase_mode<>'external' OR external_purchase_url~*'^https://')) products,
      (SELECT count(*) FROM exchange_listings WHERE status='active') exchanges`, [config.PUBLIC_PRODUCT_MODES]),
    listOrganizations(3), listProducts({ limit: 4 }), listExchanges(3),
  ]);
  return { stats: counts.rows[0], organizations, products, exchanges };
}

export async function listOrganizations(limit = 48): Promise<OrganizationCard[]> {
  const result = await pool.query<OrganizationCard>(`SELECT o.id,o.name,o.slug,o.type,o.country,o.description,o.specialties,f.slot_number founder_slot
    FROM organizations o LEFT JOIN founder_program_members f ON f.organization_id=o.id AND f.status<>'revoked'
    WHERE o.status='approved' ORDER BY f.slot_number NULLS LAST,o.name LIMIT $1`, [limit]);
  return result.rows;
}

export async function getOrganization(slug: string) {
  const result = await pool.query(`SELECT o.*,f.slot_number founder_slot,
    (SELECT count(*) FROM products p WHERE p.organization_id=o.id AND p.status='active' AND p.purchase_mode=ANY($2::text[]) AND (p.purchase_mode<>'external' OR p.external_purchase_url~*'^https://')) product_count
    FROM organizations o LEFT JOIN founder_program_members f ON f.organization_id=o.id AND f.status<>'revoked'
    WHERE o.slug=$1 AND o.status='approved'`, [slug, config.PUBLIC_PRODUCT_MODES]);
  if (!result.rows[0]) return null;
  const products = await listProducts({ organizationId: result.rows[0].id, limit: 24 });
  return { ...result.rows[0], products };
}

export async function listProducts(options: { q?: string; category?: string; organizationId?: string; limit?: number } = {}): Promise<ProductCard[]> {
  const params: unknown[] = [];
  const where = [`p.status='active'`, `o.status='approved'`];
  params.push(config.PUBLIC_PRODUCT_MODES);
  where.push(`p.purchase_mode=ANY($${params.length}::text[])`);
  where.push(`(p.purchase_mode<>'external' OR p.external_purchase_url~*'^https://')`);
  if (options.q) { params.push(`%${options.q}%`); where.push(`(p.name ILIKE $${params.length} OR p.botanical_name ILIKE $${params.length} OR p.sku ILIKE $${params.length})`); }
  if (options.category) { params.push(options.category); where.push(`p.category=$${params.length}`); }
  if (options.organizationId) { params.push(options.organizationId); where.push(`p.organization_id=$${params.length}`); }
  params.push(options.limit ?? 48);
  const result = await pool.query<ProductCard>(`SELECT p.id,p.name,p.botanical_name,p.slug,p.category,p.price_cents,p.compare_at_price_cents,
    p.currency,p.stock_quantity,p.image_url,p.purchase_mode,p.external_purchase_url,o.name organization_name,o.slug organization_slug
    FROM products p JOIN organizations o ON o.id=p.organization_id WHERE ${where.join(' AND ')}
    ORDER BY p.updated_at DESC,p.id DESC LIMIT $${params.length}`, params);
  return result.rows;
}

export async function getProduct(slug: string) {
  const result = await pool.query(`SELECT p.*,o.name organization_name,o.slug organization_slug,o.payout_policy
    FROM products p JOIN organizations o ON o.id=p.organization_id
    WHERE p.slug=$1 AND p.status='active' AND o.status='approved' AND p.purchase_mode=ANY($2::text[])
    AND (p.purchase_mode<>'external' OR p.external_purchase_url~*'^https://')`, [slug, config.PUBLIC_PRODUCT_MODES]);
  return result.rows[0] ?? null;
}

export async function listExchanges(limit = 48): Promise<ExchangeCard[]> {
  const result = await pool.query<ExchangeCard>(`SELECT x.id,x.title,x.species,x.quantity_available,x.mode,x.description,
    o.name organization_name,o.slug organization_slug FROM exchange_listings x JOIN organizations o ON o.id=x.organization_id
    WHERE x.status='active' AND o.status='approved' ORDER BY x.created_at DESC LIMIT $1`, [limit]);
  return result.rows;
}
