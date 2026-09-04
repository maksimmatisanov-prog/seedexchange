import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { inventoryMediaDirectory } from '../src/domain/media-verification.js';
import { config } from '../src/config.js';

const rootArgument = process.argv.find((argument) => argument.startsWith('--root='));
const outputArgument = process.argv.find((argument) => argument.startsWith('--output='));
if (process.argv.slice(2).some((argument) => !argument.startsWith('--root=') && !argument.startsWith('--output='))) throw new Error('Usage: media-manifest [--root=/absolute/media/path] [--output=/secure/source-media-manifest.json]');
const report = await inventoryMediaDirectory(rootArgument?.slice('--root='.length) || config.MEDIA_ROOT);
const manifest = JSON.stringify({ ready: report.ready, version: 1, entries: report.entries, errors: report.errors }, null, 2);
if (outputArgument && report.ready) {
  const outputPath = path.resolve(outputArgument.slice('--output='.length));
  await writeFile(outputPath, `${manifest}\n`, { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ ready: true, outputPath, entries: report.entries.length }, null, 2));
} else {
  console.log(manifest);
}
if (!report.ready) process.exitCode = 1;
