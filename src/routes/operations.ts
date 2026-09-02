import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { pageModel } from '../lib/view.js';
import { audit } from '../services/audit.js';
import { assertCsrf, requireRole, requireUser } from '../services/sessions.js';

const slugify = (value: string) => value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 180);
async function requireOrganization(userId: string, organizationId: string) {
  const result = await pool.query(`SELECT o.*,m.role member_role FROM organizations o JOIN organization_members m ON m.organization_id=o.id WHERE o.id=$1 AND m.user_id=$2`, [organizationId, userId]);
  if (!result.rows[0]) throw Object.assign(new Error('Organization access denied.'), { statusCode: 403 });
  return result.rows[0];
}

export async function registerOperationRoutes(app: FastifyInstance) {
  app.post('/organization/submit', async (request, reply) => {
    const user = requireUser(request);
    if (!user.emailVerifiedAt) throw Object.assign(new Error('Verify your email before submitting an organization.'), { statusCode: 403 });
    const form = z.object({ csrf: z.string(), type: z.enum(['seed_bank','botanic_garden','nursery','shop','grower','collector']), name: z.string().trim().min(2).max(190), country: z.string().trim().min(2).max(100), description: z.string().trim().min(30).max(5000), website_url: z.union([z.literal(''),z.string().url()]).default('') }).parse(request.body);
    assertCsrf(request, form.csrf);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const base = slugify(form.name) || `organization-${Date.now()}`;
      let slug = base; let suffix = 1;
      while ((await client.query('SELECT 1 FROM organizations WHERE slug=$1', [slug])).rowCount) slug = `${base}-${++suffix}`;
      const created = await client.query<{ id: string }>(`INSERT INTO organizations(type,name,slug,country,description,website_url) VALUES($1,$2,$3,$4,$5,$6) RETURNING id`, [form.type, form.name, slug, form.country, form.description, form.website_url || null]);
      await client.query(`INSERT INTO organization_members(organization_id,user_id,role) VALUES($1,$2,'admin')`, [created.rows[0].id, user.id]);
      await client.query(`UPDATE users SET role=CASE WHEN role='buyer' THEN 'org_admin' ELSE role END WHERE id=$1`, [user.id]);
      await client.query('COMMIT');
      await audit(user.id, 'organization', created.rows[0].id, 'organization.submitted');
      return reply.redirect('/account', 303);
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  });

  app.get<{ Params: { id: string } }>('/seller/organization/:id', async (request, reply) => {
    const user = requireUser(request); const organization = await requireOrganization(user.id, request.params.id);
    const [products,zones,exchanges,orders] = await Promise.all([
      pool.query('SELECT * FROM products WHERE organization_id=$1 ORDER BY updated_at DESC', [organization.id]),
      pool.query('SELECT * FROM seller_shipping_zones WHERE organization_id=$1 ORDER BY id DESC', [organization.id]),
      pool.query('SELECT * FROM exchange_listings WHERE organization_id=$1 ORDER BY id DESC', [organization.id]),
      pool.query('SELECT * FROM seller_orders WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 50', [organization.id]),
    ]);
    return reply.view('pages/account/seller.ejs', pageModel(request, { title: `${organization.name} workspace`, description: 'Seller and organization workspace.', canonical: null, organization, products: products.rows, zones: zones.rows, exchanges: exchanges.rows, orders: orders.rows }));
  });

  app.post('/seller/product', async (request, reply) => {
    const user = requireUser(request);
    const form = z.object({ csrf:z.string(), organization_id:z.coerce.string(), product_id:z.coerce.string().optional(), name:z.string().trim().min(2).max(255), sku:z.string().trim().min(1).max(100), botanical_name:z.string().trim().max(255).default(''), category:z.string().trim().max(100).default(''), description:z.string().trim().min(20).max(10000), price:z.coerce.number().min(.5).max(100000), stock_quantity:z.coerce.number().int().min(0).max(1_000_000), packet_quantity:z.string().trim().max(120).default('') }).parse(request.body);
    assertCsrf(request,form.csrf); await requireOrganization(user.id,form.organization_id);
    const slug = slugify(`${form.name}-${form.sku}`);
    if (form.product_id) {
      await pool.query(`UPDATE products SET name=$1,sku=$2,botanical_name=$3,category=$4,description=$5,price_cents=$6,stock_quantity=$7,packet_quantity=$8,slug=$9,status='pending_review',updated_at=now() WHERE id=$10 AND organization_id=$11`, [form.name,form.sku,form.botanical_name||null,form.category||null,form.description,Math.round(form.price*100),form.stock_quantity,form.packet_quantity||null,slug,form.product_id,form.organization_id]);
      await audit(user.id,'product',form.product_id,'product.submitted_for_review');
    } else {
      const created=await pool.query<{id:string}>(`INSERT INTO products(organization_id,sku,name,botanical_name,slug,category,description,price_cents,stock_quantity,packet_quantity,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending_review') RETURNING id`, [form.organization_id,form.sku,form.name,form.botanical_name||null,slug,form.category||null,form.description,Math.round(form.price*100),form.stock_quantity,form.packet_quantity||null]);
      await audit(user.id,'product',created.rows[0].id,'product.submitted_for_review');
    }
    return reply.redirect(`/seller/organization/${form.organization_id}`,303);
  });

  app.post('/seller/shipping', async (request, reply) => {
    const user=requireUser(request); const form=z.object({csrf:z.string(),organization_id:z.coerce.string(),name:z.string().trim().min(2).max(120),countries:z.string().trim().min(1).max(500),rate:z.coerce.number().min(0).max(10000)}).parse(request.body);
    assertCsrf(request,form.csrf); await requireOrganization(user.id,form.organization_id);
    await pool.query(`INSERT INTO seller_shipping_zones(organization_id,name,countries,rate_cents) VALUES($1,$2,$3,$4)`,[form.organization_id,form.name,form.countries.toUpperCase(),Math.round(form.rate*100)]);
    return reply.redirect(`/seller/organization/${form.organization_id}`,303);
  });

  app.post('/seller/exchange', async (request, reply) => {
    const user=requireUser(request); const form=z.object({csrf:z.string(),organization_id:z.coerce.string(),mode:z.enum(['exchange','donate']),title:z.string().trim().min(2).max(255),species:z.string().trim().max(255).default(''),quantity_available:z.string().trim().max(120).default(''),description:z.string().trim().min(20).max(5000)}).parse(request.body);
    assertCsrf(request,form.csrf); await requireOrganization(user.id,form.organization_id);
    const created=await pool.query<{id:string}>(`INSERT INTO exchange_listings(organization_id,mode,title,species,quantity_available,description) VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,[form.organization_id,form.mode,form.title,form.species||null,form.quantity_available||null,form.description]);
    await audit(user.id,'exchange',created.rows[0].id,'exchange.published');
    return reply.redirect(`/seller/organization/${form.organization_id}`,303);
  });

  app.get('/admin', async (request, reply) => {
    requireRole(request,['platform_admin']);
    const [organizations,products,cases,reports,batches]=await Promise.all([
      pool.query(`SELECT * FROM organizations WHERE status IN ('pending','info_requested') ORDER BY created_at`),
      pool.query(`SELECT p.*,o.name organization_name FROM products p JOIN organizations o ON o.id=p.organization_id WHERE p.status='pending_review' AND p.publication_batch_id IS NULL ORDER BY p.updated_at`),
      pool.query(`SELECT * FROM delivery_cases WHERE status IN ('open','reviewing') ORDER BY created_at`),
      pool.query(`SELECT * FROM reports WHERE status IN ('open','reviewing') ORDER BY created_at`),
      pool.query(`SELECT b.*,o.name organization_name FROM supplier_publication_batches b JOIN organizations o ON o.id=b.organization_id WHERE b.status='pending_review' ORDER BY b.created_at`),
    ]);
    return reply.view('pages/admin/index.ejs',pageModel(request,{title:'Platform administration',description:'Moderation and operations.',canonical:null,organizations:organizations.rows,products:products.rows,cases:cases.rows,reports:reports.rows,batches:batches.rows}));
  });

  app.post<{Params:{id:string;action:string}}>('/admin/organization/:id/:action',async(request,reply)=>{
    const user=requireRole(request,['platform_admin']); const body=z.object({csrf:z.string()}).parse(request.body); assertCsrf(request,body.csrf);
    const action=z.enum(['approve','reject','info-request']).parse(request.params.action); const status=action==='info-request'?'info_requested':action==='approve'?'approved':'rejected';
    const client=await pool.connect(); try{await client.query('BEGIN'); const updated=await client.query(`UPDATE organizations SET status=$1,verified_at=CASE WHEN $1='approved' THEN COALESCE(verified_at,now()) ELSE verified_at END WHERE id=$2 RETURNING id`,[status,request.params.id]);
      if(!updated.rowCount)throw Object.assign(new Error('Organization not found.'),{statusCode:404});
      if(status==='approved'){
        const state=await client.query<{current_slot:number}>('SELECT current_slot FROM founder_program_state WHERE id=1 FOR UPDATE');
        if(state.rows[0].current_slot<50){const slot=state.rows[0].current_slot+1;await client.query(`INSERT INTO founder_program_members(organization_id,slot_number) VALUES($1,$2) ON CONFLICT(organization_id) DO NOTHING`,[request.params.id,slot]);await client.query('UPDATE founder_program_state SET current_slot=GREATEST(current_slot,$1),updated_at=now() WHERE id=1',[slot]);}
      }
      await client.query('COMMIT'); await audit(user.id,'organization',request.params.id,`organization.${status}`); return reply.redirect('/admin',303);
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  });

  app.post<{Params:{id:string;action:string}}>('/admin/product/:id/:action',async(request,reply)=>{
    const user=requireRole(request,['platform_admin']); const body=z.object({csrf:z.string()}).parse(request.body); assertCsrf(request,body.csrf);
    const action=z.enum(['approve','reject']).parse(request.params.action); await pool.query('UPDATE products SET status=$1,updated_at=now() WHERE id=$2 AND status=$3',[action==='approve'?'active':'rejected',request.params.id,'pending_review']);
    await audit(user.id,'product',request.params.id,`product.${action}d`); return reply.redirect('/admin',303);
  });
}
