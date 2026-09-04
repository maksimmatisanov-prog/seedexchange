import { isIP } from 'node:net';

const publicHostnamePattern = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

export function normalizeExternalHttpsUrl(value: unknown, required = false): string | null {
  const input = typeof value === 'string' ? value.trim() : '';
  if (!input) {
    if (required) throw Object.assign(new Error('A public HTTPS URL is required.'), { statusCode: 400 });
    return null;
  }
  let url: URL;
  try { url = new URL(input); }
  catch { throw Object.assign(new Error('Enter a valid public HTTPS URL.'), { statusCode: 400 }); }
  if (url.protocol !== 'https:' || url.username || url.password || isIP(url.hostname) !== 0 || !publicHostnamePattern.test(url.hostname)) {
    throw Object.assign(new Error('Use a public HTTPS URL without embedded credentials.'), { statusCode: 400 });
  }
  return url.toString();
}

export function isExternalHttpsUrl(value: unknown): boolean {
  try { return normalizeExternalHttpsUrl(value, true) !== null; }
  catch { return false; }
}

export function sanitizePublicProductUrls(product: {
  purchase_mode: string;
  external_purchase_url: unknown;
  image_url: unknown;
}): { external_purchase_url: string | null; image_url: string | null } | null {
  let externalPurchaseUrl: string | null = null;
  if (product.purchase_mode === 'external') {
    try { externalPurchaseUrl = normalizeExternalHttpsUrl(product.external_purchase_url, true); }
    catch { return null; }
  }

  let imageUrl: string | null = null;
  if (typeof product.image_url === 'string' && /^\/media\/[a-f0-9]{40}\.webp$/.test(product.image_url)) {
    imageUrl = product.image_url;
  } else {
    try { imageUrl = normalizeExternalHttpsUrl(product.image_url); }
    catch { imageUrl = null; }
  }
  return { external_purchase_url: externalPurchaseUrl, image_url: imageUrl };
}
