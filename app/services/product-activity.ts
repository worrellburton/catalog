// Everything that has happened to one product, as a single timeline:
// impressions (rolled up per day), clickouts, affiliate and search clicks,
// looks / catalogs / creators it was added to, creative renders and pipeline
// stages. Admin-only reads (RLS lets admins see every event table).

// imports
import { supabase } from '~/utils/supabase';

// types
export type ActivityKind =
  | 'impressions' | 'clickout' | 'affiliate' | 'search'
  | 'look' | 'catalog' | 'creator' | 'creative' | 'pipeline' | 'created';

export interface ActivityItem {
  id: string;
  at: string;
  kind: ActivityKind;
  label: string;
  detail?: string;
  who?: string | null;
}

export interface ActivityTotals {
  impressions: number;
  clickouts: number;
  affiliateClicks: number;
  searchClicks: number;
  looks: number;
  catalogs: number;
  creators: number;
  creatives: number;
}

export interface ProductActivity {
  items: ActivityItem[];
  totals: ActivityTotals;
}

type Row = Record<string, unknown>;

// constants
const EVENT_LIMIT = 500;

// helpers
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);

async function rows(query: PromiseLike<{ data: unknown; error: unknown }>): Promise<Row[]> {
  try {
    const { data, error } = await query;
    return error || !Array.isArray(data) ? [] : (data as Row[]);
  } catch {
    return [];
  }
}

async function exactCount(query: PromiseLike<{ count: number | null; error: unknown }>): Promise<number> {
  try {
    const { count, error } = await query;
    return error ? 0 : count ?? 0;
  } catch {
    return 0;
  }
}

async function nameMap(table: 'profiles' | 'looks' | 'catalogs', ids: string[], cols: string): Promise<Map<string, Row>> {
  if (!supabase || ids.length === 0) return new Map();
  const list = await rows(supabase.from(table).select(cols).in('id', ids.slice(0, 300)));
  return new Map(list.map(r => [String(r.id), r]));
}

/** Impressions collapse to one row per day — the raw stream is noise. */
function rollUpImpressions(events: Row[]): ActivityItem[] {
  const byDay = new Map<string, { at: string; n: number }>();
  for (const e of events) {
    const at = str(e.created_at);
    if (!at) continue;
    const day = at.slice(0, 10);
    const slot = byDay.get(day);
    if (slot) slot.n += 1;
    else byDay.set(day, { at, n: 1 });
  }
  return [...byDay.entries()].map(([day, { at, n }]) => ({
    id: `imp-${day}`, at, kind: 'impressions' as const, label: `Seen ${n} time${n === 1 ? '' : 's'}`,
  }));
}

// main logic
/** Load the full activity timeline for a product, newest first. */
export async function loadProductActivity(productId: string, createdAt?: string | null): Promise<ProductActivity> {
  const empty: ProductActivity = {
    items: [],
    totals: { impressions: 0, clickouts: 0, affiliateClicks: 0, searchClicks: 0, looks: 0, catalogs: 0, creators: 0, creatives: 0 },
  };
  if (!supabase || !productId) return empty;
  const sb = supabase;

  const [
    events, impressionCount, clickoutCount, affiliate, affiliateCount, search, searchCount,
    lookLinks, catalogLinks, creatorLinks, creatives, pipeline,
  ] = await Promise.all([
    rows(sb.from('user_events').select('id, user_id, event_type, context, created_at')
      .eq('target_type', 'product').eq('target_uuid', productId)
      .order('created_at', { ascending: false }).limit(EVENT_LIMIT)),
    exactCount(sb.from('user_events').select('id', { count: 'exact', head: true })
      .eq('target_type', 'product').eq('target_uuid', productId).eq('event_type', 'impression')),
    exactCount(sb.from('user_events').select('id', { count: 'exact', head: true })
      .eq('target_type', 'product').eq('target_uuid', productId).eq('event_type', 'clickout')),
    rows(sb.from('affiliate_clicks').select('id, user_id, surface, rail, creator_handle, clicked_at')
      .eq('product_id', productId).order('clicked_at', { ascending: false }).limit(200)),
    exactCount(sb.from('affiliate_clicks').select('id', { count: 'exact', head: true }).eq('product_id', productId)),
    rows(sb.from('search_query_clicks').select('id, position, clicked_at')
      .eq('product_id', productId).order('clicked_at', { ascending: false }).limit(100)),
    exactCount(sb.from('search_query_clicks').select('id', { count: 'exact', head: true }).eq('product_id', productId)),
    rows(sb.from('look_products').select('id, look_id, source, added_at').eq('product_id', productId)),
    rows(sb.from('catalog_products').select('catalog_id, source, added_at').eq('product_id', productId)),
    rows(sb.from('creator_products').select('creator_handle, source, created_at').eq('product_id', productId)),
    rows(sb.from('product_creative').select('id, status, model, cost_usd, created_at, completed_at').eq('product_id', productId)),
    rows(sb.from('pipeline_events').select('id, stage, event, detail, created_at')
      .eq('product_id', productId).order('created_at', { ascending: false }).limit(200)),
  ]);

  const userIds = [...new Set([...events, ...affiliate].map(e => str(e.user_id)).filter((v): v is string => !!v))];
  const [people, looks, catalogs] = await Promise.all([
    nameMap('profiles', userIds, 'id, full_name, email'),
    nameMap('looks', lookLinks.map(l => String(l.look_id)), 'id, title, creator_handle'),
    nameMap('catalogs', catalogLinks.map(c => String(c.catalog_id)), 'id, name, slug'),
  ]);
  const who = (id: unknown): string | null => {
    const p = people.get(String(id));
    return p ? str(p.full_name) || str(p.email) : null;
  };

  const items: ActivityItem[] = [
    ...rollUpImpressions(events.filter(e => e.event_type === 'impression')),
    ...events.filter(e => e.event_type === 'clickout').map(e => ({
      id: `co-${e.id}`, at: String(e.created_at), kind: 'clickout' as const, label: 'Clicked out to the retailer', who: who(e.user_id),
    })),
    ...affiliate.map(a => ({
      id: `af-${a.id}`, at: String(a.clicked_at), kind: 'affiliate' as const, label: 'Affiliate click',
      detail: [str(a.surface), str(a.rail), str(a.creator_handle) && `@${a.creator_handle}`].filter(Boolean).join(' · ') || undefined,
      who: who(a.user_id),
    })),
    ...search.map(s => ({
      id: `sq-${s.id}`, at: String(s.clicked_at), kind: 'search' as const, label: 'Clicked from search',
      detail: num(s.position) != null ? `Result #${Number(s.position) + 1}` : undefined,
    })),
    ...lookLinks.map(l => {
      const look = looks.get(String(l.look_id));
      return {
        id: `lk-${l.id}`, at: String(l.added_at), kind: 'look' as const,
        label: `Added to look “${str(look?.title) || 'Untitled'}”`,
        detail: [str(look?.creator_handle) && `@${look?.creator_handle}`, str(l.source)].filter(Boolean).join(' · ') || undefined,
      };
    }),
    ...catalogLinks.map(c => {
      const cat = catalogs.get(String(c.catalog_id));
      return {
        id: `ct-${c.catalog_id}`, at: String(c.added_at), kind: 'catalog' as const,
        label: `Added to catalog ${str(cat?.name) || str(cat?.slug) || ''}`.trim(), detail: str(c.source) ?? undefined,
      };
    }),
    ...creatorLinks.map(c => ({
      id: `cr-${c.creator_handle}`, at: String(c.created_at), kind: 'creator' as const,
      label: `Pinned by @${c.creator_handle}`, detail: str(c.source) ?? undefined,
    })),
    ...creatives.map(c => ({
      id: `cv-${c.id}`, at: String(c.completed_at || c.created_at), kind: 'creative' as const,
      label: `Video ${str(c.status) || 'created'}`,
      detail: [str(c.model), num(c.cost_usd) != null && `$${Number(c.cost_usd).toFixed(2)}`].filter(Boolean).join(' · ') || undefined,
    })),
    ...pipeline.map(p => ({
      id: `pl-${p.id}`, at: String(p.created_at), kind: 'pipeline' as const,
      label: [str(p.stage), str(p.event)].filter(Boolean).join(' · ') || 'Pipeline',
      detail: typeof p.detail === 'string' ? p.detail : undefined,
    })),
    ...(createdAt ? [{ id: 'created', at: createdAt, kind: 'created' as const, label: 'Product added' }] : []),
  ].filter(i => i.at && i.at !== 'null' && i.at !== 'undefined');

  items.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return {
    items,
    totals: {
      impressions: impressionCount,
      clickouts: clickoutCount,
      affiliateClicks: affiliateCount,
      searchClicks: searchCount,
      looks: lookLinks.length,
      catalogs: catalogLinks.length,
      creators: creatorLinks.length,
      creatives: creatives.length,
    },
  };
}
