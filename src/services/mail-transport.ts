import nodemailer from 'nodemailer';
import { config } from '../config.js';

export function createConfiguredMailTransport() {
  if (!config.MAIL_HOST || !config.MAIL_USER || !config.MAIL_PASS || !config.MAIL_FROM) throw new Error('SMTP configuration is incomplete.');
  return nodemailer.createTransport({
    host: config.MAIL_HOST,
    port: config.MAIL_PORT,
    secure: config.MAIL_ENCRYPTION === 'ssl',
    requireTLS: config.MAIL_ENCRYPTION === 'tls',
    auth: { user: config.MAIL_USER, pass: config.MAIL_PASS },
    tls: { servername: config.MAIL_HOST },
    connectionTimeout: 5_000,
    greetingTimeout: 5_000,
    socketTimeout: 10_000,
  });
}
