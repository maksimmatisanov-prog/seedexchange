import bcrypt from 'bcrypt';
import { z } from 'zod';
import { pool } from '../src/db/pool.js';

const email = z.string().email().max(190).parse(process.argv[2]);
const password = z.string().min(14).max(200).parse(process.env.SEEDX_ADMIN_PASSWORD);
const hash = await bcrypt.hash(password, 12);
const result = await pool.query<{ id: string }>(`INSERT INTO users(email,email_verified_at,password_hash,role)
  VALUES($1,now(),$2,'platform_admin') ON CONFLICT(email) DO UPDATE SET role='platform_admin' RETURNING id`, [email.toLowerCase(), hash]);
console.log(JSON.stringify({ createdOrUpdated: true, userId: result.rows[0].id, email: email.toLowerCase() }));
await pool.end();
