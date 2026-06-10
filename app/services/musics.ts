// Music catalog. Spotify is the source of truth; admins search via the
// `spotify-search` edge function (client-credentials, server-side secret)
// and save tracks into public.musics. Consumer surfaces (credits on look
// cards, creator profile songs, etc.) read straight from musics so we
// never need a live Spotify call on the user-facing path.

import { supabase, SUPABASE_URL } from '~/utils/supabase';

export interface MusicTrack {
  id: string;
  spotify_track_id: string;
  name: string;
  artist: string | null;
  album: string | null;
  image_url: string | null;
  thumbnail_url: string | null;
  preview_url: string | null;
  external_url: string | null;
  duration_ms: number | null;
  explicit: boolean;
  popularity: number | null;
  added_by: string | null;
  created_at: string;
}

export interface SpotifySearchHit {
  id: string;            // spotify track id (NOT a musics row id — saved tracks get a uuid)
  name: string;
  artists: string;
  album: string | null;
  image_url: string | null;
  thumbnail_url: string | null;
  preview_url: string | null;
  external_url: string | null;
  duration_ms: number;
  explicit: boolean;
  popularity: number;
}

/** Search Spotify via the admin-gated edge function. Returns [] on empty
 *  query (the function shortcircuits). Throws on hard errors so the admin
 *  panel can surface the message — usually "secrets not configured" on
 *  first-run before SPOTIFY_CLIENT_ID/SECRET are set. */
export async function spotifySearch(query: string, limit = 12): Promise<SpotifySearchHit[]> {
  if (!supabase) return [];
  const q = query.trim();
  if (!q) return [];
  const { data: sess } = await supabase.auth.getSession();
  const token = sess?.session?.access_token;
  if (!token) throw new Error('Sign in as an admin to search Spotify.');
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/spotify-search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ query: q, limit }),
  });
  const body = await resp.json().catch(() => ({})) as { ok?: boolean; tracks?: SpotifySearchHit[]; error?: string };
  if (!resp.ok || body.ok === false) throw new Error(body.error || `HTTP ${resp.status}`);
  return body.tracks ?? [];
}

/** Load the saved music library (most recent first). */
export async function listMusics(): Promise<MusicTrack[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('musics')
    .select('id, spotify_track_id, name, artist, album, image_url, thumbnail_url, preview_url, external_url, duration_ms, explicit, popularity, added_by, created_at')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data || []) as MusicTrack[];
}

/** Save a Spotify track into musics. Idempotent via the spotify_track_id
 *  unique constraint — re-adding an existing track returns the existing
 *  row. */
export async function addMusicFromSpotify(hit: SpotifySearchHit): Promise<MusicTrack> {
  if (!supabase) throw new Error('Supabase not configured');
  const { data: sess } = await supabase.auth.getSession();
  const uid = sess?.session?.user?.id ?? null;
  const { data, error } = await supabase
    .from('musics')
    .upsert({
      spotify_track_id: hit.id,
      name:          hit.name,
      artist:        hit.artists,
      album:         hit.album,
      image_url:     hit.image_url,
      thumbnail_url: hit.thumbnail_url,
      preview_url:   hit.preview_url,
      external_url:  hit.external_url,
      duration_ms:   hit.duration_ms,
      explicit:      hit.explicit,
      popularity:    hit.popularity,
      added_by:      uid,
    }, { onConflict: 'spotify_track_id' })
    .select('id, spotify_track_id, name, artist, album, image_url, thumbnail_url, preview_url, external_url, duration_ms, explicit, popularity, added_by, created_at')
    .single();
  if (error) throw new Error(error.message);
  return data as MusicTrack;
}

/** Remove a saved track from the library. */
export async function deleteMusic(id: string): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.from('musics').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

/** Pretty mm:ss for a duration_ms value. */
export function formatTrackDuration(ms: number | null | undefined): string {
  if (!ms || ms < 0) return '—';
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}
