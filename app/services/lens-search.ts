/**
 * Client wrappers for the `lens-search` + `lens-ingest` edge functions.
 *
 * lens-search: takes a Style-sheet image URL (or a cropped region URL)
 *   and returns visual-match shopping results from Google Lens via
 *   SerpAPI. The matches are NOT persisted yet — the user picks which
 *   ones they want to shop / try on.
 *
 * lens-ingest: persists the user's picked matches into public.products
 *   (service-role, dedupes by url, queues embed-product) so the
 *   /generate wizard can deep-link to them via ?product_url=… and the
 *   try-on pipeline can resolve them.
 */

import { supabase } from '~/utils/supabase';
import { SUPABASE_URL } from '~/utils/supabase';

export interface LensMatch {
  position: number;
  title: string;
  source: string;
  source_icon: string;
  link: string;
  thumbnail: string;
  image: string;
  price: string;
  brand: string;
  rating: number | null;
  reviews: number | null;
}

export interface LensSearchResult {
  matches: LensMatch[];
  error?: string;
}

export interface LensIngestResultItem {
  id: string | null;
  name: string;
  url: string;
  deduped: boolean;
  error?: string;
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  // Lens functions sit behind the standard Supabase JWT gate. We pass
  // the user's access token when one exists so usage rows attribute to
  // the right session.
  if (!supabase) return {};
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function lensSearch(args: {
  imageUrl: string;
  q?: string;
  country?: string;
}): Promise<LensSearchResult> {
  try {
    const auth = await getAuthHeaders();
    const res = await fetch(`${SUPABASE_URL}/functions/v1/lens-search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth },
      body: JSON.stringify({
        image_url: args.imageUrl,
        q: args.q ?? '',
        country: args.country ?? 'us',
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.success) {
      return { matches: [], error: json.error || `Lens search failed (${res.status})` };
    }
    return { matches: Array.isArray(json.matches) ? json.matches : [] };
  } catch (err) {
    return { matches: [], error: err instanceof Error ? err.message : String(err) };
  }
}

export interface LensIngestInput {
  name: string;
  url: string;
  image_url: string;
  brand?: string | null;
  price?: string | null;
  gender?: 'men' | 'women' | 'unisex';
}

export async function lensIngest(args: {
  items: LensIngestInput[];
  sourceImageUrl?: string;
}): Promise<{ ingested: LensIngestResultItem[]; error?: string }> {
  try {
    const auth = await getAuthHeaders();
    const res = await fetch(`${SUPABASE_URL}/functions/v1/lens-ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth },
      body: JSON.stringify({
        items: args.items,
        source_image_url: args.sourceImageUrl,
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.success) {
      return { ingested: [], error: json.error || `Lens ingest failed (${res.status})` };
    }
    return { ingested: Array.isArray(json.ingested) ? json.ingested : [] };
  } catch (err) {
    return { ingested: [], error: err instanceof Error ? err.message : String(err) };
  }
}
