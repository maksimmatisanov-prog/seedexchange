import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const scriptPath = path.resolve('ops/prepare-production-foundation.sh');

describe('production foundation preparation', () => {
  it('requires a distinct owner approval before the first host-state read', async () => {
    const script = await readFile(scriptPath, 'utf8');
    const approval = script.indexOf('SEEDX_PRODUCTION_FOUNDATION_APPROVED');
    const hostRead = script.indexOf('node --version');
    expect(approval).toBeGreaterThan(-1);
    expect(hostRead).toBeGreaterThan(approval);
    expect(script).toContain('/secure/root-only-db-password');
    expect(script).toContain("root:600");
    expect(script).toContain('readlink -f -- "$password_argument"');
    expect(script).toContain('"$password_file" != /secure/*');
    expect(script).toContain('query_failed');
  });

  it('creates only the isolated least-privilege role, database and storage root', async () => {
    const script = await readFile(scriptPath, 'utf8');
    expect(script).toContain('readonly production_root=/srv/seedexchange-production');
    expect(script).toContain('readonly production_database=seedexchange_production');
    expect(script).toContain('readonly production_role=seedexchange_production');
    expect(script).toContain('NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS');
    expect(script).toContain('psql -h 127.0.0.1 -p 5432');
    expect(script).toContain('least-privilege');
    expect(script).toContain('$production_root/shared/storage/media');
  });

  it('rolls back only resources created by the failed approved run', async () => {
    const script = await readFile(scriptPath, 'utf8');
    expect(script).toContain('dropdb --if-exists -- "$production_database"');
    expect(script).toContain("printf 'DROP ROLE IF EXISTS %s;");
    expect(script).toContain('rm -rf -- /srv/seedexchange-production');
    expect(script).toContain('created_database=1');
    expect(script).toContain('created_role=1');
    expect(script).toContain('created_root=1');
    expect(script.indexOf('created_role=1', script.indexOf('trap cleanup EXIT'))).toBeLessThan(script.indexOf('CREATE ROLE'));
    expect(script.indexOf('created_database=1', script.indexOf('trap cleanup EXIT'))).toBeLessThan(script.indexOf('createdb --owner'));
  });

  it('does not activate applications, routing, imports or payments', async () => {
    const script = await readFile(scriptPath, 'utf8');
    expect(script).not.toMatch(/systemctl\s+(?:start|restart|enable|disable|stop|daemon-reload)/);
    expect(script).not.toMatch(/caddy\s+(?:reload|start|stop)/);
    expect(script).not.toMatch(/(?:migrate-legacy|migrate\.js|stripe|cloudflare|hostinger)/i);
    expect(script).not.toContain('set -x');
    expect(script).toContain('unset password PGPASSWORD');
  });
});
