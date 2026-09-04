import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config } from '../config.js';
import { pool } from '../db/pool.js';
import { ORGANIZATION_CHANNELS, ORGANIZATION_CHANNEL_LABELS, normalizeOrganizationChannel, normalizePublicHttpUrl } from '../domain/organization.js';
import { canManageOrganization, canTransitionSellerOrder } from '../domain/rules.js';
import { pageModel } from '../lib/view.js';
import { audit } from '../services/audit.js';
import { processOrganizationImage, removeUncommittedImage } from '../services/media.js';
import { moderateSupplierBatch } from '../services/supplier-batches.js';
import { assertCsrf, requireRole, requireUser } from '../services/sessions.js';
import type { CurrentUser } from '../types/fastify.js';

const slugify = (value: string) => value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 180);
function requireCommerceLaunch(): void {
  if (!config.COMMERCE_ENABLED) throw Object.assign(new Error('This commerce operation is unavailable during the discovery launch.'), { statusCode: 404 });
}
async function requireOrganization(user: CurrentUser, organizationId: string) {
  const result = await pool.query(`SELECT o.*,m.role member_role,
    (SELECT storage_key FROM media_assets WHERE organization_id=o.id AND kind='organization_logo' AND is_active=true AND storage_key~'^[a-f0-9]{40}\\.webp$' ORDER BY (origin='uploaded') DESC,id DESC LIMIT 1) logo_key,
    (SELECT storage_key FROM media_assets WHERE organization_id=o.id AND kind='organization_cover' AND is_active=true AND storage_key~'^[a-f0-9]{40}\\.webp$' ORDER BY (origin='uploaded') DESC,id DESC LIMIT 1) cover_key
    FROM organizations o
    LEFT JOIN organization_members m ON m.organization_id=o.id AND m.user_id=$2
    WHERE o.id=$1`, [organizationId, user.id]);
  const organization = result.rows[0];
  if (!organization || !canManageOrganization({ platformRole: user.role, memberRole: organization.member_role })) {
    throw Object.assign(new Error('Organization access denied.'), { statusCode: 403 });
  }
  return organization;
}

async function readOrganizationMediaForm(request: Parameters<typeof assertCsrf>[0]) {
  if (!request.isMultipart()) throw Object.assign(new Error('Use a multipart image upload form.'), { statusCode: 400 });
  const fields: Record<string, string> = {};
  let image: Buffer | null = null;
  for await (const part of request.parts()) {
    if (part.type === 'file') {
      if (image) throw Object.assign(new Error('Upload one image at a time.'), { statusCode: 400 });
      image = await part.toBuffer();
    } else {
      fields[part.fieldname] = String(part.value ?? '');
    }
  }
  return { fields, image };
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
    const user = requireUser(request); const organization = await requireOrganization(user, request.params.id);
    const [products,zones,exchanges,orders,channels] = await Promise.all([
      config.COMMERCE_ENABLED ? pool.query('SELECT * FROM products WHERE organization_id=$1 AND purchase_mode=$2 ORDER BY updated_at DESC', [organization.id, 'marketplace']) : Promise.resolve({ rows: [] }),
      config.COMMERCE_ENABLED ? pool.query('SELECT * FROM seller_shipping_zones WHERE organization_id=$1 ORDER BY id DESC', [organization.id]) : Promise.resolve({ rows: [] }),
      pool.query('SELECT * FROM exchange_listings WHERE organization_id=$1 ORDER BY id DESC', [organization.id]),
      config.COMMERCE_ENABLED ? pool.query('SELECT * FROM seller_orders WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 50', [organization.id]) : Promise.resolve({ rows: [] }),
      pool.query<{channel_type:string;url:string}>('SELECT channel_type,url FROM organization_channels WHERE organization_id=$1 ORDER BY channel_type', [organization.id]),
    ]);
    const channelValues = Object.fromEntries(channels.rows.map((channel) => [channel.channel_type, channel.channel_type === 'email' ? channel.url.replace(/^mailto:/i, '') : channel.url]));
    return reply.view('pages/account/seller.ejs', pageModel(request, { title: `${organization.name} workspace`, description: 'Organization workspace.', canonical: null, organization, products: products.rows, zones: zones.rows, exchanges: exchanges.rows, orders: orders.rows, channels: channelValues, organizationChannelLabels: ORGANIZATION_CHANNEL_LABELS, commerceEnabled: config.COMMERCE_ENABLED }));
  });

  app.post<{ Params: { id: string } }>('/seller/organization/:id/profile', async (request, reply) => {
    const user=requireUser(request);
    const form=z.object({csrf:z.string(),name:z.string().trim().min(2).max(190),country:z.string().trim().min(2).max(100),country_code:z.string().trim().regex(/^$|^[A-Za-z]{2}$/),region:z.string().trim().max(190).default(''),description:z.string().trim().min(30).max(5000),specialties:z.string().trim().max(5000).default(''),contact_url:z.string().trim().max(500).default(''),website_url:z.string().trim().max(500).default('')}).parse(request.body);
    assertCsrf(request,form.csrf); await requireOrganization(user,request.params.id);
    const contactUrl=normalizePublicHttpUrl(form.contact_url); const websiteUrl=normalizePublicHttpUrl(form.website_url);
    const updated=await pool.query(`UPDATE organizations SET name=$1,country=$2,country_code=$3,region=$4,description=$5,specialties=$6,
      contact_url=$7,website_url=$8,profile_updated_at=now() WHERE id=$9 RETURNING id`,
    [form.name,form.country,form.country_code.toUpperCase()||null,form.region||null,form.description,form.specialties||null,contactUrl,websiteUrl,request.params.id]);
    if(!updated.rows[0])throw Object.assign(new Error('Organization not found.'),{statusCode:404});
    await audit(user.id,'organization',request.params.id,'organization.profile_updated');
    return reply.redirect(`/seller/organization/${request.params.id}#profile`,303);
  });

  app.post<{ Params: { id: string } }>('/seller/organization/:id/channels', async (request, reply) => {
    const user=requireUser(request); const body=z.record(z.string(),z.unknown()).parse(request.body); assertCsrf(request,String(body.csrf??'')); await requireOrganization(user,request.params.id);
    const client=await pool.connect();
    try{await client.query('BEGIN');
      for(const type of ORGANIZATION_CHANNELS){
        const url=normalizeOrganizationChannel(type,String(body[`channel_${type}`]??''));
        if(!url){await client.query('DELETE FROM organization_channels WHERE organization_id=$1 AND channel_type=$2',[request.params.id,type]);continue;}
        await client.query(`INSERT INTO organization_channels(organization_id,channel_type,label,url) VALUES($1,$2,$3,$4)
          ON CONFLICT(organization_id,channel_type) DO UPDATE SET label=EXCLUDED.label,
          is_verified=CASE WHEN organization_channels.url=EXCLUDED.url THEN organization_channels.is_verified ELSE false END,
          url=EXCLUDED.url,updated_at=now()`,[request.params.id,type,ORGANIZATION_CHANNEL_LABELS[type],url]);
      }
      await client.query('COMMIT');
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
    await audit(user.id,'organization',request.params.id,'organization.channels_updated');
    return reply.redirect(`/seller/organization/${request.params.id}#channels`,303);
  });

  app.post<{ Params: { id: string } }>('/seller/organization/:id/media', async (request, reply) => {
    const user=requireUser(request); await requireOrganization(user,request.params.id);
    const upload=await readOrganizationMediaForm(request);
    const form=z.object({csrf:z.string(),kind:z.enum(['organization_logo','organization_cover'])}).parse(upload.fields);
    assertCsrf(request,form.csrf);
    if(!upload.image)throw Object.assign(new Error('Choose an image to upload.'),{statusCode:400});
    const image=await processOrganizationImage(upload.image,form.kind);
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${request.params.id}:${form.kind}`]);
      await client.query('UPDATE media_assets SET is_active=false WHERE organization_id=$1 AND kind=$2 AND is_active=true',[request.params.id,form.kind]);
      const created=await client.query<{id:string}>(`INSERT INTO media_assets(organization_id,uploaded_by_user_id,kind,origin,storage_key,mime_type,byte_size,width_px,height_px,sha256)
        VALUES($1,$2,$3,'uploaded',$4,$5,$6,$7,$8,$9) RETURNING id`,[request.params.id,user.id,form.kind,image.storageKey,image.mimeType,image.byteSize,image.widthPx,image.heightPx,image.sha256]);
      await client.query(`INSERT INTO audit_events(actor_user_id,entity_type,entity_id,event_name,payload) VALUES($1,'media_asset',$2,'organization.media_uploaded',$3::jsonb)`,[user.id,created.rows[0].id,JSON.stringify({kind:form.kind,sha256:image.sha256})]);
      await client.query('COMMIT');
    }catch(error){await client.query('ROLLBACK');await removeUncommittedImage(image);throw error;}finally{client.release();}
    return reply.redirect(`/seller/organization/${request.params.id}#media`,303);
  });

  app.post<{ Params: { id: string; kind: string } }>('/seller/organization/:id/media/:kind/remove', async (request, reply) => {
    const user=requireUser(request); const body=z.object({csrf:z.string()}).parse(request.body); assertCsrf(request,body.csrf); await requireOrganization(user,request.params.id);
    const kind=z.enum(['organization_logo','organization_cover']).parse(request.params.kind);
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${request.params.id}:${kind}`]);
      const removed=await client.query<{id:string}>(`UPDATE media_assets SET is_active=false WHERE id=(SELECT id FROM media_assets WHERE organization_id=$1 AND kind=$2 AND is_active=true ORDER BY (origin='uploaded') DESC,id DESC LIMIT 1) RETURNING id`,[request.params.id,kind]);
      if(!removed.rows[0])throw Object.assign(new Error('Active image not found.'),{statusCode:404});
      await client.query(`INSERT INTO audit_events(actor_user_id,entity_type,entity_id,event_name,payload) VALUES($1,'media_asset',$2,'organization.media_removed',$3::jsonb)`,[user.id,removed.rows[0].id,JSON.stringify({kind})]);
      await client.query('COMMIT');
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
    return reply.redirect(`/seller/organization/${request.params.id}#media`,303);
  });

  app.post('/seller/product', async (request, reply) => {
    requireCommerceLaunch();
    const user = requireUser(request);
    const form = z.object({ csrf:z.string(), organization_id:z.coerce.string(), product_id:z.coerce.string().optional(), name:z.string().trim().min(2).max(255), sku:z.string().trim().min(1).max(100), botanical_name:z.string().trim().max(255).default(''), category:z.string().trim().max(100).default(''), description:z.string().trim().min(20).max(10000), price:z.coerce.number().min(.5).max(100000), stock_quantity:z.coerce.number().int().min(0).max(1_000_000), packet_quantity:z.string().trim().max(120).default('') }).parse(request.body);
    assertCsrf(request,form.csrf); await requireOrganization(user,form.organization_id);
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
    requireCommerceLaunch();
    const user=requireUser(request); const form=z.object({csrf:z.string(),organization_id:z.coerce.string(),name:z.string().trim().min(2).max(120),countries:z.string().trim().min(1).max(500),rate:z.coerce.number().min(0).max(10000)}).parse(request.body);
    assertCsrf(request,form.csrf); await requireOrganization(user,form.organization_id);
    const created=await pool.query<{id:string}>(`INSERT INTO seller_shipping_zones(organization_id,name,countries,rate_cents) VALUES($1,$2,$3,$4) RETURNING id`,[form.organization_id,form.name,form.countries.toUpperCase(),Math.round(form.rate*100)]);
    await audit(user.id,'shipping_zone',created.rows[0].id,'shipping_zone.created');
    return reply.redirect(`/seller/organization/${form.organization_id}`,303);
  });

  app.post('/seller/exchange', async (request, reply) => {
    const user=requireUser(request); const form=z.object({csrf:z.string(),organization_id:z.coerce.string(),mode:z.enum(['exchange','donate']),title:z.string().trim().min(2).max(255),species:z.string().trim().min(2).max(255),variety:z.string().trim().max(255).default(''),category:z.string().trim().max(100).default(''),origin_country:z.string().trim().max(100).default(''),quantity_available:z.string().trim().min(1).max(120),wants:z.string().trim().max(2000).default(''),contact_url:z.string().trim().max(500).default(''),description:z.string().trim().min(20).max(5000)}).parse(request.body);
    assertCsrf(request,form.csrf); const organization=await requireOrganization(user,form.organization_id);
    if(organization.status!=='approved')throw Object.assign(new Error('Your organization must be approved before publishing an exchange.'),{statusCode:409});
    const contactUrl=normalizePublicHttpUrl(form.contact_url||String(organization.contact_url??''),true);
    const created=await pool.query<{id:string}>(`INSERT INTO exchange_listings(organization_id,mode,title,species,variety,category,origin_country,quantity_available,wants,contact_url,description)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,[form.organization_id,form.mode,form.title,form.species,form.variety||null,form.category||null,form.origin_country||null,form.quantity_available,form.wants||null,contactUrl,form.description]);
    await audit(user.id,'exchange',created.rows[0].id,'exchange.published');
    return reply.redirect(`/seller/organization/${form.organization_id}`,303);
  });

  app.post<{Params:{id:string;action:string}}>('/seller/exchange/:id/:action',async(request,reply)=>{
    const user=requireUser(request); const body=z.object({csrf:z.string()}).parse(request.body); assertCsrf(request,body.csrf); const action=z.enum(['complete','withdraw']).parse(request.params.action);
    const listing=await pool.query<{organization_id:string;status:string}>('SELECT organization_id,status FROM exchange_listings WHERE id=$1',[request.params.id]);
    if(!listing.rows[0])throw Object.assign(new Error('Exchange listing not found.'),{statusCode:404});
    await requireOrganization(user,listing.rows[0].organization_id);
    if(listing.rows[0].status!=='active')throw Object.assign(new Error('Exchange listing is no longer active.'),{statusCode:409});
    const status=action==='complete'?'completed':'withdrawn';
    const updated=await pool.query(`UPDATE exchange_listings SET status=$1,completed_at=CASE WHEN $1='completed' THEN now() ELSE completed_at END
      WHERE id=$2 AND status='active' RETURNING id`,[status,request.params.id]);
    if(!updated.rows[0])throw Object.assign(new Error('Exchange listing changed while it was being updated.'),{statusCode:409});
    await audit(user.id,'exchange',request.params.id,action==='complete'?'exchange.completed':'exchange.withdrawn');
    return reply.redirect(`/seller/organization/${listing.rows[0].organization_id}#exchange`,303);
  });

  app.post<{Params:{id:string}}>('/seller/order/:id/processing',async(request,reply)=>{
    requireCommerceLaunch();
    const user=requireUser(request); const body=z.object({csrf:z.string()}).parse(request.body); assertCsrf(request,body.csrf);
    const sellerOrder=await pool.query<{organization_id:string;status:string}>('SELECT organization_id,status FROM seller_orders WHERE id=$1',[request.params.id]);
    if(!sellerOrder.rows[0])throw Object.assign(new Error('Seller order not found.'),{statusCode:404});
    await requireOrganization(user,sellerOrder.rows[0].organization_id);
    if(sellerOrder.rows[0].status!=='paid' || !canTransitionSellerOrder(sellerOrder.rows[0].status,'processing'))throw Object.assign(new Error('Seller order cannot enter processing from its current status.'),{statusCode:409});
    const updated=await pool.query('UPDATE seller_orders SET status=$1,updated_at=now() WHERE id=$2 AND status=$3 RETURNING id',['processing',request.params.id,sellerOrder.rows[0].status]);
    if(!updated.rowCount)throw Object.assign(new Error('Seller order changed while it was being updated.'),{statusCode:409});
    await audit(user.id,'seller_order',request.params.id,'seller_order.processing');
    return reply.redirect(`/seller/organization/${sellerOrder.rows[0].organization_id}`,303);
  });

  app.post<{Params:{id:string}}>('/seller/order/:id/ship',async(request,reply)=>{
    requireCommerceLaunch();
    const user=requireUser(request); const form=z.object({csrf:z.string(),carrier:z.string().trim().min(2).max(120),tracking_number:z.string().trim().min(2).max(190),tracking_url:z.union([z.literal(''),z.string().url().max(500)]).default('')}).parse(request.body); assertCsrf(request,form.csrf);
    const sellerOrder=await pool.query<{organization_id:string;status:string;order_id:string}>('SELECT organization_id,status,order_id FROM seller_orders WHERE id=$1',[request.params.id]);
    if(!sellerOrder.rows[0])throw Object.assign(new Error('Seller order not found.'),{statusCode:404});
    await requireOrganization(user,sellerOrder.rows[0].organization_id);
    if(!['paid','processing'].includes(sellerOrder.rows[0].status) || !canTransitionSellerOrder(sellerOrder.rows[0].status,'shipped'))throw Object.assign(new Error('Seller order cannot be shipped from its current status.'),{statusCode:409});
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      const updated=await client.query(`UPDATE seller_orders SET status='shipped',carrier=$1,tracking_number=$2,tracking_url=$3,shipped_at=now(),delivery_due_at=now()+interval '30 days',updated_at=now() WHERE id=$4 AND status=$5 RETURNING id`,[form.carrier,form.tracking_number,form.tracking_url||null,request.params.id,sellerOrder.rows[0].status]);
      if(!updated.rowCount)throw Object.assign(new Error('Seller order changed while it was being updated.'),{statusCode:409});
      await client.query(`UPDATE orders SET status='partially_fulfilled',updated_at=now() WHERE id=$1 AND status='paid'`,[sellerOrder.rows[0].order_id]);
      await client.query(`INSERT INTO notifications(user_id,type,title,body,action_url)
        SELECT user_id,'seller_order_shipped','Your order has shipped',$2,$3 FROM orders WHERE id=$1 AND user_id IS NOT NULL`,[sellerOrder.rows[0].order_id,`${form.carrier}: ${form.tracking_number}`,`/account/orders/${sellerOrder.rows[0].order_id}`]);
      await client.query('COMMIT');
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
    await audit(user.id,'seller_order',request.params.id,'seller_order.shipped',{carrier:form.carrier,trackingNumber:form.tracking_number});
    return reply.redirect(`/seller/organization/${sellerOrder.rows[0].organization_id}`,303);
  });

  app.get('/admin', async (request, reply) => {
    requireRole(request,['platform_admin']);
    const [organizations,products,cases,reports,batches]=await Promise.all([
      pool.query(`SELECT * FROM organizations WHERE status IN ('pending','info_requested') ORDER BY created_at`),
      config.COMMERCE_ENABLED ? pool.query(`SELECT p.*,o.name organization_name FROM products p JOIN organizations o ON o.id=p.organization_id WHERE p.status='pending_review' AND p.purchase_mode='marketplace' AND p.publication_batch_id IS NULL ORDER BY p.updated_at`) : Promise.resolve({rows:[]}),
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
    requireCommerceLaunch();
    const user=requireRole(request,['platform_admin']); const body=z.object({csrf:z.string()}).parse(request.body); assertCsrf(request,body.csrf);
    const action=z.enum(['approve','reject']).parse(request.params.action);
    const updated=await pool.query<{id:string}>('UPDATE products SET status=$1,updated_at=now() WHERE id=$2 AND status=$3 RETURNING id',[action==='approve'?'active':'rejected',request.params.id,'pending_review']);
    if (!updated.rows[0]) throw Object.assign(new Error('Pending product not found.'),{statusCode:404});
    await audit(user.id,'product',request.params.id,action==='approve'?'product.approved':'product.rejected'); return reply.redirect('/admin',303);
  });

  app.post<{Params:{id:string;action:string}}>('/admin/supplier-batch/:id/:action',async(request,reply)=>{
    const user=requireRole(request,['platform_admin']); const body=z.object({csrf:z.string()}).parse(request.body); assertCsrf(request,body.csrf);
    const action=z.enum(['approve','reject']).parse(request.params.action);
    await moderateSupplierBatch(request.params.id,action,user.id);
    return reply.redirect('/admin',303);
  });
}
