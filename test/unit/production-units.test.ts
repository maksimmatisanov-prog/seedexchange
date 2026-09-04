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
});
