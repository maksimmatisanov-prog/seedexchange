import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../src/config.js';
import { pool } from '../src/db/pool.js';
import { syncSupplierCatalog } from '../src/services/supplier-catalog.js';

function argument(name: string): string | undefined {
  const exact = process.argv.find((value) => value.startsWith(`--${name}=`));
  if (exact) return exact.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

export async function main(): Promise<void> {
  const location = argument('feed') || config.ORESHKA_FEED_URL;
  if (!location) throw new Error('Usage: npm run sync:oreshka -- --feed=<https-url-or-json-or-csv-file> [--organization=oreshka-seeds] [--source=oreshka-meta] [--commit] [--sync-live]');
  const summary = await syncSupplierCatalog({
    location,
    organizationSlug: argument('organization') || 'oreshka-seeds',
    source: argument('source') || 'oreshka-meta',
    commit: process.argv.includes('--commit'),
    syncLive: process.argv.includes('--sync-live'),
  });
  console.log(JSON.stringify(summary, null, 2));
  if (summary.pilot_missing.length) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }).finally(() => pool.end());
}
