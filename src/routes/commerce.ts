import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config } from '../config.js';
import { pageModel } from '../lib/view.js';
import { createCheckout, handleStripeEvent, loadCart, type Cart } from '../services/commerce.js';
import { assertCsrf, saveSessionData } from '../services/sessions.js';

function cartFrom(data: Record<string, unknown>): Cart { return typeof data.cart === 'object' && data.cart ? data.cart as Cart : {}; }
export async function registerCommerceRoutes(app: FastifyInstance) {
  app.get('/cart', async (request, reply) => {
    if (!config.COMMERCE_ENABLED) return reply.code(404).view('pages/not-found.ejs', pageModel(request, { title: 'Page not found', description: 'Internal marketplace checkout is not available in this launch phase.', canonical: null }));
    const cart = await loadCart(cartFrom(request.sessionData));
    return reply.view('pages/catalog/cart.ejs', pageModel(request, { title: 'Cart', description: 'Review your Seedexchange cart.', canonical: null, ...cart, checkoutEnabled: true }));
  });
  app.post('/cart/add', async (request, reply) => {
    if (!config.COMMERCE_ENABLED) return reply.code(404).send({ error: 'commerce_not_available' });
    const form = z.object({ csrf: z.string(), product_id: z.coerce.number().int().positive(), quantity: z.coerce.number().int().min(1).max(99).default(1) }).parse(request.body);
    assertCsrf(request, form.csrf);
    const cart = cartFrom(request.sessionData); cart[String(form.product_id)] = Math.min((cart[String(form.product_id)] ?? 0) + form.quantity, 99);
    await saveSessionData(request, { ...request.sessionData, cart });
    return reply.redirect('/cart', 303);
  });
  app.post('/cart/remove', async (request, reply) => {
    if (!config.COMMERCE_ENABLED) return reply.code(404).send({ error: 'commerce_not_available' });
    const form = z.object({ csrf: z.string(), product_id: z.coerce.number().int().positive() }).parse(request.body);
    assertCsrf(request, form.csrf);
    const cart = cartFrom(request.sessionData); delete cart[String(form.product_id)];
    await saveSessionData(request, { ...request.sessionData, cart });
    return reply.redirect('/cart', 303);
  });
  app.post('/checkout/create', async (request, reply) => {
    if (!config.COMMERCE_ENABLED) return reply.code(404).send({ error: 'commerce_not_available' });
    const form = z.object({ csrf: z.string(), email: z.string().email(), country: z.string().length(2).toUpperCase() }).parse(request.body);
    assertCsrf(request, form.csrf);
    const checkout = await createCheckout({ userId: request.currentUser?.id ?? null, email: form.email, country: form.country, cart: cartFrom(request.sessionData) });
    if (!checkout.url) throw new Error('Stripe did not return a checkout URL.');
    return reply.redirect(checkout.url, 303);
  });
  await app.register(async (scope) => {
    scope.removeContentTypeParser('application/json');
    scope.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_request, body, done) => done(null, body));
    scope.post('/webhook/stripe', async (request, reply) => {
      if (!config.COMMERCE_ENABLED) return reply.code(404).send({ received: false });
      const signature = request.headers['stripe-signature'];
      if (typeof signature !== 'string' || !Buffer.isBuffer(request.body)) return reply.code(400).send({ received: false });
      await handleStripeEvent(request.body, signature);
      return { received: true };
    });
  });
}
