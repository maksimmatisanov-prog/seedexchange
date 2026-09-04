import { describe, expect, it } from 'vitest';
import { buildAuthActionUrl } from '../../src/domain/auth-links.js';

const token = 'ab'.repeat(32);

describe('authentication email links', () => {
  it('builds absolute production verification and reset URLs', () => {
    expect(buildAuthActionUrl('https://seedexchange.online', 'email_verification', token)).toBe(`https://seedexchange.online/auth/verify?token=${token}`);
    expect(buildAuthActionUrl('https://seedexchange.online/', 'password_reset', token)).toBe(`https://seedexchange.online/reset-password?token=${token}`);
  });

  it('uses the configured origin without leaking a base path', () => {
    expect(buildAuthActionUrl('https://staging.seedexchange.online/private/', 'email_verification', token)).toBe(`https://staging.seedexchange.online/auth/verify?token=${token}`);
  });

  it('rejects malformed tokens and credential-bearing origins', () => {
    expect(() => buildAuthActionUrl('https://seedexchange.online', 'password_reset', 'short')).toThrow('64 lowercase hexadecimal');
    expect(() => buildAuthActionUrl('https://user:secret@seedexchange.online', 'email_verification', token)).toThrow('without credentials');
  });
});
