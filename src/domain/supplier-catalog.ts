import { createHash } from 'node:crypto';

export const PRODUCT_CATEGORIES = ['conifers', 'aquatic', 'fruit', 'ornamental', 'herbs', 'flowers', 'vegetables', 'other'] as const;
export const ORESHKA_PRODUCT_HOST = 'oreshka-seeds.com';
export const ORESHKA_IMAGE_HOST = 'static.tildacdn.com';
export const ORESHKA_PILOT_IDS = [
  '159115434118', '192866202206', '900262668943', '310050436671', '810978983421',
  '408921326416', '979869762871', '996414655281', '144331266871', '608218012781',
] as const;

export type ProductCategory = typeof PRODUCT_CATEGORIES[number];
export type ComplianceFlag = 'none' | 'phytosanitary_required' | 'restricted';

export type NormalizedCatalogItem = {
  external_id: string;
  item_group_id: string | null;
  sku: string;
  name: string;
  description: string;
  category: ProductCategory;
  source_category: string | null;
  botanical_name: string | null;
  price_cents: number;
  compare_at_price_cents: number | null;
  currency: string;
  stock_quantity: number;
  packet_quantity: string | null;
  origin_country: string | null;
  compliance_flag: ComplianceFlag;
  image_urls: string[];
  external_purchase_url: string | null;
  source_updated_at: string | null;
};

export type CatalogRejection = { index: number; external_id: string | null; error: string };
export type SupplierSnapshot = {
  external_id: string; sku: string; name: string; description: string; category: ProductCategory;
  botanical_name: string | null; price_cents: number; compare_at_price_cents: number | null;
  currency: string; stock_quantity: number; packet_quantity: string | null; origin_country: string | null;
  compliance_flag: ComplianceFlag; image_url: string; external_purchase_url: string; source_updated_at: string | null;
};

function textValue(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  return value === null || value === undefined ? '' : String(value).trim();
}

function requiredText(input: Record<string, unknown>, key: string): string {
  const value = textValue(input, key);
  if (!value) throw new Error(`${key} is required.`);
  return value;
}

function bounded(value: string, maximum: number): string {
  return value.slice(0, maximum);
}

function integerValue(value: unknown, key: string, minimum: number): number {
  const raw = value === null || value === undefined ? '' : String(value).trim();
  if (!/^\d+$/.test(raw)) throw new Error(`${key} must be an integer.`);
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) throw new Error(`${key} must be at least ${minimum}.`);
  return parsed;
}

export function isHttpsUrl(value: string, requiredHost?: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && (!requiredHost || url.hostname.toLowerCase() === requiredHost.toLowerCase());
  } catch {
    return false;
  }
}

export function parseFeedPrice(value: string): { cents: number; currency: string } {
  const match = value.trim().match(/^(\d+(?:\.\d{1,2})?)\s+([A-Za-z]{3})$/);
  if (!match) throw new Error('Feed price is invalid.');
  const cents = Math.round(Number(match[1]) * 100);
  if (!Number.isSafeInteger(cents) || cents < 1) throw new Error('Feed price must be positive.');
  return { cents, currency: match[2].toUpperCase() };
}

export function oreshkaCategory(sourceCategory: string): ProductCategory {
  switch (sourceCategory.replace(/\\ /g, ' ').trim()) {
    case 'Aquatic plants': return 'aquatic';
    case 'Tree Seeds > Coniferous': return 'conifers';
    case 'Fruit':
    case 'Groundnut':
    case 'Tree Seeds > Nut-bearing': return 'fruit';
    case 'Vegetable': return 'vegetables';
    case 'Herbs': return 'herbs';
    case 'Flower': return 'flowers';
    case 'Tree Seeds > Deciduous':
    case 'Tree Seeds > Palm seeds':
    case 'Lianas':
    case 'Succulents & Cacti': return 'ornamental';
    default: return 'other';
  }
}

export function normalizeCatalogItem(input: Record<string, unknown>): NormalizedCatalogItem {
  const externalId = bounded(requiredText(input, 'external_id'), 190);
  const priceCents = integerValue(input.price_cents, 'price_cents', 1);
  const stockQuantity = integerValue(input.stock_quantity, 'stock_quantity', 0);
  const compareRaw = textValue(input, 'compare_at_price_cents');
  const compareAt = compareRaw ? integerValue(compareRaw, 'compare_at_price_cents', priceCents) : null;
  const currency = requiredText(input, 'currency').toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error('currency must be an ISO 4217 code.');
  const category = textValue(input, 'category') || 'other';
  if (!(PRODUCT_CATEGORIES as readonly string[]).includes(category)) throw new Error('category is not supported.');
  const compliance = textValue(input, 'compliance_flag') || 'none';
  if (!['none', 'phytosanitary_required', 'restricted'].includes(compliance)) throw new Error('compliance_flag is not supported.');

  const rawImages = input.image_urls ?? [];
  const images = typeof rawImages === 'string' ? (rawImages ? [rawImages] : []) : rawImages;
  if (!Array.isArray(images) || images.some((image) => typeof image !== 'string' || !isHttpsUrl(image))) {
    throw new Error('Every image URL must use HTTPS.');
  }
  const purchaseUrl = textValue(input, 'external_purchase_url');
  if (purchaseUrl && !isHttpsUrl(purchaseUrl)) throw new Error('external_purchase_url must use HTTPS.');
  const sourceUpdated = textValue(input, 'source_updated_at');
  if (sourceUpdated && Number.isNaN(Date.parse(sourceUpdated))) throw new Error('source_updated_at is invalid.');

  return {
    external_id: externalId,
    item_group_id: bounded(textValue(input, 'item_group_id'), 190) || null,
    sku: bounded(requiredText(input, 'sku'), 100),
    name: bounded(requiredText(input, 'name'), 255),
    description: requiredText(input, 'description'),
    category: category as ProductCategory,
    source_category: bounded(textValue(input, 'source_category'), 255) || null,
    botanical_name: textValue(input, 'botanical_name') || null,
    price_cents: priceCents,
    compare_at_price_cents: compareAt,
    currency,
    stock_quantity: stockQuantity,
    packet_quantity: bounded(textValue(input, 'packet_quantity'), 120) || null,
    origin_country: bounded(textValue(input, 'origin_country'), 100) || null,
    compliance_flag: compliance as ComplianceFlag,
    image_urls: images as string[],
    external_purchase_url: purchaseUrl || null,
    source_updated_at: sourceUpdated ? new Date(sourceUpdated).toISOString() : null,
  };
}

export function normalizeOreshkaRow(row: Record<string, unknown>): NormalizedCatalogItem {
  for (const key of ['id', 'title', 'description', 'availability', 'inventory', 'price', 'link', 'image_link', 'item_group_id', 'product_type']) requiredText(row, key);
  const externalId = requiredText(row, 'id');
  if (!/^\d+$/.test(externalId)) throw new Error('id must be numeric.');
  const availability = requiredText(row, 'availability').toLowerCase();
  if (!['in stock', 'out of stock'].includes(availability)) throw new Error('availability is not supported.');
  const base = parseFeedPrice(requiredText(row, 'price'));
  const saleRaw = textValue(row, 'sale_price');
  const sale = saleRaw ? parseFeedPrice(saleRaw) : null;
  if (sale && sale.currency !== base.currency) throw new Error('Sale currency differs from base currency.');
  const current = sale?.cents ?? base.cents;
  const link = requiredText(row, 'link');
  const image = requiredText(row, 'image_link');
  if (!isHttpsUrl(link, ORESHKA_PRODUCT_HOST)) throw new Error('Product link host is not allowed.');
  if (!isHttpsUrl(image, ORESHKA_IMAGE_HOST)) throw new Error('Image host is not allowed.');
  const title = requiredText(row, 'title');
  const packet = title.match(/—\s*([0-9][^—]{0,50})$/u)?.[1]?.trim() ?? null;
  const sourceCategory = requiredText(row, 'product_type').replace(/\\ /g, ' ');
  return normalizeCatalogItem({
    external_id: externalId,
    item_group_id: requiredText(row, 'item_group_id'),
    sku: `ORESHKA-${externalId}`,
    name: title,
    description: requiredText(row, 'description'),
    category: oreshkaCategory(sourceCategory),
    source_category: sourceCategory,
    price_cents: current,
    compare_at_price_cents: base.cents > current ? base.cents : null,
    currency: base.currency,
    stock_quantity: availability === 'in stock' ? Math.max(1, integerValue(row.inventory, 'inventory', 0)) : 0,
    packet_quantity: packet,
    compliance_flag: 'phytosanitary_required',
    image_urls: [image],
    external_purchase_url: link,
    source_updated_at: null,
  });
}

function parseCsv(body: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const input = body.replace(/^\uFEFF/, '');
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') { field += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; }
    else field += char;
  }
  if (quoted) throw new Error('CSV contains an unclosed quoted field.');
  if (field || row.length) { row.push(field.replace(/\r$/, '')); rows.push(row); }
  return rows.filter((entry) => !(entry.length === 1 && entry[0] === ''));
}

export function decodeCatalogBody(body: string, location: string): unknown[] {
  if (!body.trim()) throw new Error('Supplier feed is empty.');
  const isCsv = new URL(location, 'https://local.invalid').pathname.toLowerCase().endsWith('.csv') || body.replace(/^\uFEFF/, '').trimStart().startsWith('id,title,');
  if (!isCsv) {
    const decoded: unknown = JSON.parse(body);
    const items = decoded && typeof decoded === 'object' && !Array.isArray(decoded) && Array.isArray((decoded as { items?: unknown }).items)
      ? (decoded as { items: unknown[] }).items
      : decoded;
    if (!Array.isArray(items)) throw new Error('Supplier feed must be a JSON array or an object with an items array.');
    return items;
  }
  const rows = parseCsv(body);
  const header = rows.shift();
  if (!header) throw new Error('CSV header is missing.');
  const required = ['id', 'title', 'description', 'availability', 'inventory', 'price', 'sale_price', 'link', 'image_link', 'brand', 'item_group_id', 'product_type'];
  if (required.some((column) => !header.includes(column))) throw new Error('Oreshka CSV columns are incomplete.');
  return rows.map((values) => {
    const externalId = values[header.indexOf('id')] || null;
    if (values.length !== header.length) return { external_id: externalId, __parse_error: 'CSV column count does not match the header.' };
    const raw = Object.fromEntries(header.map((key, index) => [key, values[index]]));
    try { return normalizeOreshkaRow(raw); }
    catch (error) { return { external_id: externalId, __parse_error: error instanceof Error ? error.message : String(error) }; }
  });
}

export function validateSupplierCatalog(items: unknown[]): { accepted: NormalizedCatalogItem[]; rejected: CatalogRejection[] } {
  const accepted: NormalizedCatalogItem[] = [];
  const rejected: CatalogRejection[] = [];
  const seen = new Set<string>();
  items.forEach((item, index) => {
    try {
      if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Item must be an object.');
      const input = item as Record<string, unknown>;
      if (input.__parse_error) throw new Error(String(input.__parse_error));
      const normalized = normalizeCatalogItem(input);
      if (seen.has(normalized.external_id)) throw new Error('external_id is duplicated in this feed.');
      seen.add(normalized.external_id);
      accepted.push(normalized);
    } catch (error) {
      const record = item && typeof item === 'object' && !Array.isArray(item) ? item as Record<string, unknown> : null;
      rejected.push({ index, external_id: record?.external_id ? String(record.external_id) : null, error: error instanceof Error ? error.message : String(error) });
    }
  });
  return { accepted, rejected };
}

export function externalUrlWithTracking(value: string): string {
  if (!isHttpsUrl(value, ORESHKA_PRODUCT_HOST)) throw new Error('External product link host is not allowed.');
  const url = new URL(value);
  url.searchParams.set('utm_source', 'seedexchange.online');
  url.searchParams.set('utm_medium', 'referral');
  url.searchParams.set('utm_campaign', 'oreshka_catalog');
  return url.toString();
}

export function catalogAcceptanceRate(received: number, accepted: number): number {
  return received ? accepted / received : 0;
}

export function supplierProductSlug(name: string, externalId: string): string {
  const base = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'seed';
  const suffix = `-oreshka-${externalId}`;
  return `${base.slice(0, Math.max(1, 190 - suffix.length))}${suffix}`;
}

export function supplierSnapshotFromRow(row: Record<string, unknown>): SupplierSnapshot {
  const rawImages = Array.isArray(row.image_urls) ? row.image_urls : [];
  const purchaseUrl = String(row.external_purchase_url ?? '');
  return {
    external_id: String(row.external_id),
    sku: String(row.sku),
    name: String(row.name),
    description: String(row.description),
    category: String(row.category) as ProductCategory,
    botanical_name: row.botanical_name ? String(row.botanical_name) : null,
    price_cents: Number(row.price_cents),
    compare_at_price_cents: row.compare_at_price_cents === null || row.compare_at_price_cents === undefined ? null : Number(row.compare_at_price_cents),
    currency: String(row.currency).toUpperCase(),
    stock_quantity: Number(row.stock_quantity) > 0 ? 1 : 0,
    packet_quantity: row.packet_quantity ? String(row.packet_quantity) : null,
    origin_country: row.origin_country ? String(row.origin_country) : null,
    compliance_flag: String(row.compliance_flag) as ComplianceFlag,
    image_url: rawImages[0] ? String(rawImages[0]) : '',
    external_purchase_url: externalUrlWithTracking(purchaseUrl),
    source_updated_at: row.source_updated_at ? new Date(String(row.source_updated_at)).toISOString() : null,
  };
}

export function supplierSnapshotHash(snapshot: SupplierSnapshot): string {
  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
}

export function supplierSnapshotErrors(snapshot: SupplierSnapshot): string[] {
  const errors: string[] = [];
  if (!/^[A-Z]{3}$/.test(snapshot.currency)) errors.push('Invalid currency.');
  if (!Number.isSafeInteger(snapshot.price_cents) || snapshot.price_cents < 1) errors.push('Price must be positive.');
  if (!(PRODUCT_CATEGORIES as readonly string[]).includes(snapshot.category)) errors.push('Unsupported category.');
  if (!isHttpsUrl(snapshot.image_url, ORESHKA_IMAGE_HOST)) errors.push('Image host is not allowed.');
  if (!isHttpsUrl(snapshot.external_purchase_url, ORESHKA_PRODUCT_HOST)) errors.push('Purchase URL host is not allowed.');
  return errors;
}
