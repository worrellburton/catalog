// spotify-search — admin-gated Spotify Web API proxy. Uses the
// client-credentials flow (no user OAuth needed) to mint a token, caches
// it in module memory for 50 min, and returns the trimmed track list the
// admin Musics tab renders.
//
// Required secrets (set via Supabase Dashboard → Functions → Secrets):
//   SPOTIFY_CLIENT_ID
//   SPOTIFY_CLIENT_SECRET
//
// Returns: { tracks: [{ id, name, artists, album, image_url, thumbnail_url,
//                      preview_url, external_url, duration_ms, explicit,
//                      popularity }] }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, x-client-info',
  'Access-Control-Max-Age': '86400',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

// Module-scope token cache. Spotify client-credentials tokens are valid
// for 3600s; we refresh at 3000s to leave a comfortable buffer.
let cachedToken: string | null = null;
let cachedTokenExpiresAt = 0;

async function getSpotifyToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && now < cachedTokenExpiresAt) return cachedToken;

  const id     = Deno.env.get('SPOTIFY_CLIENT_ID');
  const secret = Deno.env.get('SPOTIFY_CLIENT_SECRET');
  if (!id || !secret) throw new Error('SPOTIFY_CLIENT_ID/SECRET not configured');

  const basic = btoa(`${id}:${secret}`);
  const resp = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Spotify token ${resp.status}: ${text.slice(0, 200)}`);
  }
  const body = await resp.json() as { access_token: string; expires_in: number };
  cachedToken = body.access_token;
  cachedTokenExpiresAt = now + (body.expires_in - 600) * 1000; // refresh 10min early
  return cachedToken;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405);

  const supabaseUrl    = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceRoleKey) return json({ ok: false, error: 'misconfigured' }, 500);
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return json({ ok: false, error: 'unauthorized' }, 401);
  const token = authHeader.replace('Bearer ', '');
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  let isServiceRole = false;
  try {
    const parts = token.split('.');
    if (parts.length === 3) {
      const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
      if (payload?.role === 'service_role') isServiceRole = true;
    }
  } catch { /* fall through to user-JWT path */ }
  if (!isServiceRole) {
    const { data: { user: caller } } = await admin.auth.getUser(token);
    if (!caller) return json({ ok: false, error: 'unauthorized' }, 401);
    const { data: prof } = await admin.from('profiles').select('is_admin, role').eq('id', caller.id).maybeSingle();
    const isAdmin = prof?.is_admin === true || prof?.role === 'admin' || prof?.role === 'super_admin';
    if (!isAdmin) return json({ ok: false, error: 'admin only' }, 403);
  }

  let body: { query?: string; limit?: number };
  try { body = await req.json(); }
  catch { return json({ ok: false, error: 'JSON body required' }, 400); }
  const query = (body.query || '').trim();
  const limit = Math.min(Math.max(body.limit ?? 12, 1), 50);
  if (!query) return json({ ok: true, tracks: [] });

  let spotifyToken: string;
  try { spotifyToken = await getSpotifyToken(); }
  catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : 'token error' }, 500);
  }

  const url = new URL('https://api.spotify.com/v1/search');
  url.searchParams.set('q', query);
  url.searchParams.set('type', 'track');
  url.searchParams.set('limit', String(limit));
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${spotifyToken}` } });
  if (!resp.ok) {
    const text = await resp.text();
    return json({ ok: false, error: `Spotify ${resp.status}: ${text.slice(0, 200)}` }, 502);
  }
  type SpotifyImage = { url: string; height: number | null; width: number | null };
  type SpotifyArtist = { name: string };
  type SpotifyTrack = {
    id: string; name: string; preview_url: string | null;
    duration_ms: number; explicit: boolean; popularity: number;
    artists: SpotifyArtist[];
    album: { name: string; images: SpotifyImage[] };
    external_urls: { spotify: string };
  };
  const data = await resp.json() as { tracks: { items: SpotifyTrack[] } };
  const tracks = (data.tracks?.items || []).map(t => {
    const sorted = [...(t.album?.images || [])].sort((a, b) => (b.width ?? 0) - (a.width ?? 0));
    return {
      id: t.id,
      name: t.name,
      artists: (t.artists || []).map(a => a.name).join(', '),
      album: t.album?.name ?? null,
      image_url:     sorted[0]?.url ?? null,
      thumbnail_url: sorted[sorted.length - 1]?.url ?? sorted[0]?.url ?? null,
      preview_url:   t.preview_url,
      external_url:  t.external_urls?.spotify ?? null,
      duration_ms:   t.duration_ms,
      explicit:      t.explicit,
      popularity:    t.popularity,
    };
  });
  return json({ ok: true, tracks });
});
