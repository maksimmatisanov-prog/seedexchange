import type { FastifyRequest } from 'fastify';
import { config } from '../config.js';

export function pageModel(request: FastifyRequest, values: Record<string, unknown>) {
  return {
    appUrl: config.APP_URL,
    currentUser: request.currentUser,
    csrfToken: request.csrfToken,
    sessionData: request.sessionData,
    launchPhase: config.LAUNCH_PHASE,
    commerceEnabled: config.COMMERCE_ENABLED,
    ...values,
  };
}

export function money(cents: string | number | bigint, currency = 'EUR'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Number(cents) / 100);
}
