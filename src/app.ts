import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import fastifyView from '@fastify/view';
import Fastify from 'fastify';
import EJS from 'ejs';
import path from 'node:path';
import { config } from './config.js';
import { pageModel } from './lib/view.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerCommerceRoutes } from './routes/commerce.js';
import { registerMessageRoutes } from './routes/messages.js';
import { registerOperationRoutes } from './routes/operations.js';
import { registerPublicRoutes } from './routes/public.js';
import { registerSessions } from './services/sessions.js';

const projectRoot = process.cwd();
export async function buildApp() {
  const app = Fastify({ logger: config.NODE_ENV !== 'test', trustProxy: config.TRUST_PROXY });
  await app.register(cookie, { secret: config.SESSION_SECRET, hook: 'onRequest' });
  await app.register(formbody);
  await app.register(multipart, { limits: { fileSize: config.MEDIA_MAX_BYTES, files: 1 } });
  await app.register(rateLimit, { max: config.NODE_ENV === 'test' ? 10_000 : 100, timeWindow: '1 minute' });
  await app.register(fastifyView, { engine: { ejs: EJS }, root: path.join(projectRoot, 'src', 'templates'), layout: 'layouts/base' });
  await app.register(fastifyStatic, { root: path.join(projectRoot, 'public'), prefix: '/' });
  app.addHook('onRequest', async (_request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    reply.header('Content-Security-Policy', "default-src 'self'; img-src 'self' https: data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    if (config.NODE_ENV === 'production') reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  });
  await registerSessions(app);
  await registerPublicRoutes(app);
  await registerAuthRoutes(app);
  await registerCommerceRoutes(app);
  await registerMessageRoutes(app);
  await registerOperationRoutes(app);
  app.setNotFoundHandler(async (request, reply) => reply.code(404).view('pages/not-found.ejs', pageModel(request, { title: 'Page not found', description: 'This page does not exist.', canonical: null })));
  app.setErrorHandler(async (error, request, reply) => {
    request.log.error({ err: error }, 'Request failed');
    const normalized = error instanceof Error ? error : new Error('Unknown request error');
    const status = 'statusCode' in normalized && typeof normalized.statusCode === 'number' ? normalized.statusCode : normalized.name === 'ZodError' ? 400 : 500;
    return reply.code(status).view('pages/error.ejs', pageModel(request, { title: status === 500 ? 'Something went wrong' : 'Request could not be completed', description: normalized.message, canonical: null, status, message: status === 500 ? 'The error was logged. Please try again.' : normalized.message }));
  });
  return app;
}
