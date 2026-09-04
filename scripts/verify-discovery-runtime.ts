import { verifyDiscoveryRuntime } from '../src/domain/discovery-runtime.js';

const argumentsByName = new Map<string, string>();
for (const argument of process.argv.slice(2)) {
  const match = /^--([a-z-]+)=(.+)$/.exec(argument);
  if (!match || argumentsByName.has(match[1])) throw new Error('Arguments must be unique --name=value pairs.');
  argumentsByName.set(match[1], match[2]);
}

const allowed = new Set(['origin', 'migration', 'organization', 'product', 'media']);
const unexpected = [...argumentsByName.keys()].filter((name) => !allowed.has(name));
if (unexpected.length) throw new Error(`Unexpected argument(s): ${unexpected.join(', ')}.`);
if ([...allowed].some((name) => !argumentsByName.has(name))) {
  throw new Error('Usage: verify:discovery-runtime -- --origin=http://127.0.0.1:4200 --migration=003_discovery_migration_scope.sql --organization=/directory/<slug> --product=/product/<slug> --media=/media/<key>.webp');
}

const report = await verifyDiscoveryRuntime({
  origin: argumentsByName.get('origin')!,
  expectedMigration: argumentsByName.get('migration')!,
  organizationPath: argumentsByName.get('organization')!,
  productPath: argumentsByName.get('product')!,
  mediaPath: argumentsByName.get('media')!,
});

console.log(JSON.stringify(report, null, 2));
if (!report.ready) process.exitCode = 1;
