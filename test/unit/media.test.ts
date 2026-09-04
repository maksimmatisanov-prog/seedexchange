import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import { processOrganizationImage, removeUncommittedImage } from '../../src/services/media.js';
import { verifyMediaInventory } from '../../src/domain/media-verification.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('organization media processing', () => {
  it('decodes, bounds and stores a content-fingerprinted WebP logo', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'seedexchange-media-'));
    temporaryDirectories.push(root);
    const source = await sharp({ create: { width: 1200, height: 900, channels: 3, background: '#315f45' } }).jpeg().toBuffer();
    const image = await processOrganizationImage(source, 'organization_logo', root);

    expect(image.storageKey).toMatch(/^[a-f0-9]{40}\.webp$/);
    expect(image).toMatchObject({ mimeType: 'image/webp', widthPx: 800, heightPx: 600 });
    expect(image.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect((await readFile(image.absolutePath)).length).toBe(image.byteSize);

    await removeUncommittedImage(image);
    await expect(readFile(image.absolutePath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects unsupported and undersized images with a user-facing error', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'seedexchange-media-'));
    temporaryDirectories.push(root);
    const tiny = await sharp({ create: { width: 16, height: 16, channels: 4, background: '#ffffff' } }).png().toBuffer();
    await expect(processOrganizationImage(tiny, 'organization_logo', root)).rejects.toMatchObject({ statusCode: 400 });
    await expect(processOrganizationImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"/>'), 'organization_cover', root)).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('media inventory verification', () => {
  it('matches database metadata and SHA-256 to an exact filesystem manifest', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'seedexchange-media-'));
    temporaryDirectories.push(root);
    const key = `${'a'.repeat(40)}.webp`;
    const data = await sharp({ create: { width: 320, height: 240, channels: 3, background: '#315f45' } }).webp().toBuffer();
    await writeFile(path.join(root, key), data);
    const report = await verifyMediaInventory([{
      storage_key: key, mime_type: 'image/webp', byte_size: data.length, width_px: 320, height_px: 240,
      sha256: createHash('sha256').update(data).digest('hex'), is_active: true,
    }], root);
    expect(report).toMatchObject({ ready: true, databaseRows: 1, files: 1, errors: [] });
    expect(report.manifest[0]).toMatchObject({ storageKey: key, widthPx: 320, heightPx: 240, active: true });
  });

  it('fails closed for missing hashes, metadata drift and orphan files', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'seedexchange-media-'));
    temporaryDirectories.push(root);
    const key = `${'b'.repeat(40)}.webp`;
    const orphan = `${'c'.repeat(40)}.webp`;
    const data = await sharp({ create: { width: 160, height: 120, channels: 3, background: '#b88a42' } }).webp().toBuffer();
    await writeFile(path.join(root, key), data);
    await writeFile(path.join(root, orphan), data);
    const report = await verifyMediaInventory([{
      storage_key: key, mime_type: 'image/webp', byte_size: data.length + 1, width_px: 161, height_px: 120,
      sha256: null, is_active: false,
    }], root);
    expect(report.ready).toBe(false);
    expect(report.errors).toEqual(expect.arrayContaining([
      `Media file has no database row: ${orphan}.`,
      `Media byte size mismatch: ${key}.`,
      `Media dimensions mismatch: ${key}.`,
      `Media database SHA-256 is missing: ${key}.`,
    ]));
    expect(report.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(['orphan_file','byte_size_mismatch','dimensions_mismatch','database_sha_missing']));
  });
});
