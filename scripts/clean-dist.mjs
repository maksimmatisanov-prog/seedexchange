import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const target = resolve(process.cwd(), 'dist');
const expected = resolve(process.cwd(), 'dist');

if (target !== expected || !target.endsWith(`${process.platform === 'win32' ? '\\' : '/'}dist`)) {
  throw new Error(`Refusing to remove unexpected build directory: ${target}`);
}

await rm(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
