import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../src/config.js';
import { pool } from '../src/db/pool.js';

const paths = ['/', '/directory', '/marketplace', '/exchange', '/about', '/pricing', '/economics', '/terms', '/privacy'];
const dynamic = await pool.query<{ path: string }>(`SELECT '/directory/'||slug path FROM organizations WHERE status='approved' UNION ALL SELECT '/product/'||slug path FROM products WHERE status='active' AND purchase_mode=ANY($1::text[]) AND (purchase_mode<>'external' OR external_purchase_url~*'^https://') ORDER BY path`, [config.PUBLIC_PRODUCT_MODES]);
paths.push(...dynamic.rows.map((row) => row.path));
const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${paths.map((item) => `  <url><loc>${config.APP_URL}${item}</loc></url>`).join('\n')}\n</urlset>\n`;
const target = path.resolve(config.SITEMAP_PATH);
await mkdir(path.dirname(target), { recursive: true });
await writeFile(target, xml, 'utf8');
await pool.query(`UPDATE supplier_publication_batches SET sitemap_status='current',sitemap_current_at=now(),sitemap_error=NULL WHERE status='approved' AND sitemap_status IN ('pending','failed')`);
console.log(JSON.stringify({ target, urls: paths.length }));
await pool.end();
