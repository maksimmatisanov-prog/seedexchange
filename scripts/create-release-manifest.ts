import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createDiscoveryReleaseManifest } from '../src/domain/release-manifest.js';

const args = process.argv.slice(2);
function argument(name: string): string {
  const matches = args.filter((value) => value.startsWith(`--${name}=`));
  if (matches.length !== 1 || matches[0] === `--${name}=`) throw new Error(`Provide exactly one --${name}=<value>.`);
  return matches[0].slice(name.length + 3);
}
if (args.length !== 4) throw new Error('Usage: create-release-manifest --root=<absolute-release-directory> --commit=<git-sha> --tree=<git-tree-sha> --output=<absolute-RELEASE.json>');
const root = path.resolve(argument('root'));
const output = path.resolve(argument('output'));
if (!path.isAbsolute(argument('root')) || !path.isAbsolute(argument('output')) || output !== path.join(root, 'RELEASE.json')) throw new Error('root must be absolute and output must be <root>/RELEASE.json.');
const manifest = await createDiscoveryReleaseManifest(root, argument('commit'), argument('tree'));
const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
await writeFile(output, serialized, { encoding: 'utf8', flag: 'wx', mode: 0o644 });
console.log(JSON.stringify({ ready: true, output, manifestSha256: createHash('sha256').update(serialized).digest('hex'), gitCommit: manifest.gitCommit, gitTree: manifest.gitTree, expectedMigration: manifest.expectedMigration, files: manifest.files.length }, null, 2));
