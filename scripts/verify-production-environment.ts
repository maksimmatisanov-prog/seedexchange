import { readFile } from 'node:fs/promises';
import path from 'node:path';
import dotenv from 'dotenv';
import { duplicateEnvironmentKeys, validateDiscoveryProductionEnvironment } from '../src/domain/production-environment.js';

const args = process.argv.slice(2);
const fileArguments = args.filter((argument) => argument.startsWith('--file='));
if (args.length !== 1 || fileArguments.length !== 1 || fileArguments[0] === '--file=') {
  throw new Error('Usage: verify-production-environment --file=/srv/seedexchange-production/shared/production.env');
}
const file = path.resolve(fileArguments[0].slice('--file='.length));
const contents = await readFile(file);
if (contents.byteLength > 1_000_000) throw new Error('Production environment file exceeds the 1 MB limit.');
const source = contents.toString('utf8');
const environment = dotenv.parse(source);
const duplicates = duplicateEnvironmentKeys(source);
const errors = [
  ...(duplicates.length ? [`Production environment contains duplicate keys: ${duplicates.join(', ')}.`] : []),
  ...validateDiscoveryProductionEnvironment(environment),
];
console.log(JSON.stringify({ ready: errors.length === 0, phase: 'discovery', file, checkedFields: Object.keys(environment).sort(), errors }, null, 2));
if (errors.length) process.exitCode = 1;
