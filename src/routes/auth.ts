import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcrypt';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { pageModel } from '../lib/view.js';
import { audit } from '../services/audit.js';
import { assertCsrf, destroySession, requireUser, rotateSession } from '../services/sessions.js';

const emailSchema = z.string().trim().toLowerCase().email().max(190);
const passwordSchema = z.string().min(10).max(200);

async function consumeAuthAttempt(action: string, key: string, limit: number): Promise<void> {
  const bucket = createHash('sha256').update(`${action}:${key}`).digest('hex');
  const result = await pool.query<{ attempts: number; blocked_until: string | null }>(`INSERT INTO auth_rate_limits(bucket_hash,action,attempts,window_started_at,updated_at)
    VALUES($1,$2,1,now(),now()) ON CONFLICT(bucket_hash,action) DO UPDATE SET
    attempts=CASE WHEN auth_rate_limits.window_started_at<now()-interval '15 minutes' THEN 1 ELSE auth_rate_limits.attempts+1 END,
    window_started_at=CASE WHEN auth_rate_limits.window_started_at<now()-interval '15 minutes' THEN now() ELSE auth_rate_limits.window_started_at END,
    blocked_until=CASE WHEN auth_rate_limits.attempts+1>=$3 THEN now()+interval '15 minutes' ELSE auth_rate_limits.blocked_until END,
    updated_at=now() RETURNING attempts,blocked_until`, [bucket, action, limit]);
  if (result.rows[0]?.blocked_until && new Date(result.rows[0].blocked_until).getTime() > Date.now()) {
    throw Object.assign(new Error('Too many attempts. Try again in 15 minutes.'), { statusCode: 429 });
  }
}

function compatibleBcryptHash(hash: string): string {
  return hash.startsWith('$2y$') ? `$2b$${hash.slice(4)}` : hash;
}

export async function registerAuthRoutes(app: FastifyInstance) {
  app.get('/register', async (request, reply) => reply.view('pages/auth/register.ejs', pageModel(request, { title: 'Create an account', description: 'Join Seedexchange.', canonical: '/register', error: null })));
  app.post('/register', async (request, reply) => {
    const form = z.object({ csrf: z.string(), email: emailSchema, password: passwordSchema }).parse(request.body);
    assertCsrf(request, form.csrf);
    await consumeAuthAttempt('register', `${request.ip}:${form.email}`, 5);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const created = await client.query<{ id: string }>('INSERT INTO users(email,password_hash) VALUES($1,$2) RETURNING id', [form.email, await bcrypt.hash(form.password, 12)]);
      const token = randomBytes(32).toString('hex');
      const hash = createHash('sha256').update(token).digest('hex');
      await client.query(`INSERT INTO auth_tokens(user_id,purpose,token_hash,expires_at) VALUES($1,'email_verification',$2,now()+interval '24 hours')`, [created.rows[0].id, hash]);
      await client.query('INSERT INTO outbox_messages(event_key,recipient,subject,body) VALUES($1,$2,$3,$4)', [`verify:${created.rows[0].id}:${hash}`, form.email, 'Verify your Seedexchange email', `Verify your email: /auth/verify?token=${token}`]);
      await client.query('COMMIT');
      await rotateSession(request, reply, created.rows[0].id);
      await audit(created.rows[0].id, 'user', created.rows[0].id, 'user.registered');
      return reply.redirect('/account', 303);
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      if ((error as { code?: string }).code === '23505') return reply.code(409).view('pages/auth/register.ejs', pageModel(request, { title: 'Create an account', description: 'Join Seedexchange.', canonical: '/register', error: 'An account already exists for this email.' }));
      throw error;
    } finally { client.release(); }
  });

  app.get('/login', async (request, reply) => reply.view('pages/auth/login.ejs', pageModel(request, { title: 'Sign in', description: 'Sign in to Seedexchange.', canonical: '/login', error: null })));
  app.post('/login', async (request, reply) => {
    const form = z.object({ csrf: z.string(), email: emailSchema, password: z.string().max(200) }).parse(request.body);
    assertCsrf(request, form.csrf);
    await consumeAuthAttempt('login', `${request.ip}:${form.email}`, 8);
    const result = await pool.query<{ id: string; password_hash: string }>('SELECT id,password_hash FROM users WHERE email=$1', [form.email]);
    if (!result.rows[0] || !(await bcrypt.compare(form.password, compatibleBcryptHash(result.rows[0].password_hash)))) return reply.code(401).view('pages/auth/login.ejs', pageModel(request, { title: 'Sign in', description: 'Sign in to Seedexchange.', canonical: '/login', error: 'Email or password is incorrect.' }));
    if (result.rows[0].password_hash.startsWith('$2y$') || bcrypt.getRounds(compatibleBcryptHash(result.rows[0].password_hash)) < 12) {
      await pool.query('UPDATE users SET password_hash=$1 WHERE id=$2', [await bcrypt.hash(form.password, 12), result.rows[0].id]);
    }
    await pool.query('UPDATE users SET last_login_at=now() WHERE id=$1', [result.rows[0].id]);
    await rotateSession(request, reply, result.rows[0].id);
    await audit(result.rows[0].id, 'user', result.rows[0].id, 'user.logged_in');
    return reply.redirect('/account', 303);
  });
  app.post('/logout', async (request, reply) => {
    assertCsrf(request, z.object({ csrf: z.string() }).parse(request.body).csrf);
    await destroySession(request, reply);
    return reply.redirect('/', 303);
  });
  app.get('/auth/verify', async (request, reply) => {
    const query = z.object({ token: z.string().length(64) }).parse(request.query);
    const result = await pool.query<{ user_id: string }>(`UPDATE auth_tokens SET consumed_at=now() WHERE token_hash=$1 AND purpose='email_verification' AND consumed_at IS NULL AND expires_at>now() RETURNING user_id`, [createHash('sha256').update(query.token).digest('hex')]);
    if (!result.rows[0]) return reply.code(400).view('pages/message.ejs', pageModel(request, { title: 'Verification link invalid', description: 'The link expired or was already used.', canonical: null, message: 'Request a new verification email from your account.' }));
    await pool.query('UPDATE users SET email_verified_at=COALESCE(email_verified_at,now()) WHERE id=$1', [result.rows[0].user_id]);
    return reply.view('pages/message.ejs', pageModel(request, { title: 'Email verified', description: 'Your email is verified.', canonical: null, message: 'You can now submit an organization for review.' }));
  });
  app.get('/forgot-password', async (request, reply) => reply.view('pages/auth/forgot-password.ejs', pageModel(request, { title: 'Reset your password', description: 'Request a password reset link.', canonical: null })));
  app.post('/forgot-password', async (request, reply) => {
    const form = z.object({ csrf: z.string(), email: emailSchema }).parse(request.body);
    assertCsrf(request, form.csrf);
    await consumeAuthAttempt('password_reset', `${request.ip}:${form.email}`, 5);
    const user = await pool.query<{ id: string }>('SELECT id FROM users WHERE email=$1', [form.email]);
    if (user.rows[0]) {
      const token = randomBytes(32).toString('hex');
      const hash = createHash('sha256').update(token).digest('hex');
      await pool.query(`UPDATE auth_tokens SET consumed_at=now() WHERE user_id=$1 AND purpose='password_reset' AND consumed_at IS NULL`, [user.rows[0].id]);
      await pool.query(`INSERT INTO auth_tokens(user_id,purpose,token_hash,expires_at) VALUES($1,'password_reset',$2,now()+interval '1 hour')`, [user.rows[0].id, hash]);
      await pool.query(`INSERT INTO outbox_messages(event_key,recipient,subject,body) VALUES($1,$2,$3,$4)`, [`reset:${user.rows[0].id}:${hash}`, form.email, 'Reset your Seedexchange password', `Reset your password: ${process.env.APP_URL ?? 'https://seedexchange.online'}/reset-password?token=${token}`]);
    }
    return reply.view('pages/message.ejs', pageModel(request, { title: 'Check your email', description: 'Password reset requested.', canonical: null, message: 'If that address belongs to an account, a reset link has been queued.' }));
  });
  app.get('/reset-password', async (request, reply) => {
    const query = z.object({ token: z.string().length(64) }).parse(request.query);
    return reply.view('pages/auth/reset-password.ejs', pageModel(request, { title: 'Choose a new password', description: 'Set a new account password.', canonical: null, token: query.token, error: null }));
  });
  app.post('/reset-password', async (request, reply) => {
    const form = z.object({ csrf: z.string(), token: z.string().length(64), password: passwordSchema }).parse(request.body);
    assertCsrf(request, form.csrf);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const token = await client.query<{ id: string; user_id: string }>(`UPDATE auth_tokens SET consumed_at=now() WHERE token_hash=$1 AND purpose='password_reset' AND consumed_at IS NULL AND expires_at>now() RETURNING id,user_id`, [createHash('sha256').update(form.token).digest('hex')]);
      if (!token.rows[0]) throw Object.assign(new Error('This reset link is invalid or expired.'), { statusCode: 400 });
      await client.query('UPDATE users SET password_hash=$1 WHERE id=$2', [await bcrypt.hash(form.password, 12), token.rows[0].user_id]);
      await client.query('DELETE FROM sessions WHERE user_id=$1', [token.rows[0].user_id]);
      await client.query('COMMIT');
      await audit(token.rows[0].user_id, 'user', token.rows[0].user_id, 'user.password_reset');
      return reply.view('pages/message.ejs', pageModel(request, { title: 'Password updated', description: 'Your password has been reset.', canonical: null, message: 'Sign in with your new password.' }));
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  });
  app.get('/account', async (request, reply) => {
    const user = requireUser(request);
    const [organizations, orders, notifications] = await Promise.all([
      pool.query('SELECT o.*,m.role member_role FROM organization_members m JOIN organizations o ON o.id=m.organization_id WHERE m.user_id=$1 ORDER BY o.created_at DESC', [user.id]),
      pool.query('SELECT * FROM orders WHERE user_id=$1 ORDER BY created_at DESC LIMIT 25', [user.id]),
      pool.query('SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 25', [user.id]),
    ]);
    return reply.view('pages/account/index.ejs', pageModel(request, { title: 'Account', description: 'Your Seedexchange workspace.', canonical: null, organizations: organizations.rows, orders: orders.rows, notifications: notifications.rows }));
  });
  app.get<{ Params: { id: string } }>('/account/orders/:id', async (request, reply) => {
    const user = requireUser(request);
    const order = await pool.query('SELECT * FROM orders WHERE id=$1 AND user_id=$2', [request.params.id, user.id]);
    if (!order.rows[0]) throw Object.assign(new Error('Order not found.'), { statusCode: 404 });
    const [sellerOrders, items] = await Promise.all([
      pool.query(`SELECT s.*,o.name organization_name FROM seller_orders s JOIN organizations o ON o.id=s.organization_id WHERE s.order_id=$1 ORDER BY s.id`, [request.params.id]),
      pool.query('SELECT * FROM order_items WHERE order_id=$1 ORDER BY id', [request.params.id]),
    ]);
    return reply.view('pages/account/order.ejs', pageModel(request, { title: `Order #${request.params.id}`, description: 'Order details and fulfilment status.', canonical: null, order: order.rows[0], sellerOrders: sellerOrders.rows, items: items.rows }));
  });
}
