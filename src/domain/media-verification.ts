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

export type MediaVerificationIssue = {
  code: 'root_unavailable' | 'unexpected_entry' | 'orphan_file' | 'invalid_key' | 'missing_file' | 'decode_failed' | 'format_mismatch' | 'byte_size_mismatch' | 'dimensions_mismatch' | 'database_sha_missing' | 'database_sha_invalid' | 'sha_mismatch';
  storageKey: string | null;
  message: string;
};

const keyPattern = /^[a-f0-9]{40}\.webp$/;

export async function verifyMediaInventory(rows: MediaAssetRecord[], mediaRoot: string) {
  const issues: MediaVerificationIssue[] = [];
  const addIssue = (code: MediaVerificationIssue['code'], message: string, storageKey: string | null = null) => issues.push({ code, storageKey, message });
  const manifest: VerifiedMediaEntry[] = [];
  const root = path.resolve(mediaRoot);
  let entries: Dirent[];
  try { entries = await readdir(root, { withFileTypes: true }); }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    addIssue('root_unavailable', `Media root is unavailable: ${message}`);
    return { ready: false, root, databaseRows: rows.length, files: 0, manifest, issues, errors: issues.map((issue) => issue.message) };
  }

  const databaseKeys = new Set(rows.map((row) => row.storage_key));
  const filesystemEntries = new Map(entries.map((entry) => [entry.name, entry]));
  for (const entry of entries) {
    if (!entry.isFile() || !keyPattern.test(entry.name)) addIssue('unexpected_entry', `Unexpected media entry: ${entry.name}.`, entry.name);
    else if (!databaseKeys.has(entry.name)) addIssue('orphan_file', `Media file has no database row: ${entry.name}.`, entry.name);
  }

  for (const row of [...rows].sort((left, right) => left.storage_key.localeCompare(right.storage_key))) {
    const key = row.storage_key;
    if (!keyPattern.test(key)) { addIssue('invalid_key', `Invalid storage key in database: ${key}.`, key); continue; }
    const directoryEntry = filesystemEntries.get(key);
    if (!directoryEntry?.isFile()) { addIssue('missing_file', `Media file is missing: ${key}.`, key); continue; }
    let data: Buffer;
    let metadata: { format?: string; width?: number; height?: number };
    try {
      data = await readFile(path.join(root, key));
      metadata = await sharp(data, { failOn: 'error', limitInputPixels: 36_000_000 }).metadata();
    } catch {
      addIssue('decode_failed', `Media file cannot be decoded: ${key}.`, key);
      continue;
    }
    const sha256 = createHash('sha256').update(data).digest('hex');
    const byteSize = Number(row.byte_size);
    const widthPx = Number(row.width_px);
    const heightPx = Number(row.height_px);
    if (row.mime_type !== 'image/webp' || metadata.format !== 'webp') addIssue('format_mismatch', `Media MIME or format mismatch: ${key}.`, key);
    if (data.length !== byteSize) addIssue('byte_size_mismatch', `Media byte size mismatch: ${key}.`, key);
    if (metadata.width !== widthPx || metadata.height !== heightPx) addIssue('dimensions_mismatch', `Media dimensions mismatch: ${key}.`, key);
    const expectedSha256 = row.sha256?.trim().toLowerCase();
    if (!expectedSha256) addIssue('database_sha_missing', `Media database SHA-256 is missing: ${key}.`, key);
    else if (!/^[a-f0-9]{64}$/.test(expectedSha256)) addIssue('database_sha_invalid', `Media database SHA-256 is invalid: ${key}.`, key);
    else if (sha256 !== expectedSha256) addIssue('sha_mismatch', `Media SHA-256 mismatch: ${key}.`, key);
    manifest.push({ storageKey: key, sha256, byteSize: data.length, widthPx: metadata.width ?? 0, heightPx: metadata.height ?? 0, active: row.is_active });
  }

  return { ready: issues.length === 0, root, databaseRows: rows.length, files: entries.filter((entry) => entry.isFile() && keyPattern.test(entry.name)).length, manifest, issues, errors: issues.map((issue) => issue.message) };
}
