import dotenv from 'dotenv';
import { z } from 'zod';
import { commerceEnabled, publicProductModes, validateLaunchFlags } from './domain/launch.js';
import { validateDiscoveryProductionEnvironment } from './domain/production-environment.js';

dotenv.config();

const booleanFlag = z.enum(['0', '1']).default('0').transform((value) => value === '1');
const optionalUrl = z.union([z.literal(''), z.string().url()]).default('');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  HOST: z.string().default('127.0.0.1'),
  APP_URL: z.string().url().default('http://localhost:4000'),
  DATABASE_URL: z.string().min(1).default('postgresql://seedexchange@127.0.0.1:5432/seedexchange'),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(50).default(20),
  SESSION_SECRET: z.string().default('development-only-session-secret'),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(24 * 90).default(24 * 14),
  TRUST_PROXY: booleanFlag,
  LAUNCH_PHASE: z.enum(['discovery', 'commerce']).default('discovery'),
  STRIPE_SECRET_KEY: z.string().default(''),
  STRIPE_WEBHOOK_SECRET: z.string().default(''),
  CONNECT_ENABLED: booleanFlag,
  MARKETPLACE_PAYMENTS_ENABLED: booleanFlag,
  PAYOUT_WORKER_ENABLED: booleanFlag,
  MAIL_HOST: z.string().default(''),
  MAIL_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  MAIL_ENCRYPTION: z.enum(['tls', 'ssl', 'none']).default('tls'),
  MAIL_USER: z.string().default(''),
  MAIL_PASS: z.string().default(''),
  MAIL_FROM: z.string().default(''),
  MAIL_FROM_NAME: z.string().default('Seedexchange'),
  MAIL_REPLY_TO: z.string().default(''),
  MEDIA_ROOT: z.string().default('storage/media'),
  SITEMAP_PATH: z.string().default('storage/sitemap.xml'),
  MEDIA_MAX_BYTES: z.coerce.number().int().min(1024).max(12_000_000).default(5_242_880),
  GOOGLE_SITE_VERIFICATION: z.string().default(''),
  ORESHKA_FEED_URL: optionalUrl,
  ORESHKA_FEED_TOKEN: z.string().default(''),
  LEGACY_MYSQL_URL: z.string().default(''),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  throw new Error(`Invalid environment: ${parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`);
}

const launchErrors = validateLaunchFlags({
  launchPhase: parsed.data.LAUNCH_PHASE,
  connectEnabled: parsed.data.CONNECT_ENABLED,
  marketplacePaymentsEnabled: parsed.data.MARKETPLACE_PAYMENTS_ENABLED,
  payoutWorkerEnabled: parsed.data.PAYOUT_WORKER_ENABLED,
});
if (launchErrors.length) throw new Error(`Invalid launch configuration: ${launchErrors.join(' ')}`);

if (parsed.data.NODE_ENV === 'production') {
  if (parsed.data.LAUNCH_PHASE === 'discovery') {
    const discoveryEnvironmentErrors = validateDiscoveryProductionEnvironment(process.env);
    if (discoveryEnvironmentErrors.length) {
      throw new Error(`Invalid discovery production environment: ${discoveryEnvironmentErrors.join(' ')}`);
    }
  }
  if (parsed.data.SESSION_SECRET.length < 32 || parsed.data.SESSION_SECRET.includes('development')) {
    throw new Error('SESSION_SECRET must contain at least 32 non-default characters in production.');
  }
  if (parsed.data.MARKETPLACE_PAYMENTS_ENABLED && (!parsed.data.STRIPE_SECRET_KEY || !parsed.data.STRIPE_WEBHOOK_SECRET)) {
    throw new Error('Enabled marketplace payments require Stripe secret and webhook keys.');
  }
}

const isCommerceEnabled = commerceEnabled({ launchPhase: parsed.data.LAUNCH_PHASE, marketplacePaymentsEnabled: parsed.data.MARKETPLACE_PAYMENTS_ENABLED });
export const config = Object.freeze({
  ...parsed.data,
  COMMERCE_ENABLED: isCommerceEnabled,
  PUBLIC_PRODUCT_MODES: publicProductModes(isCommerceEnabled),
});
