import { describe, expect, it } from 'vitest';
import {
  catalogAcceptanceRate,
  decodeCatalogBody,
  externalUrlWithTracking,
  normalizeOreshkaRow,
  supplierProductSlug,
  supplierSnapshotFromRow,
  supplierSnapshotHash,
  validateSupplierCatalog,
} from '../../src/domain/supplier-catalog.js';

const rawOreshka = {
  id: '159115434118',
  title: 'Abies koreana — 10 Seeds',
  description: 'Fresh Korean fir seeds for collectors.',
  availability: 'in stock',
  inventory: '4',
  price: '12.50 EUR',
  sale_price: '10.00 EUR',
  link: 'https://oreshka-seeds.com/product/korean-fir?variant=1',
  image_link: 'https://static.tildacdn.com/stor/image.jpg',
  brand: 'Oreshka',
  item_group_id: '159115434118',
  product_type: 'Tree Seeds > Coniferous',
};

describe('supplier catalog boundary', () => {
  it('normalizes an Oreshka feed row without a time-dependent snapshot field', () => {
    expect(normalizeOreshkaRow(rawOreshka)).toMatchObject({
      external_id: '159115434118',
      sku: 'ORESHKA-159115434118',
      category: 'conifers',
      price_cents: 1000,
      compare_at_price_cents: 1250,
      stock_quantity: 4,
      packet_quantity: '10 Seeds',
      compliance_flag: 'phytosanitary_required',
      source_updated_at: null,
    });
  });

  it('rejects product and image links outside the allowlist', () => {
    expect(() => normalizeOreshkaRow({ ...rawOreshka, link: 'https://example.com/product' })).toThrow('Product link host is not allowed.');
    expect(() => normalizeOreshkaRow({ ...rawOreshka, image_link: 'https://oreshka-seeds.com/image.jpg' })).toThrow('Image host is not allowed.');
    expect(() => normalizeOreshkaRow({ ...rawOreshka, link: 'https://user:secret@oreshka-seeds.com/product' })).toThrow('Product link host is not allowed.');
  });

  it('parses quoted CSV and records malformed rows instead of hiding them', () => {
    const header = 'id,title,description,availability,inventory,price,sale_price,link,image_link,brand,item_group_id,product_type';
    const valid = '159115434118,"Abies, koreana — 10 Seeds","Fresh, viable seeds",in stock,4,12.50 EUR,10.00 EUR,https://oreshka-seeds.com/product/korean-fir,https://static.tildacdn.com/stor/image.jpg,Oreshka,159115434118,Tree Seeds > Coniferous';
    const malformed = '2,Too,few,columns';
    const decoded = decodeCatalogBody(`${header}\n${valid}\n${malformed}\n`, 'feed.csv');
    const result = validateSupplierCatalog(decoded);
    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0].name).toBe('Abies, koreana — 10 Seeds');
    expect(result.rejected).toEqual([{ index: 1, external_id: '2', error: 'CSV column count does not match the header.' }]);
  });

  it('rejects duplicate external IDs and exposes the 99 percent gate input', () => {
    const item = normalizeOreshkaRow(rawOreshka);
    const result = validateSupplierCatalog([item, item]);
    expect(result.accepted).toHaveLength(1);
    expect(result.rejected[0].error).toBe('external_id is duplicated in this feed.');
    expect(catalogAcceptanceRate(100, 98)).toBe(0.98);
    expect(catalogAcceptanceRate(100, 99)).toBe(0.99);
  });

  it('adds stable referral tracking while preserving existing parameters', () => {
    const tracked = new URL(externalUrlWithTracking('https://oreshka-seeds.com/product/a?variant=4'));
    expect(tracked.searchParams.get('variant')).toBe('4');
    expect(tracked.searchParams.get('utm_source')).toBe('seedexchange.online');
    expect(tracked.searchParams.get('utm_medium')).toBe('referral');
    expect(tracked.searchParams.get('utm_campaign')).toBe('oreshka_catalog');
  });

  it('builds a deterministic moderation snapshot and bounded product slug', () => {
    const item = normalizeOreshkaRow(rawOreshka);
    const snapshot = supplierSnapshotFromRow(item);
    expect(snapshot.stock_quantity).toBe(1);
    expect(snapshot.external_purchase_url).toContain('utm_source=seedexchange.online');
    expect(supplierSnapshotHash(snapshot)).toBe(supplierSnapshotHash({ ...snapshot }));
    const slug = supplierProductSlug('Very long seed name '.repeat(30), item.external_id);
    expect(slug.length).toBeLessThanOrEqual(190);
    expect(slug).toMatch(/-oreshka-159115434118$/);
  });
});
