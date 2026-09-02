import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { pageModel } from '../lib/view.js';
import { audit } from '../services/audit.js';
import { assertCsrf, requireUser } from '../services/sessions.js';

async function accessibleConversation(conversationId: string, userId: string) {
  const result = await pool.query(`SELECT c.*,o.name organization_name,
    CASE WHEN c.buyer_user_id=$2 THEN 'buyer' ELSE 'organization' END participant_role
    FROM conversations c JOIN organizations o ON o.id=c.organization_id
    WHERE c.id=$1 AND (c.buyer_user_id=$2 OR EXISTS(SELECT 1 FROM organization_members m WHERE m.organization_id=c.organization_id AND m.user_id=$2))`, [conversationId, userId]);
  if (!result.rows[0]) throw Object.assign(new Error('Conversation not found.'), { statusCode: 404 });
  return result.rows[0];
}

export async function registerMessageRoutes(app: FastifyInstance) {
  app.get('/messages', async (request, reply) => {
    const user = requireUser(request);
    const conversations = await pool.query(`SELECT c.*,o.name organization_name,u.email buyer_email
      FROM conversations c JOIN organizations o ON o.id=c.organization_id JOIN users u ON u.id=c.buyer_user_id
      WHERE c.buyer_user_id=$1 OR EXISTS(SELECT 1 FROM organization_members m WHERE m.organization_id=c.organization_id AND m.user_id=$1)
      ORDER BY c.last_message_at DESC NULLS LAST,c.created_at DESC`, [user.id]);
    return reply.view('pages/messages/index.ejs', pageModel(request, { title: 'Messages', description: 'Buyer and organization conversations.', canonical: null, conversations: conversations.rows }));
  });

  app.post('/messages/start', async (request, reply) => {
    const user = requireUser(request);
    if (!user.emailVerifiedAt) throw Object.assign(new Error('Verify your email before starting a conversation.'), { statusCode: 403 });
    const form = z.object({ csrf: z.string(), organization_id: z.coerce.string().regex(/^\d+$/), body: z.string().trim().min(2).max(5000) }).parse(request.body);
    assertCsrf(request, form.csrf);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const conversation = await client.query<{ id: string }>(`INSERT INTO conversations(organization_id,buyer_user_id,last_message_at) VALUES($1,$2,now())
        ON CONFLICT(buyer_user_id,organization_id) DO UPDATE SET updated_at=now() RETURNING id`, [form.organization_id, user.id]);
      await client.query('INSERT INTO conversation_messages(conversation_id,sender_user_id,body) VALUES($1,$2,$3)', [conversation.rows[0].id, user.id, form.body]);
      await client.query('COMMIT');
      await audit(user.id, 'conversation', conversation.rows[0].id, 'message.sent');
      return reply.redirect(`/messages/${conversation.rows[0].id}`, 303);
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  });

  app.get<{ Params: { id: string } }>('/messages/:id', async (request, reply) => {
    const user = requireUser(request);
    const conversation = await accessibleConversation(request.params.id, user.id);
    const messages = await pool.query(`SELECT m.*,u.email sender_email FROM conversation_messages m JOIN users u ON u.id=m.sender_user_id WHERE m.conversation_id=$1 ORDER BY m.created_at,m.id`, [conversation.id]);
    await pool.query('UPDATE conversation_messages SET read_at=COALESCE(read_at,now()) WHERE conversation_id=$1 AND sender_user_id<>$2', [conversation.id, user.id]);
    return reply.view('pages/messages/thread.ejs', pageModel(request, { title: conversation.organization_name, description: 'Private Seedexchange conversation.', canonical: null, conversation, messages: messages.rows }));
  });

  app.post<{ Params: { id: string } }>('/messages/:id', async (request, reply) => {
    const user = requireUser(request);
    const form = z.object({ csrf: z.string(), body: z.string().trim().min(2).max(5000) }).parse(request.body);
    assertCsrf(request, form.csrf);
    const conversation = await accessibleConversation(request.params.id, user.id);
    const blocked = conversation.participant_role === 'buyer' ? conversation.buyer_blocked_at : conversation.organization_blocked_at;
    if (blocked) throw Object.assign(new Error('This conversation is blocked.'), { statusCode: 403 });
    await pool.query('INSERT INTO conversation_messages(conversation_id,sender_user_id,body) VALUES($1,$2,$3)', [conversation.id, user.id, form.body]);
    await pool.query('UPDATE conversations SET last_message_at=now(),updated_at=now() WHERE id=$1', [conversation.id]);
    await audit(user.id, 'conversation', conversation.id, 'message.sent');
    return reply.redirect(`/messages/${conversation.id}`, 303);
  });
}
