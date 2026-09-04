import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  DISCOVERY_ALLOWED_TARGET_TABLES,
  DISCOVERY_FORBIDDEN_TARGET_TABLES,
} from '../../src/domain/legacy-migration.js';

describe('discovery schema classification', () => {
  it('classifies every public application table exactly once', () => {
    const migrationsDirectory = fileURLToPath(new URL('../../src/db/migrations/', import.meta.url));
    const migrationTables = readdirSync(migrationsDirectory)
      .filter((file) => file.endsWith('.sql'))
      .flatMap((file) => [...readFileSync(`${migrationsDirectory}/${file}`, 'utf8').matchAll(/CREATE TABLE IF NOT EXISTS\s+([a-z][a-z0-9_]*)/gi)])
      .map((match) => match[1].toLowerCase());
    const schemaTables = new Set(['schema_migrations', ...migrationTables]);
    const allowed = new Set<string>(DISCOVERY_ALLOWED_TARGET_TABLES);
    const forbidden = new Set<string>(DISCOVERY_FORBIDDEN_TARGET_TABLES);

    expect([...allowed].filter((table) => forbidden.has(table))).toEqual([]);
    expect([...schemaTables].filter((table) => !allowed.has(table) && !forbidden.has(table))).toEqual([]);
    expect([...allowed, ...forbidden].filter((table) => !schemaTables.has(table))).toEqual([]);
  });
});
