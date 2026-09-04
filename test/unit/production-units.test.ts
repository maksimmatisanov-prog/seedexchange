import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const unitRoot = path.resolve('ops/systemd/production');
const expectedUnits = [
  'seedexchange-production-outbox.service',
  'seedexchange-production-outbox.timer',
  'seedexchange-production-sitemap.service',
  'seedexchange-production-sitemap.timer',
  'seedexchange-production.service',
];

describe('production discovery systemd bundle', () => {
  it('contains only the web, outbox and sitemap units', async () => {
    expect((await readdir(unitRoot)).sort()).toEqual(expectedUnits);
    expect(expectedUnits.some((name) => name.includes('marketplace'))).toBe(false);
  });

  it('uses only the isolated production root and hardened service settings', async () => {
    for (const unit of expectedUnits.filter((name) => name.endsWith('.service'))) {
      const contents = await readFile(path.join(unitRoot, unit), 'utf8');
      expect(contents).toContain('User=seedexchange');
      expect(contents).toContain('Group=seedexchange');
      expect(contents).toContain('WorkingDirectory=/srv/seedexchange-production/current');
      expect(contents).toContain('EnvironmentFile=/srv/seedexchange-production/shared/production.env');
      expect(contents).toContain('NoNewPrivileges=true');
      expect(contents).toContain('ProtectSystem=strict');
      expect(contents).toContain('UMask=0027');
      expect(contents).toContain('PrivateDevices=true');
      expect(contents).toContain('ProtectKernelTunables=true');
      expect(contents).not.toContain('/srv/seedexchange/current');
      expect(contents).not.toContain('staging.env');
      expect(contents).not.toContain('process-marketplace');
    }
    expect(await readFile(path.join(unitRoot, 'seedexchange-production-outbox.service'), 'utf8')).toContain('ExecStart=/usr/bin/node dist/scripts/send-outbox.js');
    expect(await readFile(path.join(unitRoot, 'seedexchange-production-sitemap.service'), 'utf8')).toContain('ExecStart=/usr/bin/node dist/scripts/generate-sitemap.js');
  });

  it('pins each timer to its production oneshot service', async () => {
    const outbox = await readFile(path.join(unitRoot, 'seedexchange-production-outbox.timer'), 'utf8');
    const sitemap = await readFile(path.join(unitRoot, 'seedexchange-production-sitemap.timer'), 'utf8');
    expect(outbox).toContain('Unit=seedexchange-production-outbox.service');
    expect(outbox).toContain('OnUnitActiveSec=1min');
    expect(sitemap).toContain('Unit=seedexchange-production-sitemap.service');
    expect(sitemap).toContain('OnUnitActiveSec=1h');
  });

  it('restarts the previous application process during a failed activation rollback', async () => {
    const activation = await readFile(path.resolve('ops/activate-production-discovery.sh'), 'utf8');
    const rollbackStart = activation.indexOf('if [[ -n "$previous"');
    const firstDeploymentFallback = activation.indexOf('  else\n', rollbackStart);
    expect(rollbackStart).toBeGreaterThan(-1);
    expect(firstDeploymentFallback).toBeGreaterThan(rollbackStart);
    const rollback = activation.slice(rollbackStart, firstDeploymentFallback);
    const disableTimers = rollback.indexOf('sudo systemctl disable --now seedexchange-production-sitemap.timer seedexchange-production-outbox.timer');
    const switchSymlink = rollback.indexOf('mv -Tf "$root/current.next" "$root/current"');
    const restartPrevious = rollback.indexOf('sudo systemctl restart "$service"');
    const enableTimers = rollback.indexOf('sudo systemctl enable --now seedexchange-production-sitemap.timer seedexchange-production-outbox.timer');
    expect(disableTimers).toBeGreaterThan(-1);
    expect(switchSymlink).toBeGreaterThan(disableTimers);
    expect(restartPrevious).toBeGreaterThan(switchSymlink);
    expect(enableTimers).toBeGreaterThan(restartPrevious);
    expect(rollback).not.toContain('enable --now "$service"');
  });

  it('runs a bounded loopback load gate before enabling production timers', async () => {
    const activation = await readFile(path.resolve('ops/activate-production-discovery.sh'), 'utf8');
    const runtimeGate = activation.indexOf('verify-discovery-runtime.js');
    const loadGate = activation.indexOf('verify-discovery-load.js --origin=http://127.0.0.1:4200');
    const firstTimerStart = activation.indexOf('systemctl start seedexchange-production-sitemap.service');
    expect(runtimeGate).toBeGreaterThan(-1);
    expect(loadGate).toBeGreaterThan(runtimeGate);
    expect(firstTimerStart).toBeGreaterThan(loadGate);
    expect(activation).toContain('--requests=72 --concurrency=6 --timeout-ms=3000 --p95-ms=750');
  });

  it('verifies the actual database identity before SMTP and schema migrations', async () => {
    const preparation = await readFile(path.resolve('ops/deploy-production-discovery.sh'), 'utf8');
    const environment = preparation.indexOf('verify-production-environment.js');
    const database = preparation.indexOf('verify-production-database.js');
    const mail = preparation.indexOf('verify-production-mail.js');
    const migration = preparation.indexOf('dist/src/db/migrate.js');
    expect(environment).toBeGreaterThan(-1);
    expect(database).toBeGreaterThan(environment);
    expect(mail).toBeGreaterThan(database);
    expect(migration).toBeGreaterThan(mail);
  });
});
