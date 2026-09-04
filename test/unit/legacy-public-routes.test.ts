import { describe, expect, it } from 'vitest';
import { legacyIndexRedirectTarget, legacyStaticRedirectTarget } from '../../src/domain/legacy-public-routes.js';

describe('legacy Hostinger discovery routes', () => {
  it('preserves static query strings and maps accepted private records', () => {
    expect(legacyStaticRedirectTarget('/reset-password/', '?token=abc')).toBe('/reset-password?token=abc');
    expect(legacyIndexRedirectTarget(new URLSearchParams('_route=%2Fauth%2Fverify&token=abc'))).toBe('/auth/verify?token=abc');
    expect(legacyIndexRedirectTarget(new URLSearchParams('_route=%2Fseller%2F7&tab=exchange'))).toBe('/seller/organization/7?tab=exchange');
    expect(legacyIndexRedirectTarget(new URLSearchParams('_route=%2Fmessages%2F11'))).toBe('/messages/11');
  });

  it('rejects ambiguous, commerce and unknown index routes', () => {
    expect(legacyIndexRedirectTarget(new URLSearchParams('_route=%2Fcart'))).toBeNull();
    expect(legacyIndexRedirectTarget(new URLSearchParams('_route=%2Fauth%2Fverify&_route=%2Fadmin'))).toBeNull();
    expect(legacyIndexRedirectTarget(new URLSearchParams('_route=https%3A%2F%2Fevil.example'))).toBeNull();
    expect(legacyIndexRedirectTarget(new URLSearchParams('_route=%2Fseller%2F0'))).toBeNull();
  });
});
