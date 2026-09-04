import { describe, expect, it } from 'vitest';
import { calculateCommissionCents, calculateShippingCents, canManageOrganization, canTransitionOrder, canTransitionSellerOrder, clampCartQuantity, effectiveCommissionBps, nextFounderSlot, reservationExpiresAt } from '../../src/domain/rules.js';
import { commerceEnabled, publicProductModes, validateLaunchFlags, validateLaunchReadiness } from '../../src/domain/launch.js';

describe('launch phase rules', () => {
  it('keeps discovery strictly free of internal payment capabilities', () => {
    expect(validateLaunchFlags({ launchPhase: 'discovery', connectEnabled: false, marketplacePaymentsEnabled: false, payoutWorkerEnabled: false })).toEqual([]);
    expect(validateLaunchFlags({ launchPhase: 'discovery', connectEnabled: true, marketplacePaymentsEnabled: false, payoutWorkerEnabled: false })).toContain('Discovery launch phase requires Connect, marketplace payments and payouts to remain disabled.');
    expect(commerceEnabled({ launchPhase: 'discovery', marketplacePaymentsEnabled: true })).toBe(false);
    expect(publicProductModes(false)).toEqual(['external']);
  });

  it('requires Connect before marketplace payments and payments before payouts', () => {
    expect(validateLaunchFlags({ launchPhase: 'commerce', connectEnabled: false, marketplacePaymentsEnabled: false, payoutWorkerEnabled: false })).toContain('Commerce launch phase requires Stripe Connect and marketplace payments to be enabled together.');
    expect(validateLaunchFlags({ launchPhase: 'commerce', connectEnabled: false, marketplacePaymentsEnabled: true, payoutWorkerEnabled: false })).toContain('Marketplace payments require Stripe Connect to be enabled.');
    expect(validateLaunchFlags({ launchPhase: 'commerce', connectEnabled: true, marketplacePaymentsEnabled: false, payoutWorkerEnabled: true })).toContain('Payout worker requires marketplace payments to be enabled.');
    expect(validateLaunchFlags({ launchPhase: 'commerce', connectEnabled: true, marketplacePaymentsEnabled: true, payoutWorkerEnabled: false })).toEqual([]);
    expect(commerceEnabled({ launchPhase: 'commerce', marketplacePaymentsEnabled: true })).toBe(true);
    expect(publicProductModes(true)).toEqual(['external', 'marketplace']);
  });

  it('verifies the runtime phase before a release is accepted', () => {
    expect(validateLaunchReadiness({ status: 'ready', database: 'ok', migration: '002.sql', launchPhase: 'discovery', commerceEnabled: false, connectEnabled: false, marketplacePaymentsEnabled: false, payoutWorkerEnabled: false }, 'discovery')).toEqual([]);
    expect(validateLaunchReadiness({ status: 'ready', database: 'ok', migration: '002.sql', launchPhase: 'discovery' }, 'discovery', '003.sql')).toContain('Expected migration 003.sql, received 002.sql.');
    expect(validateLaunchReadiness({ status: 'ready', database: 'ok', migration: '002.sql', launchPhase: 'discovery', commerceEnabled: true }, 'discovery')).toContain('Discovery readiness exposed an enabled commerce capability.');
    expect(validateLaunchReadiness({ status: 'ready', database: 'ok', migration: '002.sql', launchPhase: 'discovery' }, 'commerce')).toContain('Expected launch phase commerce, received discovery.');
  });
});

describe('commerce rules', () => {
  it('calculates integer commissions without rounding up', () => {
    expect(calculateCommissionCents(19_999, 1_000)).toBe(1_999);
    expect(calculateCommissionCents(10_000, 700)).toBe(700);
  });

  it('uses the founder rate only during the active window', () => {
    const now = new Date('2026-09-02T00:00:00Z');
    expect(effectiveCommissionBps({ baseBps: 1_000, founderBps: 700, founderStatus: 'active', founderExpiresAt: new Date('2026-09-03T00:00:00Z'), now })).toBe(700);
    expect(effectiveCommissionBps({ baseBps: 1_000, founderBps: 700, founderStatus: 'active', founderExpiresAt: now, now })).toBe(1_000);
  });

  it('charges shipping once per seller and clamps stock', () => {
    expect(calculateShippingCents([500, 900])).toBe(1_400);
    expect(clampCartQuantity(8, 3)).toBe(3);
    expect(clampCartQuantity(0, 3)).toBe(1);
  });

  it('sets reservations to exactly thirty minutes', () => {
    const now = new Date('2026-09-02T12:00:00Z');
    expect(reservationExpiresAt(now).toISOString()).toBe('2026-09-02T12:30:00.000Z');
  });
});

describe('permission and state rules', () => {
  it('accepts only declared order transitions', () => {
    expect(canTransitionOrder('pending_payment', 'paid')).toBe(true);
    expect(canTransitionOrder('pending_payment', 'refunded')).toBe(false);
    expect(canTransitionOrder('refunded', 'paid')).toBe(false);
  });

  it('keeps seller fulfilment transitions monotonic', () => {
    expect(canTransitionSellerOrder('paid', 'processing')).toBe(true);
    expect(canTransitionSellerOrder('paid', 'shipped')).toBe(true);
    expect(canTransitionSellerOrder('processing', 'shipped')).toBe(true);
    expect(canTransitionSellerOrder('shipped', 'delivered')).toBe(true);
    expect(canTransitionSellerOrder('delivered', 'processing')).toBe(false);
    expect(canTransitionSellerOrder('pending_payment', 'shipped')).toBe(false);
  });

  it('stops founder allocation after slot fifty', () => {
    expect(nextFounderSlot(0)).toBe(1);
    expect(nextFounderSlot(49)).toBe(50);
    expect(nextFounderSlot(50)).toBeNull();
  });

  it('allows organization admins and platform admins', () => {
    expect(canManageOrganization({ platformRole: 'buyer', memberRole: 'admin' })).toBe(true);
    expect(canManageOrganization({ platformRole: 'platform_admin' })).toBe(true);
    expect(canManageOrganization({ platformRole: 'buyer', memberRole: 'member' })).toBe(false);
  });
});
