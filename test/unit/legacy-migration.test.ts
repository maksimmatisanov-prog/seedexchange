import { describe, expect, it } from 'vitest';
import {
  DISCOVERY_FORBIDDEN_TARGET_TABLES,
  legacyPlansForScope,
  quoteMysqlIdentifier,
  quotePostgresIdentifier,
  sanitizeLegacyRow,
  validateLegacySourceContract,
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

  it('defines and enforces a required discovery source schema', () => {
    const plans = legacyPlansForScope('discovery');
    expect(plans.every((plan) => (plan.requiredSourceColumns?.length ?? 0) > 0)).toBe(true);
    expect(plans.find((plan) => plan.source === 'media_assets')?.allowedTargetOnlyColumns).toEqual(['sha256']);
    expect(plans.find((plan) => plan.source === 'products')?.allowedTargetOnlyColumns).toEqual(['publication_batch_id']);
    const available = new Set(plans.map((plan) => plan.source));
    const columns = new Map(plans.map((plan) => [plan.source, [...plan.requiredSourceColumns!]]));
    expect(validateLegacySourceContract(plans, available, columns)).toEqual([]);

    available.delete('products');
    columns.set('users', columns.get('users')!.filter((column) => column !== 'email_verified_at'));
    expect(validateLegacySourceContract(plans, available, columns)).toEqual(expect.arrayContaining([
      'Required source table products is missing.',
      'Source table users is missing required columns: email_verified_at.',
    ]));
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
      .toContain('External product URL must be a valid public HTTPS URL.');
    expect(validateDiscoveryRow('products', { purchase_mode: 'external', external_purchase_url: 'https://user:secret@example.com/product' }))
      .toContain('External product URL must be a valid public HTTPS URL.');
    expect(validateDiscoveryRow('products', { purchase_mode: 'external', external_purchase_url: 'https://example.com', image_url: 'https://localhost/image.jpg' }))
      .toContain('External product image URL must be a valid public HTTPS URL.');
    expect(validateDiscoveryRow('products', { purchase_mode: 'external', external_purchase_url: 'https://example.com' })).toEqual([]);
  });
});
