import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../src/db/pool.js';
import { prepareSupplierBatch, type SupplierBatchType } from '../src/services/supplier-batches.js';

function argument(name: string): string | undefined {
  const exact = process.argv.find((value) => value.startsWith(`--${name}=`));
  if (exact) return exact.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

export async function main(): Promise<void> {
  const modeValue = (argument('mode') || 'publication').toLowerCase();
  const batchType: SupplierBatchType = modeValue === 'review' ? 'content_review' : modeValue as SupplierBatchType;
  const summary = await prepareSupplierBatch({
    organizationSlug: argument('organization') || 'oreshka-seeds',
    source: argument('source') || 'oreshka-meta',
    limit: Number(argument('limit') || 200),
    batchType,
    commit: process.argv.includes('--commit'),
  });
  console.log(JSON.stringify(summary, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }).finally(() => pool.end());
}
