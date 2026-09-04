import Stripe from 'stripe';
import { createHash } from 'node:crypto';
import { config } from '../config.js';
import { pool } from '../db/pool.js';
import { calculateCommissionCents, calculateShippingCents, clampCartQuantity } from '../domain/rules.js';

export type Cart = Record<string, number>;
export type CartLine = { id: string; name: string; sku: string; slug: string; price_cents: string; currency: string; stock_quantity: number; quantity: number; organization_id: string; organization_name: string };

export async function loadCart(cart: Cart): Promise<{ lines: CartLine[]; subtotal: number }> {
  const ids = Object.keys(cart).filter((id) => /^\d+$/.test(id));
  if (!ids.length) return { lines: [], subtotal: 0 };
  const result = await pool.query<Omit<CartLine, 'quantity'>>(`SELECT p.id,p.name,p.sku,p.slug,p.price_cents,p.currency,p.stock_quantity,p.organization_id,o.name organization_name
    FROM products p JOIN organizations o ON o.id=p.organization_id
    WHERE p.id=ANY($1::bigint[]) AND p.status='active' AND p.purchase_mode='marketplace' AND o.status='approved' AND o.seller_status='active' AND o.marketplace_enabled=true`, [ids]);
  const lines = result.rows.map((line) => ({ ...line, quantity: clampCartQuantity(cart[line.id] ?? 0, line.stock_quantity) })).filter((line) => line.quantity > 0);
  return { lines, subtotal: lines.reduce((sum, line) => sum + Number(line.price_cents) * line.quantity, 0) };
}

function stripeClient() {
  if (!config.STRIPE_SECRET_KEY) throw Object.assign(new Error('Stripe is not configured.'), { statusCode: 503 });
  return new Stripe(config.STRIPE_SECRET_KEY);
}

export async function createCheckout(input: { userId: string | null; email: string; country: string; cart: Cart }) {
  if (!config.COMMERCE_ENABLED) throw Object.assign(new Error('Marketplace checkout is not enabled for this launch phase.'), { statusCode: 503 });
  const client = await pool.connect();
  let orderId = '';
  let lines: CartLine[] = [];
  try {
    await client.query('BEGIN');
    const ids = Object.keys(input.cart).filter((id) => /^\d+$/.test(id));
    const locked = await client.query<Omit<CartLine, 'quantity'>>(`SELECT p.id,p.name,p.sku,p.slug,p.price_cents,p.currency,p.stock_quantity,p.organization_id,o.name organization_name
      FROM products p JOIN organizations o ON o.id=p.organization_id WHERE p.id=ANY($1::bigint[]) AND p.status='active' AND p.purchase_mode='marketplace'
      AND o.status='approved' AND o.seller_status='active' AND o.marketplace_enabled=true FOR UPDATE OF p`, [ids]);
    lines = locked.rows.map((line) => ({ ...line, quantity: clampCartQuantity(input.cart[line.id] ?? 0, line.stock_quantity) })).filter((line) => line.quantity > 0);
    if (!lines.length || lines.length !== ids.length) throw Object.assign(new Error('One or more cart items are no longer available.'), { statusCode: 409 });
    const sellerIds = [...new Set(lines.map((line) => line.organization_id))];
    const zones = await client.query<{ organization_id: string; rate_cents: string }>(`SELECT DISTINCT ON(organization_id) organization_id,rate_cents FROM seller_shipping_zones
      WHERE organization_id=ANY($1::bigint[]) AND active=true AND ($2=ANY(string_to_array(replace(countries,' ',''),',')) OR countries='*') ORDER BY organization_id,id`, [sellerIds, input.country]);
    if (zones.rows.length !== sellerIds.length) throw Object.assign(new Error('At least one seller does not ship to this destination.'), { statusCode: 422 });
    const subtotal = lines.reduce((sum, line) => sum + Number(line.price_cents) * line.quantity, 0);
    const shipping = calculateShippingCents(zones.rows.map((zone) => Number(zone.rate_cents)));
    const order = await client.query<{ id: string }>(`INSERT INTO orders(user_id,email,subtotal_cents,shipping_cents,total_cents,shipping_country)
      VALUES($1,$2,$3,$4,$5,$6) RETURNING id`, [input.userId, input.email, subtotal, shipping, subtotal + shipping, input.country]);
    orderId = order.rows[0].id;
    for (const sellerId of sellerIds) {
      const sellerLines = lines.filter((line) => line.organization_id === sellerId);
      const sellerSubtotal = sellerLines.reduce((sum, line) => sum + Number(line.price_cents) * line.quantity, 0);
      const zone = zones.rows.find((item) => item.organization_id === sellerId)!;
      const organization = await client.query<{ commission_bps: number; payout_policy: string }>(`SELECT LEAST(o.commission_bps,COALESCE(CASE WHEN f.status='active' AND f.rate_expires_at>now() THEN f.founder_commission_bps END,o.commission_bps)) commission_bps,o.payout_policy
        FROM organizations o LEFT JOIN founder_program_members f ON f.organization_id=o.id WHERE o.id=$1`, [sellerId]);
      const commission = calculateCommissionCents(sellerSubtotal, organization.rows[0].commission_bps);
      const sellerOrder = await client.query<{ id: string }>(`INSERT INTO seller_orders(order_id,organization_id,subtotal_cents,shipping_cents,commission_bps,commission_cents,seller_net_cents,payout_policy)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`, [orderId, sellerId, sellerSubtotal, zone.rate_cents, organization.rows[0].commission_bps, commission, sellerSubtotal + Number(zone.rate_cents) - commission, organization.rows[0].payout_policy]);
      for (const line of sellerLines) {
        await client.query(`INSERT INTO order_items(order_id,seller_order_id,organization_id,product_id,sku,name,unit_price_cents,quantity) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [orderId, sellerOrder.rows[0].id, sellerId, line.id, line.sku, line.name, line.price_cents, line.quantity]);
        await client.query(`INSERT INTO inventory_reservations(order_id,product_id,quantity,expires_at) VALUES($1,$2,$3,now()+interval '30 minutes')`, [orderId, line.id, line.quantity]);
      }
    }
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }

  const stripe = stripeClient();
  const session = await stripe.checkout.sessions.create({
    mode: 'payment', customer_email: input.email, billing_address_collection: 'required', phone_number_collection: { enabled: true },
    shipping_address_collection: { allowed_countries: [input.country as Stripe.Checkout.SessionCreateParams.ShippingAddressCollection.AllowedCountry] },
    line_items: lines.map((line) => ({ quantity: line.quantity, price_data: { currency: line.currency.toLowerCase(), unit_amount: Number(line.price_cents), product_data: { name: line.name, metadata: { product_id: line.id, sku: line.sku } } } })),
    success_url: `${config.APP_URL}/account/orders/${orderId}?checkout=success`, cancel_url: `${config.APP_URL}/cart?checkout=cancelled`,
    metadata: { order_id: orderId }, payment_intent_data: { transfer_group: `seedexchange_order_${orderId}` },
  });
  await pool.query('UPDATE orders SET stripe_checkout_session_id=$1,transfer_group=$2 WHERE id=$3', [session.id, `seedexchange_order_${orderId}`, orderId]);
  return { orderId, url: session.url };
}

export async function handleStripeEvent(rawBody: Buffer, signature: string) {
  if (!config.STRIPE_WEBHOOK_SECRET) throw Object.assign(new Error('Stripe webhook is not configured.'), { statusCode: 503 });
  const stripe = stripeClient();
  const event = stripe.webhooks.constructEvent(rawBody, signature, config.STRIPE_WEBHOOK_SECRET);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const payloadHash = createHash('sha256').update(rawBody).digest('hex');
    const inserted = await client.query(`INSERT INTO stripe_events(stripe_event_id,event_type,payload_hash,status) VALUES($1,$2,$3,'processing') ON CONFLICT DO NOTHING RETURNING stripe_event_id`, [event.id, event.type, payloadHash]);
    if (!inserted.rowCount) { await client.query('ROLLBACK'); return { duplicate: true }; }
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      const orderId = session.metadata?.order_id;
      if (!orderId) throw new Error('Stripe session is missing order_id metadata.');
      const paymentIntent = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;
      const intent = paymentIntent ? await stripe.paymentIntents.retrieve(paymentIntent) : null;
      const chargeId = typeof intent?.latest_charge === 'string' ? intent.latest_charge : intent?.latest_charge?.id;
      await client.query(`UPDATE orders SET status='paid',stripe_payment_intent_id=$1,stripe_charge_id=$2,shipping_address_status='collected',
        shipping_name=$3,shipping_line1=$4,shipping_line2=$5,shipping_city=$6,shipping_state=$7,shipping_postal_code=$8,shipping_country=$9,shipping_phone=$10,updated_at=now()
        WHERE id=$11 AND status IN ('pending_payment','processing_payment')`, [paymentIntent, chargeId, session.customer_details?.name, session.customer_details?.address?.line1, session.customer_details?.address?.line2, session.customer_details?.address?.city, session.customer_details?.address?.state, session.customer_details?.address?.postal_code, session.customer_details?.address?.country, session.customer_details?.phone, orderId]);
      await client.query(`UPDATE products p SET stock_quantity=p.stock_quantity-r.quantity,updated_at=now() FROM inventory_reservations r WHERE r.order_id=$1 AND r.product_id=p.id AND r.status='active'`, [orderId]);
      await client.query(`UPDATE inventory_reservations SET status='converted' WHERE order_id=$1 AND status='active'`, [orderId]);
      await client.query(`UPDATE seller_orders SET status='paid',transfer_status='held',updated_at=now() WHERE order_id=$1 AND status='pending_payment'`, [orderId]);
    }
    await client.query(`UPDATE stripe_events SET status='processed',processed_at=now() WHERE stripe_event_id=$1`, [event.id]);
    await client.query('COMMIT');
    return { duplicate: false };
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}
