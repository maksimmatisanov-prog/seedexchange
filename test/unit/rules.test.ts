import { describe, expect, it } from 'vitest';
import { calculateCommissionCents, calculateShippingCents, canManageOrganization, canTransitionOrder, canTransitionSellerOrder, clampCartQuantity, effectiveCommissionBps, nextFounderSlot, reservationExpiresAt } from '../../src/domain/rules.js';

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
