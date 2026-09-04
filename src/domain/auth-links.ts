export type AuthLinkPurpose = 'email_verification' | 'password_reset';

const routeByPurpose: Record<AuthLinkPurpose, string> = {
  email_verification: '/auth/verify',
  password_reset: '/reset-password',
};

export function buildAuthActionUrl(appUrl: string, purpose: AuthLinkPurpose, token: string): string {
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('Authentication email token must be 64 lowercase hexadecimal characters.');
  const origin = new URL(appUrl);
  if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password) throw new Error('Application URL must be an HTTP(S) URL without credentials.');
  const target = new URL(routeByPurpose[purpose], origin);
  target.searchParams.set('token', token);
  return target.toString();
}
