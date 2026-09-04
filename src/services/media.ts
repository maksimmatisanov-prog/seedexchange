import { createHash, randomBytes } from 'node:crypto';
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { config } from '../config.js';

export type OrganizationMediaKind = 'organization_logo' | 'organization_cover';

export type StoredImage = {
  storageKey: string;
  absolutePath: string;
  mimeType: 'image/webp';
  byteSize: number;
  widthPx: number;
  heightPx: number;
  sha256: string;
};

const limits: Record<OrganizationMediaKind, { width: number; height: number }> = {
  organization_logo: { width: 800, height: 800 },
  organization_cover: { width: 2400, height: 1600 },
};

const badImage = (message: string) => Object.assign(new Error(message), { statusCode: 400 });

export async function processOrganizationImage(
  input: Buffer,
  kind: OrganizationMediaKind,
  mediaRoot = config.MEDIA_ROOT,
): Promise<StoredImage> {
  if (!input.length) throw badImage('Choose an image to upload.');
  if (input.length > config.MEDIA_MAX_BYTES) throw Object.assign(new Error(`Images must be ${Math.floor(config.MEDIA_MAX_BYTES / 1_048_576)} MB or smaller.`), { statusCode: 413 });

  const metadata = await sharp(input, { failOn: 'error', limitInputPixels: 36_000_000 }).metadata()
    .catch(() => { throw badImage('The image could not be decoded.'); });
  if (!metadata.width || !metadata.height || !['jpeg', 'png', 'webp'].includes(metadata.format ?? '') || metadata.width < 32 || metadata.height < 32 || metadata.width > 6000 || metadata.height > 6000) {
    throw badImage('Use a valid JPG, PNG or WebP image between 32 and 6000 pixels.');
  }

  const output = await sharp(input, { failOn: 'error', limitInputPixels: 36_000_000 })
    .rotate()
    .resize({ ...limits[kind], fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 84, effort: 4 })
    .toBuffer({ resolveWithObject: true });
  const root = path.resolve(mediaRoot);
  await mkdir(root, { recursive: true, mode: 0o750 });
  const storageKey = `${randomBytes(20).toString('hex')}.webp`;
  const absolutePath = path.join(root, storageKey);
  const temporaryPath = path.join(root, `.${storageKey}.${randomBytes(8).toString('hex')}.tmp`);
  try {
    await writeFile(temporaryPath, output.data, { flag: 'wx', mode: 0o640 });
    await rename(temporaryPath, absolutePath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
  return {
    storageKey,
    absolutePath,
    mimeType: 'image/webp',
    byteSize: output.data.length,
    widthPx: output.info.width,
    heightPx: output.info.height,
    sha256: createHash('sha256').update(output.data).digest('hex'),
  };
}

export async function removeUncommittedImage(image: Pick<StoredImage, 'absolutePath'>): Promise<void> {
  await unlink(image.absolutePath).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
  });
}
