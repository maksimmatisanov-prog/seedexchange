import Stripe from 'stripe';
import { config } from '../src/config.js';
import { pool } from '../src/db/pool.js';

if (!config.COMMERCE_ENABLED) {
  console.log(JSON.stringify({ skipped: true, reason: 'commerce_launch_phase_disabled', launchPhase: config.LAUNCH_PHASE }));
  await pool.end();
  process.exit(0);
}

const expired = await pool.query(`WITH released AS (UPDATE inventory_reservations SET status='released' WHERE status='active' AND expires_at<=now() RETURNING order_id)
  UPDATE orders SET status='cancelled',updated_at=now() WHERE id IN (SELECT order_id FROM released) AND status='pending_payment' RETURNING id`);
await pool.query(`UPDATE founder_program_members SET status='rate_expired' WHERE status='active' AND rate_expires_at<=now()`);
await pool.query(`UPDATE seller_orders so SET transfer_status='eligible',transfer_eligible_at=COALESCE(transfer_eligible_at,now()),updated_at=now()
  WHERE transfer_status='held' AND ((payout_policy='standard' AND shipped_at IS NOT NULL) OR (payout_policy='delivery_protected' AND (delivered_at IS NOT NULL OR delivery_due_at<=now())))
  AND NOT EXISTS(SELECT 1 FROM delivery_cases dc WHERE dc.seller_order_id=so.id AND dc.status IN ('open','reviewing'))`);
let paid = 0; let failed = 0;
if (config.PAYOUT_WORKER_ENABLED) {
  if (!config.STRIPE_SECRET_KEY) throw new Error('Payout worker requires STRIPE_SECRET_KEY.');
  const stripe = new Stripe(config.STRIPE_SECRET_KEY);
  const eligible = await pool.query<{ id:string; organization_id:string; seller_net_cents:string; currency:string; stripe_account_id:string; stripe_charge_id:string }>(`SELECT so.id,so.organization_id,so.seller_net_cents,so.currency,o.stripe_account_id,ord.stripe_charge_id
    FROM seller_orders so JOIN organizations o ON o.id=so.organization_id JOIN orders ord ON ord.id=so.order_id
    WHERE so.transfer_status='eligible' AND o.stripe_payouts_enabled=true ORDER BY so.id LIMIT 20`);
  for (const item of eligible.rows) {
    try {
      await pool.query(`UPDATE seller_orders SET transfer_status='processing',updated_at=now() WHERE id=$1 AND transfer_status='eligible'`,[item.id]);
      const transfer=await stripe.transfers.create({amount:Number(item.seller_net_cents),currency:item.currency.toLowerCase(),destination:item.stripe_account_id,source_transaction:item.stripe_charge_id,metadata:{seller_order_id:item.id}},{idempotencyKey:`seller-order-${item.id}`});
      await pool.query(`UPDATE seller_orders SET transfer_status='paid',stripe_transfer_id=$1,updated_at=now() WHERE id=$2`,[transfer.id,item.id]);
      await pool.query(`INSERT INTO seller_transfers(seller_order_id,organization_id,amount_cents,currency,status,stripe_transfer_id,attempts,processed_at) VALUES($1,$2,$3,$4,'paid',$5,1,now()) ON CONFLICT(seller_order_id) DO UPDATE SET status='paid',stripe_transfer_id=EXCLUDED.stripe_transfer_id,processed_at=now()`,[item.id,item.organization_id,item.seller_net_cents,item.currency,transfer.id]); paid++;
    } catch(error){await pool.query(`UPDATE seller_orders SET transfer_status='failed',updated_at=now() WHERE id=$1`,[item.id]);await pool.query(`INSERT INTO seller_transfers(seller_order_id,organization_id,amount_cents,currency,status,attempts,last_error) VALUES($1,$2,$3,$4,'failed',1,$5) ON CONFLICT(seller_order_id) DO UPDATE SET status='failed',attempts=seller_transfers.attempts+1,last_error=EXCLUDED.last_error`,[item.id,item.organization_id,item.seller_net_cents,item.currency,String(error).slice(0,500)]);failed++;}
  }
}
console.log(JSON.stringify({ expiredOrders: expired.rowCount, transfersPaid: paid, transfersFailed: failed, payoutWorkerEnabled: config.PAYOUT_WORKER_ENABLED })); await pool.end();
