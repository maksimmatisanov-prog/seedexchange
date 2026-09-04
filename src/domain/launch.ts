export type LaunchPhase = 'discovery' | 'commerce';

export type LaunchFlags = {
  launchPhase: LaunchPhase;
  connectEnabled: boolean;
  marketplacePaymentsEnabled: boolean;
  payoutWorkerEnabled: boolean;
};

export type LaunchReadiness = Partial<{
  status: string;
  database: string;
  migration: string;
  launchPhase: string;
  commerceEnabled: boolean;
  connectEnabled: boolean;
  marketplacePaymentsEnabled: boolean;
  payoutWorkerEnabled: boolean;
}>;

export function validateLaunchFlags(flags: LaunchFlags): string[] {
  const errors: string[] = [];
  if (flags.launchPhase === 'discovery' && (flags.connectEnabled || flags.marketplacePaymentsEnabled || flags.payoutWorkerEnabled)) {
    errors.push('Discovery launch phase requires Connect, marketplace payments and payouts to remain disabled.');
  }
  if (flags.launchPhase === 'commerce' && (!flags.connectEnabled || !flags.marketplacePaymentsEnabled)) {
    errors.push('Commerce launch phase requires Stripe Connect and marketplace payments to be enabled together.');
  }
  if (flags.marketplacePaymentsEnabled && !flags.connectEnabled) {
    errors.push('Marketplace payments require Stripe Connect to be enabled.');
  }
  if (flags.payoutWorkerEnabled && !flags.marketplacePaymentsEnabled) {
    errors.push('Payout worker requires marketplace payments to be enabled.');
  }
  return errors;
}

export function commerceEnabled(flags: Pick<LaunchFlags, 'launchPhase' | 'marketplacePaymentsEnabled'>): boolean {
  return flags.launchPhase === 'commerce' && flags.marketplacePaymentsEnabled;
}

export function publicProductModes(isCommerceEnabled: boolean): readonly string[] {
  return isCommerceEnabled ? ['external', 'marketplace'] : ['external'];
}

export function validateLaunchReadiness(body: LaunchReadiness, expectedPhase: LaunchPhase, expectedMigration?: string): string[] {
  const errors: string[] = [];
  if (body.status !== 'ready' || body.database !== 'ok' || !body.migration) errors.push('Readiness did not confirm the database and migration.');
  if (body.launchPhase !== expectedPhase) errors.push(`Expected launch phase ${expectedPhase}, received ${String(body.launchPhase)}.`);
  if (expectedMigration && body.migration !== expectedMigration) errors.push(`Expected migration ${expectedMigration}, received ${String(body.migration)}.`);
  if (expectedPhase === 'discovery' && (body.commerceEnabled || body.connectEnabled || body.marketplacePaymentsEnabled || body.payoutWorkerEnabled)) {
    errors.push('Discovery readiness exposed an enabled commerce capability.');
  }
  if (expectedPhase === 'commerce' && (!body.commerceEnabled || !body.connectEnabled || !body.marketplacePaymentsEnabled)) {
    errors.push('Commerce readiness did not confirm Connect and marketplace payments.');
  }
  return errors;
}
