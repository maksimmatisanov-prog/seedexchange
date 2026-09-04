import { config } from '../src/config.js';
import { pool } from '../src/db/pool.js';
import { createConfiguredMailTransport } from '../src/services/mail-transport.js';

type OutboxMessage = { id: string; recipient: string; subject: string; body: string; attempts: number };

const transport = createConfiguredMailTransport();
let sent = 0; let failed = 0;
for (let index = 0; index < 25; index++) {
  const client = await pool.connect();
  let message: OutboxMessage | undefined;
  try {
    await client.query('BEGIN');
    const claim = await client.query<OutboxMessage>(`SELECT id,recipient,subject,body,attempts FROM outbox_messages
      WHERE (status='pending' OR (status='failed' AND attempts<5 AND next_attempt_at<=now()) OR (status='processing' AND locked_at<now()-interval '15 minutes'))
      ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1`);
    message = claim.rows[0];
    if (!message) { await client.query('ROLLBACK'); break; }
    await client.query(`UPDATE outbox_messages SET status='processing',locked_at=now(),attempts=attempts+1 WHERE id=$1`, [message.id]);
    await client.query('COMMIT');
  } finally { client.release(); }
  try {
    await transport.sendMail({ from: { name: config.MAIL_FROM_NAME, address: config.MAIL_FROM }, replyTo: config.MAIL_REPLY_TO || undefined, to: message.recipient, subject: message.subject, text: message.body });
    await pool.query(`UPDATE outbox_messages SET status='sent',sent_at=now(),locked_at=NULL,last_error=NULL WHERE id=$1`, [message.id]); sent++;
  } catch (error) {
    const delay = ['5 minutes','30 minutes','2 hours','12 hours'][Math.min(message.attempts,3)];
    await pool.query(`UPDATE outbox_messages SET status='failed',locked_at=NULL,last_error=$2,next_attempt_at=now()+$3::interval WHERE id=$1`, [message.id, String(error).slice(0,500), delay]); failed++;
  }
}
console.log(JSON.stringify({ sent, failed })); transport.close(); await pool.end();
