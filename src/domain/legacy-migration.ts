import { isExternalHttpsUrl } from './public-url.js';

export type LegacyMigrationScope = 'discovery' | 'full';
export type LegacyTablePlan = {
  source: string;
  target: string;
  where?: string;
  requiredSourceColumns?: readonly string[];
  allowedTargetOnlyColumns?: readonly string[];
};

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
  { source: 'users', target: 'users', requiredSourceColumns: ['id','email','email_verified_at','password_hash','last_login_at','role','created_at'] },
  { source: 'organizations', target: 'organizations', requiredSourceColumns: ['id','type','name','slug','country','country_code','region','description','specialties','contact_url','website_url','status','seller_status','marketplace_enabled','stripe_account_id','stripe_charges_enabled','stripe_payouts_enabled','commission_bps','payout_policy','verified_at','profile_updated_at','created_at'] },
  { source: 'organization_members', target: 'organization_members', requiredSourceColumns: ['organization_id','user_id','role'] },
  { source: 'founder_program_state', target: 'founder_program_state', requiredSourceColumns: ['id','current_slot','updated_at'] },
  { source: 'founder_program_members', target: 'founder_program_members', requiredSourceColumns: ['organization_id','slot_number','status','awarded_at','marketplace_activated_at','rate_expires_at','revoked_at','revoked_by_user_id','founder_commission_bps'] },
  { source: 'media_assets', target: 'media_assets', requiredSourceColumns: ['id','organization_id','uploaded_by_user_id','kind','origin','source_url','is_active','storage_key','mime_type','byte_size','width_px','height_px','created_at'], allowedTargetOnlyColumns: ['sha256'] },
  { source: 'supplier_catalog_imports', target: 'supplier_catalog_imports', requiredSourceColumns: ['id','organization_id','source','status','accepted_count','rejected_count','stale_count','report','started_at','completed_at'] },
  { source: 'supplier_publication_batches', target: 'supplier_publication_batches', requiredSourceColumns: ['id','organization_id','source','batch_type','status','open_scope','item_count','error_count','snapshot_hash','report','sitemap_status','sitemap_error','sitemap_current_at','created_by_user_id','approved_by_user_id','created_at','reviewed_at'] },
  { source: 'products', target: 'products', where: "purchase_mode='external'", requiredSourceColumns: ['id','organization_id','external_source','external_id','source_updated_at','source_sync_status','purchase_mode','external_purchase_url','sku','name','botanical_name','slug','category','description','origin_country','packet_quantity','germination_notes','hardiness_zone','price_cents','compare_at_price_cents','currency','stock_quantity','image_url','primary_media_id','compliance_flag','status','created_at','updated_at'], allowedTargetOnlyColumns: ['publication_batch_id'] },
  { source: 'supplier_catalog_items', target: 'supplier_catalog_items', requiredSourceColumns: ['id','organization_id','source','external_id','item_group_id','sku','name','description','category','source_category','botanical_name','price_cents','compare_at_price_cents','currency','stock_quantity','packet_quantity','origin_country','compliance_flag','image_urls','external_purchase_url','source_updated_at','validation_status','validation_errors','payload','first_seen_at','last_seen_at','imported_product_id'] },
  { source: 'supplier_publication_batch_items', target: 'supplier_publication_batch_items', requiredSourceColumns: ['id','batch_id','supplier_catalog_item_id','product_id','position','action','snapshot','snapshot_hash','validation_errors','created_at'] },
  { source: 'exchange_listings', target: 'exchange_listings', requiredSourceColumns: ['id','organization_id','title','species','variety','category','origin_country','quantity_available','wants','contact_url','description','mode','status','completed_at','created_at'] },
  { source: 'organization_channels', target: 'organization_channels', requiredSourceColumns: ['id','organization_id','channel_type','label','url','is_verified','created_at','updated_at'] },
  { source: 'conversations', target: 'conversations', requiredSourceColumns: ['id','organization_id','buyer_user_id','archived_by_buyer','archived_by_organization','buyer_blocked_at','organization_blocked_at','last_message_at','created_at','updated_at'] },
  { source: 'conversation_messages', target: 'conversation_messages', requiredSourceColumns: ['id','conversation_id','sender_user_id','body','read_at','created_at'] },
  { source: 'audit_events', target: 'audit_events', requiredSourceColumns: ['id','actor_user_id','entity_type','entity_id','event_name','payload','created_at'] },
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
  return (scope === 'discovery' ? sharedDiscoveryPlans : fullPlans).map((plan) => ({
    ...plan,
    requiredSourceColumns: plan.requiredSourceColumns ? [...plan.requiredSourceColumns] : undefined,
    allowedTargetOnlyColumns: plan.allowedTargetOnlyColumns ? [...plan.allowedTargetOnlyColumns] : undefined,
  }));
}

export function validateLegacySourceContract(
  plans: readonly LegacyTablePlan[],
  availableTables: ReadonlySet<string>,
  columnsByTable: ReadonlyMap<string, readonly string[]>,
): string[] {
  const errors: string[] = [];
  for (const plan of plans) {
    if (!availableTables.has(plan.source)) {
      errors.push(`Required source table ${plan.source} is missing.`);
      continue;
    }
    const columns = new Set(columnsByTable.get(plan.source) ?? []);
    const missing = (plan.requiredSourceColumns ?? []).filter((column) => !columns.has(column));
    if (missing.length) errors.push(`Source table ${plan.source} is missing required columns: ${missing.join(', ')}.`);
  }
  return errors;
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
  if (!isExternalHttpsUrl(row.external_purchase_url)) errors.push('External product URL must be a valid public HTTPS URL.');
  if (row.image_url !== null && row.image_url !== undefined && String(row.image_url).trim() && !isExternalHttpsUrl(row.image_url)) errors.push('External product image URL must be a valid public HTTPS URL.');
  return errors;
}
