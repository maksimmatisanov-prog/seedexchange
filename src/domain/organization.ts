export const ORGANIZATION_CHANNELS = ['email', 'whatsapp', 'telegram', 'facebook', 'instagram', 'pinterest', 'youtube', 'tiktok', 'amazon', 'ebay'] as const;
export type OrganizationChannel = typeof ORGANIZATION_CHANNELS[number];

export const ORGANIZATION_CHANNEL_LABELS: Record<OrganizationChannel, string> = {
  email: 'Email',
  whatsapp: 'WhatsApp',
  telegram: 'Telegram',
  facebook: 'Facebook',
  instagram: 'Instagram',
  pinterest: 'Pinterest',
  youtube: 'YouTube',
  tiktok: 'TikTok',
  amazon: 'Amazon',
  ebay: 'eBay',
};

const channelHosts: Record<Exclude<OrganizationChannel, 'email'>, readonly string[]> = {
  whatsapp: ['wa.me', 'whatsapp.com', 'www.whatsapp.com'],
  telegram: ['t.me', 'telegram.me'],
  facebook: ['facebook.com', 'www.facebook.com', 'm.me'],
  instagram: ['instagram.com', 'www.instagram.com'],
  pinterest: ['pinterest.com', 'www.pinterest.com'],
  youtube: ['youtube.com', 'www.youtube.com', 'youtu.be'],
  tiktok: ['tiktok.com', 'www.tiktok.com'],
  amazon: ['amazon.com', 'www.amazon.com', 'amazon.ca', 'www.amazon.ca', 'amazon.co.uk', 'www.amazon.co.uk'],
  ebay: ['ebay.com', 'www.ebay.com', 'ebay.co.uk', 'www.ebay.co.uk'],
};

function validationError(message: string): Error {
  return Object.assign(new Error(message), { statusCode: 400 });
}

export function normalizeOrganizationChannel(type: OrganizationChannel, input: string): string | null {
  const value = input.trim();
  if (!value) return null;
  if (type === 'email') {
    const email = value.replace(/^mailto:/i, '').toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw validationError('Enter a valid public email address.');
    return `mailto:${email}`;
  }
  let url: URL;
  try { url = new URL(value); }
  catch { throw validationError(`Enter a valid ${ORGANIZATION_CHANNEL_LABELS[type]} URL.`); }
  if (url.protocol !== 'https:') throw validationError(`${ORGANIZATION_CHANNEL_LABELS[type]} URL must use HTTPS.`);
  if (!channelHosts[type].includes(url.hostname.toLowerCase())) throw validationError(`Use the official ${ORGANIZATION_CHANNEL_LABELS[type]} domain.`);
  return url.toString();
}

export function normalizePublicHttpUrl(input: string, required = false): string | null {
  const value = input.trim();
  if (!value) {
    if (required) throw validationError('A public contact URL is required.');
    return null;
  }
  let url: URL;
  try { url = new URL(value); }
  catch { throw validationError('Enter a valid public URL.'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw validationError('Public URLs must use HTTP or HTTPS.');
  return url.toString();
}
