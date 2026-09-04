import { describe, expect, it } from 'vitest';
import { normalizeOrganizationChannel, normalizePublicHttpUrl } from '../../src/domain/organization.js';

describe('organization public links', () => {
  it('normalizes public email and official social URLs', () => {
    expect(normalizeOrganizationChannel('email', 'Archive@Example.org')).toBe('mailto:archive@example.org');
    expect(normalizeOrganizationChannel('telegram', 'https://t.me/seed_archive')).toBe('https://t.me/seed_archive');
    expect(normalizePublicHttpUrl('https://archive.example/contact')).toBe('https://archive.example/contact');
  });

  it('rejects deceptive, insecure and non-public channel values as a bad request', () => {
    for (const run of [
      () => normalizeOrganizationChannel('telegram', 'https://example.org/t.me/seed_archive'),
      () => normalizeOrganizationChannel('instagram', 'http://instagram.com/seed_archive'),
      () => normalizeOrganizationChannel('email', 'not-an-email'),
      () => normalizePublicHttpUrl('javascript:alert(1)'),
      () => normalizePublicHttpUrl('', true),
    ]) {
      expect(run).toThrow(expect.objectContaining({ statusCode: 400 }));
    }
  });
});
