import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('production discovery Caddy bundle', () => {
  it('redirects www and proxies only the production loopback service', async () => {
    const fragment = await readFile(path.resolve('ops/caddy/seedexchange-production.caddy'), 'utf8');
    const example = await readFile(path.resolve('ops/Caddyfile.production.example'), 'utf8');
    expect(example).toBe(fragment);
    expect(fragment).toContain('www.seedexchange.online {');
    expect(fragment).toContain('Strict-Transport-Security "max-age=31536000; includeSubDomains"');
    expect(fragment).toContain('X-Content-Type-Options "nosniff"');
    expect(fragment).toContain('redir https://seedexchange.online{uri} permanent');
    expect(fragment).toContain('seedexchange.online {');
    expect(fragment).toContain('reverse_proxy 127.0.0.1:4200');
    expect(fragment).toContain('health_uri /health');
    expect(fragment).not.toContain('4100');
    expect(fragment).not.toMatch(/basic_?auth|noindex|staging/i);
  });

  it('keeps activation approval-gated and removes a new fragment on failure', async () => {
    const activation = await readFile(path.resolve('ops/caddy/activate-production-caddy.sh'), 'utf8');
    expect(activation.indexOf('SEEDX_PRODUCTION_CADDY_APPROVED')).toBeLessThan(activation.indexOf('release="$releases/$expected_commit"'));
    expect(activation).toContain("grep -Fqx 'import /etc/caddy/sites-enabled/*.caddy'");
    expect(activation).toContain('verify-release-manifest.js');
    expect(activation).toContain('verify-production-observation.js');
    expect(activation).toContain('caddy validate --config "$main_config"');
    expect(activation).toContain('sudo rm -f -- "$target"');
    expect(activation).not.toMatch(/change.*dns|hostinger/i);
  });

  it('restores the fragment when a Caddy rollback cannot be loaded', async () => {
    const rollback = await readFile(path.resolve('ops/caddy/rollback-production-caddy.sh'), 'utf8');
    expect(rollback.indexOf('SEEDX_PRODUCTION_CADDY_ROLLBACK_APPROVED')).toBeLessThan(rollback.indexOf('release="$releases/$expected_commit"'));
    const remove = rollback.indexOf('sudo rm -f -- "$target"');
    const validate = rollback.indexOf('caddy validate --config "$main_config"', remove);
    const restore = rollback.indexOf('sudo install -o root -g root -m 0644 "$backup" "$target"', validate);
    expect(remove).toBeGreaterThan(-1);
    expect(validate).toBeGreaterThan(remove);
    expect(restore).toBeGreaterThan(validate);
  });
});
