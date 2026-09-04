export type LegacyMigrationScope = 'discovery' | 'full';
export type LegacyTablePlan = { source: string; target: string; where?: string };

function validateIdentifier(value: string): void {
  if (!/^[a-z][a-z0-9_]*$/.test(value)) throw new Error(`Unsafe identifier: ${value}`);
}

export function quoteMysqlIdentifier(value: string): string {
  validateIdentifier(value);
  return `\`${value}\``;
}

export function quotePostgresIdentifier(value: string): string {
  validateIdentifier(value);
  return `"${value}"`;
}

const sharedDiscoveryPlans: LegacyTablePlan[] = [
  { source: 'users', target: 'users' },
  { source: 'organizations', target: 'organizations' },
  { source: 'organization_members', target: 'organization_members' },
  { source: 'founder_program_state', target: 'founder_program_state' },
  { source: 'founder_program_members', target: 'founder_program_members' },
  { source: 'media_assets', target: 'media_assets' },
  { source: 'supplier_catalog_imports', target: 'supplier_catalog_imports' },
  { source: 'supplier_publication_batches', target: 'supplier_publication_batches' },
  { source: 'products', target: 'products', where: "purchase_mode='external'" },
  { source: 'supplier_catalog_items', target: 'supplier_catalog_items' },
  { source: 'supplier_publication_batch_items', target: 'supplier_publication_batch_items' },
  { source: 'exchange_listings', target: 'exchange_listings' },
  { source: 'organization_channels', target: 'organization_channels' },
  { source: 'conversations', target: 'conversations' },
  { source: 'conversation_messages', target: 'conversation_messages' },
  { source: 'audit_events', target: 'audit_events' },
];

const fullPlans: LegacyTablePlan[] = [
  { source: 'users', target: 'users' },
  { source: 'organizations', target: 'organizations' },
  { source: 'organization_members', target: 'organization_members' },
  { source: 'founder_program_state', target: 'founder_program_state' },
  { source: 'founder_program_members', target: 'founder_program_members' },
  { source: 'media_assets', target: 'media_assets' },
  { source: 'shipping_zones', target: 'shipping_zones' },
  { source: 'seller_shipping_zones', target: 'seller_shipping_zones' },
  { source: 'supplier_catalog_imports', target: 'supplier_catalog_imports' },
  { source: 'supplier_publication_batches', target: 'supplier_publication_batches' },
  { source: 'products', target: 'products' },
  { source: 'supplier_catalog_items', target: 'supplier_catalog_items' },
  { source: 'supplier_publication_batch_items', target: 'supplier_publication_batch_items' },
  { source: 'exchange_listings', target: 'exchange_listings' },
  { source: 'orders', target: 'orders' },
  { source: 'seller_orders', target: 'seller_orders' },
  { source: 'order_items', target: 'order_items' },
  { source: 'inventory_reservations', target: 'inventory_reservations' },
  { source: 'stripe_events', target: 'stripe_events' },
  { source: 'seller_transfers', target: 'seller_transfers' },
  { source: 'delivery_cases', target: 'delivery_cases' },
  { source: 'favorites', target: 'favorites' },
  { source: 'collection_items', target: 'collection_items' },
  { source: 'growth_journal_entries', target: 'growth_journal_entries' },
  { source: 'reviews', target: 'reviews' },
  { source: 'review_responses', target: 'review_responses' },
  { source: 'organization_channels', target: 'organization_channels' },
  { source: 'conversations', target: 'conversations' },
  { source: 'conversation_messages', target: 'conversation_messages' },
  { source: 'reports', target: 'reports' },
  { source: 'notifications', target: 'notifications' },
  { source: 'point_ledger', target: 'point_ledger' },
  { source: 'achievement_unlocks', target: 'achievement_unlocks' },
  { source: 'audit_events', target: 'audit_events' },
  { source: 'outbox_messages', target: 'outbox_messages', where: "status IN ('sent','failed')" },
];

export const DISCOVERY_FORBIDDEN_TARGET_TABLES = [
  'shipping_zones', 'seller_shipping_zones', 'orders', 'seller_orders', 'order_items', 'inventory_reservations',
  'stripe_events', 'seller_transfers', 'delivery_cases', 'reviews', 'review_responses',
] as const;

export function legacyPlansForScope(scope: LegacyMigrationScope): LegacyTablePlan[] {
  return (scope === 'discovery' ? sharedDiscoveryPlans : fullPlans).map((plan) => ({ ...plan }));
}

export function sanitizeLegacyRow(scope: LegacyMigrationScope, target: string, row: Record<string, unknown>): Record<string, unknown> {
  if (scope !== 'discovery' || target !== 'organizations') return { ...row };
  return {
    ...row,
    marketplace_enabled: false,
    stripe_account_id: null,
    stripe_charges_enabled: false,
    stripe_payouts_enabled: false,
  };
}

export function validateDiscoveryRow(target: string, row: Record<string, unknown>): string[] {
  if (target !== 'products') return [];
  const errors: string[] = [];
  if (row.purchase_mode !== 'external') errors.push('Discovery migration accepts only external products.');
  const url = String(row.external_purchase_url ?? '');
  try {
    if (new URL(url).protocol !== 'https:') errors.push('External product URL must use HTTPS.');
  } catch {
    errors.push('External product URL must be valid.');
  }
  return errors;
}
