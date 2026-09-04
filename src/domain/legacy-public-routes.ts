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

const legacyIndexExactTargets = new Set([
  '/', '/directory', '/marketplace', '/exchange', '/search',
  '/about', '/pricing', '/economics', '/terms', '/privacy',
  '/register', '/login', '/forgot-password', '/reset-password',
  '/account', '/messages', '/admin', '/auth/verify',
]);

export function legacyIndexRedirectTarget(searchParams: URLSearchParams): string | null {
  const routes = searchParams.getAll('_route');
  if (routes.length !== 1) return null;
  const route = routes[0].replace(/\/$/, '') || '/';
  let target: string | null = legacyIndexExactTargets.has(route) ? route : null;
  const publicRecord = /^\/(?:directory|product)\/[a-z0-9-]{1,190}$/.exec(route);
  const preservedPrivateRecord = /^\/(?:messages\/[1-9][0-9]*|account\/orders\/[1-9][0-9]*)$/.exec(route);
  const sellerWorkspace = /^\/seller\/([1-9][0-9]*)$/.exec(route);
  if (publicRecord || preservedPrivateRecord) target = route;
  else if (sellerWorkspace) target = `/seller/organization/${sellerWorkspace[1]}`;
  if (!target) return null;
  const remaining = new URLSearchParams(searchParams);
  remaining.delete('_route');
  const query = remaining.toString();
  return `${target}${query ? `?${query}` : ''}`;
}
