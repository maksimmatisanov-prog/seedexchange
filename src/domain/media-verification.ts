import { createHash } from 'node:crypto';
import type { Dirent } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

export type MediaAssetRecord = {
  storage_key: string;
  mime_type: string;
  byte_size: string | number;
  width_px: string | number;
  height_px: string | number;
  sha256: string | null;
  is_active: boolean;
};

export type VerifiedMediaEntry = {
  storageKey: string;
  sha256: string;
  byteSize: number;
  widthPx: number;
  heightPx: number;
  active: boolean;
};

const keyPattern = /^[a-f0-9]{40}\.webp$/;

export async function verifyMediaInventory(rows: MediaAssetRecord[], mediaRoot: string) {
  const errors: string[] = [];
  const manifest: VerifiedMediaEntry[] = [];
  const root = path.resolve(mediaRoot);
  let entries: Dirent[];
  try { entries = await readdir(root, { withFileTypes: true }); }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ready: false, root, databaseRows: rows.length, files: 0, manifest, errors: [`Media root is unavailable: ${message}`] };
  }

  const databaseKeys = new Set(rows.map((row) => row.storage_key));
  const filesystemEntries = new Map(entries.map((entry) => [entry.name, entry]));
  for (const entry of entries) {
    if (!entry.isFile() || !keyPattern.test(entry.name)) errors.push(`Unexpected media entry: ${entry.name}.`);
    else if (!databaseKeys.has(entry.name)) errors.push(`Media file has no database row: ${entry.name}.`);
  }

  for (const row of [...rows].sort((left, right) => left.storage_key.localeCompare(right.storage_key))) {
    const key = row.storage_key;
    if (!keyPattern.test(key)) { errors.push(`Invalid storage key in database: ${key}.`); continue; }
    const directoryEntry = filesystemEntries.get(key);
    if (!directoryEntry?.isFile()) { errors.push(`Media file is missing: ${key}.`); continue; }
    let data: Buffer;
    let metadata: { format?: string; width?: number; height?: number };
    try {
      data = await readFile(path.join(root, key));
      metadata = await sharp(data, { failOn: 'error', limitInputPixels: 36_000_000 }).metadata();
    } catch {
      errors.push(`Media file cannot be decoded: ${key}.`);
      continue;
    }
    const sha256 = createHash('sha256').update(data).digest('hex');
    const byteSize = Number(row.byte_size);
    const widthPx = Number(row.width_px);
    const heightPx = Number(row.height_px);
    if (row.mime_type !== 'image/webp' || metadata.format !== 'webp') errors.push(`Media MIME or format mismatch: ${key}.`);
    if (data.length !== byteSize) errors.push(`Media byte size mismatch: ${key}.`);
    if (metadata.width !== widthPx || metadata.height !== heightPx) errors.push(`Media dimensions mismatch: ${key}.`);
    const expectedSha256 = row.sha256?.trim().toLowerCase();
    if (!expectedSha256 || !/^[a-f0-9]{64}$/.test(expectedSha256)) errors.push(`Media database SHA-256 is missing or invalid: ${key}.`);
    else if (sha256 !== expectedSha256) errors.push(`Media SHA-256 mismatch: ${key}.`);
    manifest.push({ storageKey: key, sha256, byteSize: data.length, widthPx: metadata.width ?? 0, heightPx: metadata.height ?? 0, active: row.is_active });
  }

  return { ready: errors.length === 0, root, databaseRows: rows.length, files: entries.filter((entry) => entry.isFile() && keyPattern.test(entry.name)).length, manifest, errors };
}
