const safeCodes = new Set(['EAUTH', 'ECONNECTION', 'EDNS', 'ESOCKET', 'ETIMEDOUT', 'ETLS']);

export function productionMailFailureCode(error: unknown): string {
  if (!error || typeof error !== 'object' || !('code' in error) || typeof error.code !== 'string') return 'SMTP_VERIFICATION_FAILED';
  return safeCodes.has(error.code) ? error.code : 'SMTP_VERIFICATION_FAILED';
}
