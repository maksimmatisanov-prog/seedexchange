import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import path from 'node:path';
import { z } from 'zod';
import { config } from '../config.js';
import { content } from '../content/en.js';
import { pool } from '../db/pool.js';
import { pageModel } from '../lib/view.js';
import { getOrganization, getProduct, homeModel, listExchanges, listOrganizations, listProducts } from '../services/catalog.js';

const slugSchema = z.string().regex(/^[a-z0-9-]{1,190}$/);

function legacyQuerySlug(query: unknown): string | null {
  const parsed = z.object({ slug: slugSchema.optional() }).safeParse(query);
  return parsed.success ? parsed.data.slug ?? null : null;
}

export async function registerPublicRoutes(app: FastifyInstance) {
  app.get<{ Params: { key: string } }>('/media/:key', async (request, reply) => {
    const key = z.string().regex(/^[a-f0-9]{40}\.webp$/).parse(request.params.key);
    return reply.sendFile(key, path.resolve(config.MEDIA_ROOT), { immutable: true, maxAge: '1y' });
  });
  app.get('/health', async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
    launchPhase: config.LAUNCH_PHASE,
    commerceEnabled: config.COMMERCE_ENABLED,
    connectEnabled: config.CONNECT_ENABLED,
    marketplacePaymentsEnabled: config.MARKETPLACE_PAYMENTS_ENABLED,
    payoutWorkerEnabled: config.PAYOUT_WORKER_ENABLED,
  }));
  app.get('/ready', async (_request, reply) => {
    try {
      const result = await pool.query<{ version: string }>('SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1');
      if (!result.rows[0]) return reply.code(503).send({ status: 'not_ready', reason: 'migrations_missing' });
      return {
        status: 'ready',
        database: 'ok',
        migration: result.rows[0].version,
        launchPhase: config.LAUNCH_PHASE,
        commerceEnabled: config.COMMERCE_ENABLED,
        connectEnabled: config.CONNECT_ENABLED,
        marketplacePaymentsEnabled: config.MARKETPLACE_PAYMENTS_ENABLED,
        payoutWorkerEnabled: config.PAYOUT_WORKER_ENABLED,
      };
    } catch { return reply.code(503).send({ status: 'not_ready', reason: 'database_unavailable' }); }
  });

  app.get('/', async (request, reply) => {
    const query = z.object({ _route: z.string().optional() }).parse(request.query);
    if (query._route?.startsWith('/') && !query._route.startsWith('//')) return reply.redirect(query._route, 301);
    let model = { stats: { organizations: '0', products: '0', exchanges: '0' }, organizations: [], products: [], exchanges: [] } as Awaited<ReturnType<typeof homeModel>>;
    try { model = await homeModel(); } catch (error) { request.log.debug({ err: error }, 'Home read model unavailable'); }
    return reply.view('pages/home.ejs', pageModel(request, { ...content.home, canonical: '/', ...model }));
  });

  const directoryIndex = async (request: FastifyRequest, reply: FastifyReply) => {
    const legacySlug = legacyQuerySlug(request.query);
    if (legacySlug) return reply.redirect(`/directory/${legacySlug}`, 301);
    if (new URL(request.url, 'http://localhost').pathname === '/directory/') return reply.redirect('/directory', 301);
    let organizations: Awaited<ReturnType<typeof listOrganizations>> = [];
    try { organizations = await listOrganizations(); } catch (error) { request.log.debug({ err: error }, 'Directory unavailable'); }
    return reply.view('pages/catalog/directory.ejs', pageModel(request, { ...content.directory, canonical: '/directory', organizations }));
  };
  app.get('/directory', directoryIndex);
  app.get('/directory/', directoryIndex);
  app.get<{ Params: { slug: string } }>('/directory/:slug', async (request, reply) => {
    const organization = await getOrganization(slugSchema.parse(request.params.slug));
    if (!organization) return reply.code(404).view('pages/not-found.ejs', pageModel(request, { title: 'Organization not found', description: 'This organization is not available.', canonical: null }));
    return reply.view('pages/catalog/organization.ejs', pageModel(request, { title: organization.name, description: organization.description, canonical: `/directory/${organization.slug}`, organization }));
  });

  app.get('/marketplace', async (request, reply) => {
    const query = z.object({ q: z.string().trim().max(100).optional(), category: z.string().trim().max(100).optional() }).parse(request.query);
    let products: Awaited<ReturnType<typeof listProducts>> = [];
    try { products = await listProducts(query); } catch (error) { request.log.debug({ err: error }, 'Marketplace unavailable'); }
    return reply.view('pages/catalog/marketplace.ejs', pageModel(request, { ...content.marketplace, canonical: '/marketplace', products, filters: query }));
  });
  app.get('/search', async (request, reply) => {
    const query = z.object({ q: z.string().trim().max(100).default('') }).parse(request.query);
    const products = query.q ? await listProducts({ q: query.q }) : [];
    return reply.view('pages/catalog/search.ejs', pageModel(request, { title: 'Search', description: 'Search documented seeds and accessions.', canonical: query.q ? null : '/search', products, q: query.q }));
  });
  const legacyProduct = async (request: FastifyRequest, reply: FastifyReply) => {
    const legacySlug = legacyQuerySlug(request.query);
    if (legacySlug) return reply.redirect(`/product/${legacySlug}`, 301);
    return reply.code(404).view('pages/not-found.ejs', pageModel(request, { title: 'Product not found', description: 'This product is not available.', canonical: null }));
  };
  app.get('/product', legacyProduct);
  app.get('/product/', legacyProduct);
  app.get<{ Params: { slug: string } }>('/product/:slug', async (request, reply) => {
    const product = await getProduct(slugSchema.parse(request.params.slug));
    if (!product) return reply.code(404).view('pages/not-found.ejs', pageModel(request, { title: 'Product not found', description: 'This product is not available.', canonical: null }));
    return reply.view('pages/catalog/product.ejs', pageModel(request, { title: product.name, description: product.description, canonical: `/product/${product.slug}`, product }));
  });

  app.get('/exchange', async (request, reply) => {
    let exchanges: Awaited<ReturnType<typeof listExchanges>> = [];
    try { exchanges = await listExchanges(); } catch (error) { request.log.debug({ err: error }, 'Exchange unavailable'); }
    return reply.view('pages/catalog/exchange.ejs', pageModel(request, { ...content.exchange, canonical: '/exchange', exchanges }));
  });

  for (const page of ['about', 'pricing', 'economics', 'terms', 'privacy'] as const) {
    app.get(`/${page}`, async (request, reply) => reply.view(`pages/${page}.ejs`, pageModel(request, { title: page.charAt(0).toUpperCase() + page.slice(1), description: `Seedexchange ${page}`, canonical: `/${page}` })));
  }
  app.get('/robots.txt', async (_request, reply) => reply.type('text/plain').send(`User-agent: *\nAllow: /\n\nSitemap: ${config.APP_URL}/sitemap.xml`));
  app.get('/llms.txt', async (_request, reply) => reply.type('text/plain').send('# Seedexchange\n\nA directory, exchange and multi-vendor marketplace for documented seed collections.\n'));
  app.get('/sitemap.xml', async (_request, reply) => {
    const paths = ['/', '/directory', '/marketplace', '/exchange', '/about', '/pricing', '/economics', '/terms', '/privacy'];
    try {
      const dynamic = await pool.query<{ path: string }>(`SELECT '/directory/'||slug path FROM organizations WHERE status='approved' UNION ALL SELECT '/product/'||slug path FROM products WHERE status='active' AND purchase_mode=ANY($1::text[]) AND (purchase_mode<>'external' OR external_purchase_url~*'^https://')`, [config.PUBLIC_PRODUCT_MODES]);
      paths.push(...dynamic.rows.map((row) => row.path));
    } catch { /* base sitemap remains available before the first migration */ }
    return reply.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths.map((item) => `<url><loc>${config.APP_URL}${item}</loc></url>`).join('')}</urlset>`);
  });
}
