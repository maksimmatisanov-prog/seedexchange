import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import { processOrganizationImage, removeUncommittedImage } from '../../src/services/media.js';

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
