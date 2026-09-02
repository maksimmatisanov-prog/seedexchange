import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config.js';
import { pool } from '../db/pool.js';
import type { CurrentUser } from '../types/fastify.js';

type SessionRow = {
  id: string;
  csrf_token: string;
  data: Record<string, unknown>;
  user_id: string | null;
  email: string | null;
  role: CurrentUser['role'] | null;
  email_verified_at: string | null;
};

const cookieName = 'seedexchange_session';

export async function registerSessions(app: FastifyInstance): Promise<void> {
  app.decorateRequest('currentUser', null);
  app.decorateRequest('sessionId', null);
  app.decorateRequest('csrfToken', null);
  app.decorateRequest('sessionData');

  app.addHook('preHandler', async (request, reply) => {
    request.currentUser = null;
    request.sessionId = null;
    request.csrfToken = null;
    request.sessionData = {};
    if (request.url === '/health') return;
    try {
      const signed = request.cookies[cookieName];
      const unsigned = signed ? request.unsignCookie(signed) : null;
      const incomingId = unsigned?.valid ? unsigned.value : null;
      let row: SessionRow | undefined;
      if (incomingId) {
        const result = await pool.query<SessionRow>(`SELECT s.id,s.csrf_token,s.data,s.user_id,u.email,u.role,u.email_verified_at
          FROM sessions s LEFT JOIN users u ON u.id=s.user_id
          WHERE s.id=$1 AND s.expires_at>now()`, [incomingId]);
        row = result.rows[0];
      }
      if (!row) row = await createSession(reply);
      request.sessionId = row.id;
      request.csrfToken = row.csrf_token;
      request.sessionData = row.data ?? {};
      if (row.user_id && row.email && row.role) {
        request.currentUser = { id: String(row.user_id), email: row.email, role: row.role, emailVerifiedAt: row.email_verified_at };
      }
    } catch (error) {
      request.log.debug({ err: error }, 'Session storage unavailable');
    }
  });
}

async function createSession(reply: FastifyReply): Promise<SessionRow> {
  const id = randomBytes(32).toString('hex');
  const csrf = randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + config.SESSION_TTL_HOURS * 3_600_000);
  await pool.query('INSERT INTO sessions(id,csrf_token,expires_at) VALUES($1,$2,$3)', [id, csrf, expires]);
  reply.setCookie(cookieName, id, {
    path: '/', httpOnly: true, sameSite: 'lax', secure: config.NODE_ENV === 'production', signed: true,
    maxAge: config.SESSION_TTL_HOURS * 3600,
  });
  return { id, csrf_token: csrf, data: {}, user_id: null, email: null, role: null, email_verified_at: null };
}

export async function rotateSession(request: FastifyRequest, reply: FastifyReply, userId: string): Promise<void> {
  if (request.sessionId) await pool.query('DELETE FROM sessions WHERE id=$1', [request.sessionId]);
  const created = await createSession(reply);
  await pool.query('UPDATE sessions SET user_id=$1 WHERE id=$2', [userId, created.id]);
}

export async function destroySession(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (request.sessionId) await pool.query('DELETE FROM sessions WHERE id=$1', [request.sessionId]);
  reply.clearCookie(cookieName, { path: '/' });
}

export async function saveSessionData(request: FastifyRequest, data: Record<string, unknown>): Promise<void> {
  if (!request.sessionId) throw Object.assign(new Error('Session storage is unavailable.'), { statusCode: 503 });
  await pool.query('UPDATE sessions SET data=$1::jsonb,updated_at=now() WHERE id=$2', [JSON.stringify(data), request.sessionId]);
  request.sessionData = data;
}

export function assertCsrf(request: FastifyRequest, token: unknown): void {
  if (!request.csrfToken || typeof token !== 'string' || token.length !== request.csrfToken.length || token !== request.csrfToken) {
    const error = new Error('Your form session expired. Reload the page and try again.');
    Object.assign(error, { statusCode: 403 });
    throw error;
  }
}

export function requireUser(request: FastifyRequest): CurrentUser {
  if (!request.currentUser) {
    const error = new Error('Sign in required.');
    Object.assign(error, { statusCode: 401 });
    throw error;
  }
  return request.currentUser;
}

export function requireRole(request: FastifyRequest, roles: CurrentUser['role'][]): CurrentUser {
  const user = requireUser(request);
  if (!roles.includes(user.role)) {
    const error = new Error('You do not have permission to perform this action.');
    Object.assign(error, { statusCode: 403 });
    throw error;
  }
  return user;
}
