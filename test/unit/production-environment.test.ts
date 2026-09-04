import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { duplicateEnvironmentKeys, validateDiscoveryProductionEnvironment } from '../../src/domain/production-environment.js';

const valid = {
  NODE_ENV: 'production',
  HOST: '127.0.0.1',
  PORT: '4200',
  APP_URL: 'https://seedexchange.online',
  TRUST_PROXY: '1',
  DATABASE_URL: 'postgresql://seedexchange_production:a-private-db-secret-1234567890@127.0.0.1:5432/seedexchange_production',
  SESSION_SECRET: 'a-secure-random-session-value-1234567890',
  LAUNCH_PHASE: 'discovery',
  CONNECT_ENABLED: '0',
  MARKETPLACE_PAYMENTS_ENABLED: '0',
  PAYOUT_WORKER_ENABLED: '0',
  STRIPE_SECRET_KEY: '',
  STRIPE_WEBHOOK_SECRET: '',
  LEGACY_MYSQL_URL: '',
  MEDIA_ROOT: '/srv/seedexchange-production/shared/storage/media',
  SITEMAP_PATH: '/srv/seedexchange-production/shared/storage/sitemap.xml',
  MAIL_HOST: 'smtp.example.test',
  MAIL_PORT: '587',
  MAIL_ENCRYPTION: 'tls',
  MAIL_USER: 'mailer',
  MAIL_PASS: 'secret',
  MAIL_FROM: 'hello@example.test',
};

describe('phase-1 production environment contract', () => {
  it('accepts an isolated production discovery environment', () => {
    expect(validateDiscoveryProductionEnvironment(valid)).toEqual([]);
  });

  it('rejects staging reuse, commerce capabilities and retained migration access', () => {
    const errors = validateDiscoveryProductionEnvironment({
      ...valid,
      DATABASE_URL: 'postgresql://postgres@127.0.0.1/seedexchange_staging',
      LAUNCH_PHASE: 'commerce',
      MARKETPLACE_PAYMENTS_ENABLED: '1',
      STRIPE_SECRET_KEY: 'test-only-nonempty-stripe-secret',
      LEGACY_MYSQL_URL: 'mysql://private-source',
    });
    expect(errors).toEqual(expect.arrayContaining([
      'LAUNCH_PHASE must match the phase-1 production contract.',
      'MARKETPLACE_PAYMENTS_ENABLED must match the phase-1 production contract.',
      'DATABASE_URL must use the seedexchange_production role and database with a private password over 127.0.0.1:5432.',
      'Stripe secrets must be absent during the discovery launch.',
      'LEGACY_MYSQL_URL must not remain in the production runtime environment.',
    ]));
  });

  it('rejects peer authentication, missing credentials and connection overrides', () => {
    for (const DATABASE_URL of [
      'postgresql:///seedexchange_production?host=/var/run/postgresql',
      'postgresql://seedexchange_production@127.0.0.1:5432/seedexchange_production',
      'postgresql://seedexchange:a-private-db-secret-1234567890@127.0.0.1:5432/seedexchange_production',
      'postgresql://seedexchange_production:REPLACE_WITH_PASSWORD@127.0.0.1:5432/seedexchange_production',
      'postgresql://seedexchange_production:a-private-db-secret-1234567890@127.0.0.1:5432/seedexchange_production?host=/var/run/postgresql',
    ]) {
      expect(validateDiscoveryProductionEnvironment({ ...valid, DATABASE_URL })).toContain(
        'DATABASE_URL must use the seedexchange_production role and database with a private password over 127.0.0.1:5432.',
      );
    }
  });

  it('rejects placeholder secrets and incomplete SMTP', () => {
    const errors = validateDiscoveryProductionEnvironment({ ...valid, SESSION_SECRET: 'REPLACE_ME', MAIL_PASS: '', MAIL_ENCRYPTION: 'none' });
    expect(errors).toContain('SESSION_SECRET must be a non-placeholder value of at least 32 characters.');
    expect(errors).toContain('Production identity email configuration is incomplete: MAIL_PASS.');
    expect(errors).toContain('MAIL_ENCRYPTION must be tls or ssl in production.');
  });

  it('detects duplicate environment assignments', () => {
    expect(duplicateEnvironmentKeys('LAUNCH_PHASE=discovery\n# ignored\nexport LAUNCH_PHASE=commerce\nHOST=127.0.0.1\n'))
      .toEqual(['LAUNCH_PHASE']);
  });

  it('runs the operational preflight without echoing secrets', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'seedexchange-production-env-'));
    const file = path.join(directory, 'production.env');
    try {
      await writeFile(file, `${Object.entries(valid).map(([name, value]) => `${name}=${value}`).join('\n')}\n`, 'utf8');
      const execution = spawnSync(process.execPath, [
        path.resolve('node_modules/tsx/dist/cli.mjs'),
        path.resolve('scripts/verify-production-environment.ts'),
        `--file=${file}`,
      ], { cwd: process.cwd(), encoding: 'utf8' });
      expect(execution.status, execution.stderr).toBe(0);
      expect(JSON.parse(execution.stdout)).toMatchObject({ ready: true, phase: 'discovery', errors: [] });
      expect(execution.stdout).not.toContain(valid.SESSION_SECRET);
      expect(execution.stdout).not.toContain(valid.MAIL_PASS);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('enforces the same discovery contract when the production runtime loads', () => {
    const command = [
      path.resolve('node_modules/tsx/dist/cli.mjs'),
      '--eval',
      "import('./src/config.ts')",
    ];
    const accepted = spawnSync(process.execPath, command, {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: { ...process.env, ...valid },
    });
    expect(accepted.status, accepted.stderr).toBe(0);

    const forbiddenStripeSecret = 'test-only-runtime-stripe-secret';
    const rejected = spawnSync(process.execPath, command, {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: { ...process.env, ...valid, STRIPE_SECRET_KEY: forbiddenStripeSecret },
    });
    expect(rejected.status).not.toBe(0);
    expect(rejected.stderr).toContain('Stripe secrets must be absent during the discovery launch.');
    expect(rejected.stderr).not.toContain(forbiddenStripeSecret);
  });
});
