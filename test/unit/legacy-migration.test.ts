import { describe, expect, it } from 'vitest';
import {
  DISCOVERY_FORBIDDEN_TARGET_TABLES,
  legacyPlansForScope,
  quoteMysqlIdentifier,
  quotePostgresIdentifier,
  sanitizeLegacyRow,
  validateDiscoveryRow,
} from '../../src/domain/legacy-migration.js';

describe('two-stage legacy migration contract', () => {
  it('keeps commerce records outside the discovery data scope', () => {
    const plans = legacyPlansForScope('discovery');
    const targets = plans.map((plan) => plan.target);
    expect(targets).toContain('organizations');
    expect(targets).toContain('exchange_listings');
    expect(targets).toContain('supplier_catalog_items');
    expect(targets).not.toContain('orders');
    expect(targets).not.toContain('stripe_events');
    expect(targets).not.toContain('seller_transfers');
    expect(DISCOVERY_FORBIDDEN_TARGET_TABLES).toContain('orders');
  });

  it('uses the correct identifier syntax for each database engine', () => {
    expect(quoteMysqlIdentifier('supplier_catalog_items')).toBe('`supplier_catalog_items`');
    expect(quotePostgresIdentifier('supplier_catalog_items')).toBe('"supplier_catalog_items"');
    expect(() => quoteMysqlIdentifier('products;DROP TABLE users')).toThrow('Unsafe identifier');
  });

  it('selects only external products for discovery', () => {
    const productPlan = legacyPlansForScope('discovery').find((plan) => plan.target === 'products');
    expect(productPlan?.where).toBe("purchase_mode='external'");
    expect(legacyPlansForScope('full').find((plan) => plan.target === 'products')?.where).toBeUndefined();
  });

  it('removes organization payment capabilities during discovery import', () => {
    const sanitized = sanitizeLegacyRow('discovery', 'organizations', {
      id: 7,
      name: 'Supplier',
      marketplace_enabled: 1,
      stripe_account_id: 'acct_private',
      stripe_charges_enabled: 1,
      stripe_payouts_enabled: 1,
    });
    expect(sanitized).toMatchObject({
      id: 7,
      name: 'Supplier',
      marketplace_enabled: false,
      stripe_account_id: null,
      stripe_charges_enabled: false,
      stripe_payouts_enabled: false,
    });
  });

  it('refuses non-external or non-HTTPS products in discovery', () => {
    expect(validateDiscoveryRow('products', { purchase_mode: 'marketplace', external_purchase_url: 'https://example.com' }))
      .toContain('Discovery migration accepts only external products.');
    expect(validateDiscoveryRow('products', { purchase_mode: 'external', external_purchase_url: 'http://example.com' }))
      .toContain('External product URL must use HTTPS.');
    expect(validateDiscoveryRow('products', { purchase_mode: 'external', external_purchase_url: 'https://example.com' })).toEqual([]);
  });
});
