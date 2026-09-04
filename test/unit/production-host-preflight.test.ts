import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const scriptPath = path.resolve('ops/verify-production-host.sh');

describe('production host preflight', () => {
  it('supports the three pre-activation host states', async () => {
    const script = await readFile(scriptPath, 'utf8');
    expect(script).toContain('--expect=clean');
    expect(script).toContain('--expect=foundation');
    expect(script).toContain('--expect=units-installed');
    expect(script).toContain('report ready true');
    expect(script).toContain('report ready false');
  });

  it('checks the isolated roots, database, role, Caddy import and production port', async () => {
    const script = await readFile(scriptPath, 'utf8');
    expect(script).toContain('/srv/seedexchange-production');
    expect(script).toContain('/srv/seedexchange');
    expect(script).toContain("datname = 'seedexchange_production'");
    expect(script).toContain("rolname = 'seedexchange_production'");
    expect(script).toContain('production_role_must_allow_login');
    expect(script).toContain('production_role_must_not_be_elevated');
    expect(script).toContain("import /etc/caddy/sites-enabled/*.caddy");
    expect(script).toContain("sport = :4200");
  });

  it('requires exactly the discovery web, outbox and sitemap units', async () => {
    const script = await readFile(scriptPath, 'utf8');
    const unitBlock = script.slice(script.indexOf('readonly units=('), script.indexOf(')', script.indexOf('readonly units=(')) + 1);
    expect(unitBlock.match(/seedexchange-production[^\s]+/g)?.sort()).toEqual([
      'seedexchange-production-outbox.service',
      'seedexchange-production-outbox.timer',
      'seedexchange-production-sitemap.service',
      'seedexchange-production-sitemap.timer',
      'seedexchange-production.service',
    ]);
    expect(unitBlock).not.toContain('marketplace');
  });

  it('contains no host mutation commands', async () => {
    const script = await readFile(scriptPath, 'utf8');
    expect(script).not.toMatch(/\b(?:mkdir|install|createdb|createuser|dropdb|dropuser|rm|mv|cp|chmod|chown)\b/);
    expect(script).not.toMatch(/systemctl\s+(?:start|restart|enable|disable|stop|daemon-reload)/);
    expect(script).not.toMatch(/caddy\s+reload/);
    expect(script).not.toMatch(/psql[^\n]*\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE)\b/i);
  });
});
