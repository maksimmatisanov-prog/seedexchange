export const RESERVATION_MINUTES = 30;

export function clampCartQuantity(requested: number, available: number): number {
  if (!Number.isInteger(available) || available < 0) throw new Error('Available stock must be a non-negative integer.');
  if (!Number.isFinite(requested)) return 0;
  return Math.min(Math.max(Math.trunc(requested), 1), available);
}

export function calculateCommissionCents(subtotalCents: number, commissionBps: number): number {
  if (!Number.isSafeInteger(subtotalCents) || subtotalCents < 0) throw new Error('Subtotal must be non-negative integer cents.');
  if (!Number.isInteger(commissionBps) || commissionBps < 0 || commissionBps > 5000) throw new Error('Commission must be between 0 and 5000 bps.');
  return Math.floor(subtotalCents * commissionBps / 10_000);
}

export function effectiveCommissionBps(input: { baseBps: number; founderBps?: number | null; founderStatus?: string | null; founderExpiresAt?: Date | null; now: Date }): number {
  const founderActive = input.founderStatus === 'active' && input.founderExpiresAt instanceof Date && input.founderExpiresAt.getTime() > input.now.getTime();
  return founderActive && input.founderBps !== null && input.founderBps !== undefined ? Math.min(input.baseBps, input.founderBps) : input.baseBps;
}

export function calculateShippingCents(sellerRates: ReadonlyArray<number>): number {
  if (!sellerRates.length) throw new Error('At least one seller shipping rate is required.');
  if (sellerRates.some((rate) => !Number.isSafeInteger(rate) || rate < 0)) throw new Error('Shipping rates must be non-negative integer cents.');
  return sellerRates.reduce((total, rate) => total + rate, 0);
}

export function reservationExpiresAt(now: Date): Date {
  return new Date(now.getTime() + RESERVATION_MINUTES * 60_000);
}

const orderTransitions: Record<string, ReadonlySet<string>> = {
  pending_payment: new Set(['processing_payment', 'paid', 'cancelled']),
  processing_payment: new Set(['paid', 'cancelled']),
  paid: new Set(['partially_fulfilled', 'fulfilled', 'cancelled', 'partially_refunded', 'refunded', 'disputed']),
  partially_fulfilled: new Set(['fulfilled', 'partially_refunded', 'refunded', 'disputed']),
  fulfilled: new Set(['partially_refunded', 'refunded', 'disputed']),
  disputed: new Set(['fulfilled', 'partially_refunded', 'refunded']),
};

export function canTransitionOrder(from: string, to: string): boolean {
  return from === to || Boolean(orderTransitions[from]?.has(to));
}

export function nextFounderSlot(currentSlot: number): number | null {
  if (!Number.isInteger(currentSlot) || currentSlot < 0 || currentSlot > 50) throw new Error('Founder slot state is invalid.');
  return currentSlot < 50 ? currentSlot + 1 : null;
}

export function canManageOrganization(input: { platformRole: string; memberRole?: string | null }): boolean {
  return input.platformRole === 'platform_admin' || input.memberRole === 'admin';
}
