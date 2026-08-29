import Fastify from 'fastify';
import fastifyView from '@fastify/view';
import fastifyFormbody from '@fastify/formbody';
import fastifyStatic from '@fastify/static';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyWebsocket from '@fastify/websocket';
import path from 'path';
import { fileURLToPath } from 'url';
import EJS from 'ejs';
import { config } from './config.js';
import { pool } from './db/pool.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = Fastify({
  logger: config.NODE_ENV === 'development',
  trustProxy: true,
});

// --- Plugins ---

await app.register(fastifyFormbody);

await app.register(fastifyView, {
  engine: { ejs: EJS },
  root: path.join(__dirname, 'templates'),
  options: {
    views: [path.join(__dirname, 'templates')],
  },
  layout: 'layouts/base',
});

await app.register(fastifyStatic, {
  root: path.join(__dirname, '..', 'public'),
  prefix: '/',
});

await app.register(fastifyRateLimit, {
  max: 100,
  timeWindow: '1 minute',
});

await app.register(fastifyWebsocket);

// --- Helpers ---

app.decorate('formatMoney', (cents: number, currency = 'EUR') => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  }).format(cents / 100);
});

app.decorate('e', (str: string) => {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
});

// --- Middleware: Security headers ---

app.addHook('onRequest', async (request, reply) => {
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (config.NODE_ENV === 'production') {
    reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
});

// --- Routes ---

// Health check
app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

// Home page
app.get('/', async (request, reply) => {
  const stats = {
    organizations: 0,
    products: 0,
    exchanges: 0,
  };

  try {
    const orgResult = await pool.query('SELECT COUNT(*) FROM organizations WHERE status = $1', ['approved']);
    const productResult = await pool.query('SELECT COUNT(*) FROM products WHERE status = $1', ['active']);
    const exchangeResult = await pool.query('SELECT COUNT(*) FROM exchange_listings WHERE status = $1', ['active']);
    stats.organizations = parseInt(orgResult.rows[0].count);
    stats.products = parseInt(productResult.rows[0].count);
    stats.exchanges = parseInt(exchangeResult.rows[0].count);
  } catch (err) {
    // DB not yet connected, use defaults
  }

  return reply.view('pages/home.ejs', {
    title: 'Seedexchange',
    description: 'A public directory, exchange and seed marketplace for documented collections and the people who care for them.',
    canonical: '/',
    stats,
  });
});

// Static pages
const staticPages = ['about', 'pricing', 'economics', 'terms', 'privacy'];
for (const page of staticPages) {
  app.get(`/${page}`, async (request, reply) => {
    return reply.view(`pages/${page}.ejs`, {
      title: page.charAt(0).toUpperCase() + page.slice(1),
      description: `Seedexchange — ${page}`,
      canonical: `/${page}`,
    });
  });
}

// robots.txt
app.get('/robots.txt', async (request, reply) => {
  reply.type('text/plain');
  return `User-agent: *
Allow: /

Sitemap: ${config.APP_URL}/sitemap.xml`;
});

// llms.txt
app.get('/llms.txt', async (request, reply) => {
  reply.type('text/plain');
  return `# Seedexchange

> A public directory, non-commercial exchange and multi-vendor marketplace for documented seed collections.

## Public sections

- [Home](${config.APP_URL}/)
- [Organization directory](${config.APP_URL}/directory/)
- [Seed marketplace](${config.APP_URL}/marketplace/)
- [Exchange and donations](${config.APP_URL}/exchange/)
- [About](${config.APP_URL}/about/)
- [Platform terms](${config.APP_URL}/terms/)
- [Privacy](${config.APP_URL}/privacy/)`;
});

// --- Start ---

const start = async () => {
  try {
    await app.listen({ port: config.PORT, host: '0.0.0.0' });
    console.log(`Seedexchange running on http://localhost:${config.PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
