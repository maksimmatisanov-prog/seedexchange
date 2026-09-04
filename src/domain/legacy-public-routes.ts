export const LEGACY_PUBLIC_STATIC_REDIRECTS = [
  ['/directory/', '/directory'],
  ['/marketplace/', '/marketplace'],
  ['/exchange/', '/exchange'],
  ['/about/', '/about'],
  ['/pricing/', '/pricing'],
  ['/economics/', '/economics'],
  ['/terms/', '/terms'],
  ['/privacy/', '/privacy'],
] as const;

export const LEGACY_DISCOVERY_ACCOUNT_REDIRECTS = [
  ['/search/', '/search'],
  ['/register/', '/register'],
  ['/login/', '/login'],
  ['/forgot-password/', '/forgot-password'],
  ['/reset-password/', '/reset-password'],
  ['/account/', '/account'],
  ['/messages/', '/messages'],
  ['/admin/', '/admin'],
] as const;

export const LEGACY_DISCOVERY_STATIC_REDIRECTS = [
  ...LEGACY_PUBLIC_STATIC_REDIRECTS,
  ...LEGACY_DISCOVERY_ACCOUNT_REDIRECTS,
] as const;

export function legacyStaticRedirectTarget(pathname: string, search = ''): string | null {
  const match = LEGACY_DISCOVERY_STATIC_REDIRECTS.find(([legacy]) => legacy === pathname);
  return match ? `${match[1]}${search}` : null;
}
