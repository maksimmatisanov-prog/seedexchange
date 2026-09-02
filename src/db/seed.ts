import { pool } from './pool.js';

const result = await pool.query(`SELECT
  (SELECT count(*) FROM users) users,
  (SELECT count(*) FROM organizations) organizations,
  (SELECT count(*) FROM products) products`);
console.log(JSON.stringify({ policy: 'production-empty-real-data-only', counts: result.rows[0] }));
await pool.end();
