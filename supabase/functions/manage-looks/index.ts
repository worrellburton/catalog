import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import postgres from 'https://deno.land/x/postgresjs@v3.4.5/mod.js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, x-client-info',
  'Access-Control-Max-Age': '86400',
};

function jsonRes(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function errorRes(message: string, status = 400) {
  return jsonRes({ success: false, error: message }, status);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const dbUrl = Deno.env.get('SUPABASE_DB_URL') ?? '';

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return errorRes('Missing or invalid Authorization header', 401);
  }
  const token = authHeader.replace('Bearer ', '');

  const authClient = createClient(supabaseUrl, serviceRoleKey);
  const { data: { user }, error: userError } = await authClient.auth.getUser(token);
  if (userError || !user) {
    return errorRes('Unauthorized', 401);
  }

  const sql = postgres(dbUrl, { ssl: 'require', max: 1, idle_timeout: 10 });

  const url = new URL(req.url);
  const path = url.pathname.replace(/.*\/manage-looks/, '') || '/';
  const segments = path.split('/').filter(Boolean);
  const method = req.method;
  const userId = user.id;

  try {
    // GET / — list my looks
    if (method === 'GET' && segments.length === 0) {
      const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
      const limit = Math.min(50, parseInt(url.searchParams.get('limit') || '12'));
      const statusFilter = url.searchParams.get('status');
      const offset = (page - 1) * limit;

      const looks = statusFilter
        ? await sql`SELECT * FROM looks WHERE user_id = CAST(${userId} AS uuid) AND status = ${statusFilter} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`
        : await sql`SELECT * FROM looks WHERE user_id = CAST(${userId} AS uuid) ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`;

      const [{ count }] = statusFilter
        ? await sql`SELECT COUNT(*)::int AS count FROM looks WHERE user_id = CAST(${userId} AS uuid) AND status = ${statusFilter}`
        : await sql`SELECT COUNT(*)::int AS count FROM looks WHERE user_id = CAST(${userId} AS uuid)`;

      const lookIds = looks.map((l: { id: string }) => l.id);
      let photos: unknown[] = [], videos: unknown[] = [], lps: unknown[] = [];

      if (lookIds.length > 0) {
        [photos, videos, lps] = await Promise.all([
          sql`SELECT * FROM look_photos WHERE look_id = ANY(${lookIds}::uuid[]) ORDER BY order_index`,
          sql`SELECT * FROM look_videos WHERE look_id = ANY(${lookIds}::uuid[]) ORDER BY order_index`,
          sql`SELECT lp.sort_order, lp.look_id, p.id AS product_id, p.name, p.brand, p.price, p.url, p.image_url FROM look_products lp JOIN products p ON p.id = lp.product_id WHERE lp.look_id = ANY(${lookIds}::uuid[]) ORDER BY lp.sort_order`,
        ]);
      }

      const data = looks.map((look: { id: string }) => ({
        ...look,
        look_photos: (photos as Array<{ look_id: string }>).filter(p => p.look_id === look.id),
        look_videos: (videos as Array<{ look_id: string }>).filter(v => v.look_id === look.id),
        look_products: (lps as Array<{ look_id: string }>).filter(lp => lp.look_id === look.id),
      }));

      await sql.end();
      return jsonRes({ success: true, data, pagination: { page, limit, total: count, totalPages: Math.ceil(count / limit) } });
    }

    // POST / — create look
    if (method === 'POST' && segments.length === 0) {
      const body = await req.json();
      const row = {
        user_id: userId,
        title: body.title || 'Untitled',
        description: body.description ?? null,
        gender: body.gender ?? null,
        color: body.color ?? null,
        status: 'draft',
      };
      const [look] = await sql`INSERT INTO looks ${sql(row)} RETURNING *`;
      await sql.end();
      return jsonRes({ success: true, data: look }, 201);
    }

    const lookId = segments[0];

    // GET /:id — look detail
    if (method === 'GET' && segments.length === 1) {
      const [look] = await sql`SELECT * FROM looks WHERE id = CAST(${lookId} AS uuid) AND user_id = CAST(${userId} AS uuid)`;
      if (!look) { await sql.end(); return errorRes('Not found', 404); }

      const [photos, videos, lps] = await Promise.all([
        sql`SELECT * FROM look_photos WHERE look_id = CAST(${lookId} AS uuid) ORDER BY order_index`,
        sql`SELECT * FROM look_videos WHERE look_id = CAST(${lookId} AS uuid) ORDER BY order_index`,
        sql`SELECT lp.sort_order, lp.look_id, p.id AS product_id, p.name, p.brand, p.price, p.url, p.image_url FROM look_products lp JOIN products p ON p.id = lp.product_id WHERE lp.look_id = CAST(${lookId} AS uuid) ORDER BY lp.sort_order`,
      ]);

      await sql.end();
      return jsonRes({ success: true, data: { ...look, look_photos: photos, look_videos: videos, look_products: lps } });
    }

    // PUT /:id — update look
    if (method === 'PUT' && segments.length === 1) {
      const body = await req.json();
      const allowed = ['title', 'description', 'gender', 'color', 'enabled'];
      const updates = Object.fromEntries(Object.entries(body).filter(([k]) => allowed.includes(k)));
      if (Object.keys(updates).length === 0) { await sql.end(); return errorRes('No valid fields to update'); }

      const [look] = await sql`
        UPDATE looks SET ${sql(updates)}, updated_at = now()
        WHERE id = CAST(${lookId} AS uuid) AND user_id = CAST(${userId} AS uuid)
        RETURNING *
      `;
      if (!look) { await sql.end(); return errorRes('Not found', 404); }
      await sql.end();
      return jsonRes({ success: true, data: look });
    }

    // DELETE /:id — delete look
    if (method === 'DELETE' && segments.length === 1) {
      const photos = await sql`SELECT storage_path FROM look_photos WHERE look_id = CAST(${lookId} AS uuid)`;
      const videos = await sql`SELECT storage_path FROM look_videos WHERE look_id = CAST(${lookId} AS uuid)`;
      const paths = [...photos, ...videos].map((r: { storage_path: string }) => r.storage_path).filter(Boolean);
      if (paths.length > 0) {
        const storageClient = createClient(supabaseUrl, serviceRoleKey);
        await storageClient.storage.from('look-media').remove(paths);
      }
      await sql`DELETE FROM looks WHERE id = CAST(${lookId} AS uuid) AND user_id = CAST(${userId} AS uuid)`;
      await sql.end();
      return jsonRes({ success: true });
    }

    // POST /:id/submit
    if (method === 'POST' && segments[1] === 'submit') {
      const [look] = await sql`UPDATE looks SET status = 'submitted', updated_at = now() WHERE id = CAST(${lookId} AS uuid) AND user_id = CAST(${userId} AS uuid) RETURNING *`;
      await sql.end();
      return jsonRes({ success: true, data: look });
    }

    // POST /:id/archive
    if (method === 'POST' && segments[1] === 'archive') {
      const [current] = await sql`SELECT status FROM looks WHERE id = CAST(${lookId} AS uuid) AND user_id = CAST(${userId} AS uuid)`;
      const newStatus = current?.status === 'archived' ? 'draft' : 'archived';
      const archivedAt = newStatus === 'archived' ? new Date().toISOString() : null;
      const [look] = await sql`UPDATE looks SET status = ${newStatus}, archived_at = ${archivedAt}, updated_at = now() WHERE id = CAST(${lookId} AS uuid) AND user_id = CAST(${userId} AS uuid) RETURNING *`;
      await sql.end();
      return jsonRes({ success: true, data: look });
    }

    // POST /:id/products
    if (method === 'POST' && segments[1] === 'products') {
      const body = await req.json();
      let productId = body.product_id;
      if (!productId) {
        const productRow = {
          name: body.name || '',
          brand: body.brand ?? null,
          price: body.price ?? null,
          url: body.url ?? null,
          image_url: body.image_url ?? null,
        };
        const [product] = await sql`INSERT INTO products ${sql(productRow)} RETURNING id`;
        productId = product.id;
      }
      const [{ max_order }] = await sql`SELECT COALESCE(MAX(sort_order), -1) AS max_order FROM look_products WHERE look_id = CAST(${lookId} AS uuid)`;
      const junctionRow = {
        look_id: lookId,
        product_id: productId,
        sort_order: (max_order ?? -1) + 1,
      };
      await sql`INSERT INTO look_products ${sql(junctionRow)} ON CONFLICT DO NOTHING`;
      await sql.end();
      return jsonRes({ success: true, data: { product_id: productId } }, 201);
    }

    // DELETE /:id/products/:productId
    if (method === 'DELETE' && segments[1] === 'products' && segments[2]) {
      await sql`DELETE FROM look_products WHERE look_id = CAST(${lookId} AS uuid) AND product_id = CAST(${segments[2]} AS uuid)`;
      await sql.end();
      return jsonRes({ success: true });
    }

    // DELETE /:id/media/:type/:mediaId
    if (method === 'DELETE' && segments[1] === 'media' && segments[2] && segments[3]) {
      const mediaId = segments[3];
      const isPhoto = segments[2] === 'photo';
      const [media] = isPhoto
        ? await sql`SELECT storage_path FROM look_photos WHERE id = CAST(${mediaId} AS uuid)`
        : await sql`SELECT storage_path FROM look_videos WHERE id = CAST(${mediaId} AS uuid)`;
      if (media?.storage_path) {
        const storageClient = createClient(supabaseUrl, serviceRoleKey);
        await storageClient.storage.from('look-media').remove([media.storage_path]);
      }
      if (isPhoto) {
        await sql`DELETE FROM look_photos WHERE id = CAST(${mediaId} AS uuid)`;
      } else {
        await sql`DELETE FROM look_videos WHERE id = CAST(${mediaId} AS uuid)`;
      }
      await sql.end();
      return jsonRes({ success: true });
    }

    // POST /:id/photos or /:id/videos
    if (method === 'POST' && (segments[1] === 'photos' || segments[1] === 'videos')) {
      const body = await req.json();
      let record: unknown;
      if (segments[1] === 'photos') {
        const photoRow = {
          look_id: lookId,
          storage_path: body.storage_path ?? null,
          url: body.url ?? null,
          thumbnail_url: body.thumbnail_url ?? null,
          order_index: body.order_index ?? 0,
        };
        [record] = await sql`INSERT INTO look_photos ${sql(photoRow)} RETURNING *`;
      } else {
        const videoRow = {
          look_id: lookId,
          storage_path: body.storage_path ?? null,
          url: body.url ?? null,
          poster_url: body.poster_url ?? null,
          duration_seconds: body.duration_seconds ?? null,
          order_index: body.order_index ?? 0,
        };
        [record] = await sql`INSERT INTO look_videos ${sql(videoRow)} RETURNING *`;
      }
      await sql.end();
      return jsonRes({ success: true, data: record }, 201);
    }

    await sql.end();
    return errorRes('Not found', 404);
  } catch (e) {
    try { await sql.end(); } catch { /* noop */ }
    const msg = e instanceof Error ? e.message : 'Internal server error';
    console.error('manage-looks error:', msg);
    return errorRes(msg, 500);
  }
});
