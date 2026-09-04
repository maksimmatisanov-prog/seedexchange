const requiredExactValues: Record<string, string> = {
  NODE_ENV: 'production',
  HOST: '127.0.0.1',
  PORT: '4200',
  APP_URL: 'https://seedexchange.online',
  TRUST_PROXY: '1',
  LAUNCH_PHASE: 'discovery',
  CONNECT_ENABLED: '0',
  MARKETPLACE_PAYMENTS_ENABLED: '0',
  PAYOUT_WORKER_ENABLED: '0',
  MEDIA_ROOT: '/srv/seedexchange-production/shared/storage/media',
  SITEMAP_PATH: '/srv/seedexchange-production/shared/storage/sitemap.xml',
};

function isLocalProductionDatabase(value: string): boolean {
  try {
    const url = new URL(value);
    if (!['postgres:', 'postgresql:'].includes(url.protocol)) return false;
    const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
    const password = decodeURIComponent(url.password);
    return url.hostname === '127.0.0.1'
      && (url.port === '' || url.port === '5432')
      && url.username === 'seedexchange_production'
      && password.length >= 24
      && !/replace|example|password/i.test(password)
      && database === 'seedexchange_production'
      && url.search === '';
  } catch {
    return false;
  }
}

export function validateDiscoveryProductionEnvironment(environment: Readonly<Record<string, string | undefined>>): string[] {
  const errors: string[] = [];
  for (const [name, expected] of Object.entries(requiredExactValues)) {
    if (environment[name] !== expected) errors.push(`${name} must match the phase-1 production contract.`);
  }
  if (!isLocalProductionDatabase(environment.DATABASE_URL ?? '')) {
    errors.push('DATABASE_URL must use the seedexchange_production role and database with a private password over 127.0.0.1:5432.');
  }
  const sessionSecret = environment.SESSION_SECRET ?? '';
  if (sessionSecret.length < 32 || /development|replace|example/i.test(sessionSecret)) {
    errors.push('SESSION_SECRET must be a non-placeholder value of at least 32 characters.');
  }
  if (environment.STRIPE_SECRET_KEY?.trim() || environment.STRIPE_WEBHOOK_SECRET?.trim()) {
    errors.push('Stripe secrets must be absent during the discovery launch.');
  }
  if (environment.LEGACY_MYSQL_URL?.trim()) errors.push('LEGACY_MYSQL_URL must not remain in the production runtime environment.');

  const requiredMail = ['MAIL_HOST', 'MAIL_USER', 'MAIL_PASS', 'MAIL_FROM'] as const;
  const missingMail = requiredMail.filter((name) => !environment[name]?.trim() || /replace/i.test(environment[name]));
  if (missingMail.length) errors.push(`Production identity email configuration is incomplete: ${missingMail.join(', ')}.`);
  if (!['tls', 'ssl'].includes(environment.MAIL_ENCRYPTION ?? '')) errors.push('MAIL_ENCRYPTION must be tls or ssl in production.');
  const mailPort = Number(environment.MAIL_PORT);
  if (!Number.isInteger(mailPort) || mailPort < 1 || mailPort > 65535) errors.push('MAIL_PORT must be a valid TCP port.');
  return errors;
}

export function duplicateEnvironmentKeys(source: string): string[] {
  const counts = new Map<string, number>();
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (match) counts.set(match[1], (counts.get(match[1]) ?? 0) + 1);
  }
  return [...counts.entries()].filter(([, count]) => count > 1).map(([name]) => name).sort();
}
