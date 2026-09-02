import { pool } from '../db/pool.js';

export async function audit(actorUserId: string | null, entityType: string, entityId: string | number, eventName: string, payload?: unknown) {
  await pool.query(`INSERT INTO audit_events(actor_user_id,entity_type,entity_id,event_name,payload)
    VALUES($1,$2,$3,$4,$5::jsonb)`, [actorUserId, entityType, entityId, eventName, JSON.stringify(payload ?? {})]);
}
