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

export function legacyStaticRedirectTarget(pathname: string, search = ''): string | null {
  const match = LEGACY_PUBLIC_STATIC_REDIRECTS.find(([legacy]) => legacy === pathname);
  return match ? `${match[1]}${search}` : null;
}
