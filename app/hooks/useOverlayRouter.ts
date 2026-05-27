import { useEffect, useRef } from 'react';
import { useParams, useLocation } from '@remix-run/react';
import type { Look, Product } from '~/data/looks';
import {
  productSlug,
  lookSlug,
  brandSlug,
  extractIdPrefix,
  extractLookId,
} from '~/utils/slug';
import { looks as seedLooks } from '~/data/looks';
import { supabase } from '~/utils/supabase';
import { getCreativesByProductIds, type ProductAd } from '~/services/product-creative';

/** Increment an 8-char hex string by 1. Returns null on overflow (all-f prefix). */
function nextHexPrefix(prefix: string): string | null {
  const n = parseInt(prefix, 16) + 1;
  if (n > 0xffffffff) return null;
  return n.toString(16).padStart(8, '0');
}

/**
 * Fetch a product by its 8-char UUID prefix. UUID columns don't support ILIKE
 * so we use a range query: id >= '<prefix>-0000…' AND id < '<next>-0000…'.
 */
async function fetchProductByUuidPrefix(prefix: string): Promise<(Product & { id?: string }) | null> {
  if (!supabase) return null;
  const lower = `${prefix}-0000-0000-0000-000000000000`;
  const next = nextHexPrefix(prefix);
  let q = supabase
    .from('products')
    .select('id, name, brand, price, image_url, images, url, catalog_tags, type, is_elite')
    .gte('id', lower);
  if (next) {
    q = q.lt('id', `${next}-0000-0000-0000-000000000000`);
  }
  const { data } = await q.limit(1);
  const row = data?.[0];
  if (!row) return null;
  return {
    id: row.id,
    name: row.name || '',
    brand: row.brand || '',
    price: row.price || '',
    url: row.url || '',
    image: row.image_url || undefined,
  };
}

interface UseOverlayRouterArgs {
  selectedProduct: Product | null;
  selectedLook: Look | null;
  brandFilter: string | null;
  onOpenProduct: (product: Product) => void;
  onOpenCreative: (creative: ProductAd) => void;
  onOpenLook: (look: Look) => void;
  onOpenBrand: (brandName: string) => void;
}

// Two-way binding between the overlay state (product / look / brand) and
// the URL path (/p/:slug, /l/:slug, /b/:slug). Push direction uses
// replaceState (not navigate) so the SPA doesn't remount the feed - we
// just update the address bar so copy-link / back / refresh work.
//
// Initial consumption: on mount, if the user landed on /p/<slug> etc.,
// look the entity up and call the matching onOpen* so the overlay opens
// with the same effects (rails, prefetch) as an in-app tap.
export function useOverlayRouter({
  selectedProduct,
  selectedLook,
  brandFilter,
  onOpenProduct,
  onOpenCreative,
  onOpenLook,
  onOpenBrand,
}: UseOverlayRouterArgs) {
  // Push /p/<slug> when a product opens.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!selectedProduct) return;
    const slug = productSlug({
      id: (selectedProduct as Product & { id?: string | null }).id ?? null,
      brand: selectedProduct.brand ?? null,
      name: selectedProduct.name ?? null,
    });
    if (!slug) return;
    const target = `/p/${slug}`;
    if (window.location.pathname !== target) {
      window.history.replaceState({}, '', target);
    }
  }, [selectedProduct]);

  // Push /l/<slug> when a look opens.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!selectedLook) return;
    const slug = lookSlug({
      id: selectedLook.id ?? null,
      creator: selectedLook.creator ?? null,
      creatorDisplayName: selectedLook.creatorDisplayName ?? null,
      title: selectedLook.title ?? null,
    });
    if (!slug) return;
    const target = `/l/${slug}`;
    if (window.location.pathname !== target) {
      window.history.replaceState({}, '', target);
    }
  }, [selectedLook]);

  // Push /b/<slug> when a brand overlay opens.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!brandFilter) return;
    const slug = brandSlug(brandFilter);
    if (!slug) return;
    const target = `/b/${slug}`;
    if (window.location.pathname !== target) {
      window.history.replaceState({}, '', target);
    }
  }, [brandFilter]);

  // Pop /b/ when the brand overlay closes. Product close handles its own
  // pop in the route component (it has more state to clear).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (brandFilter) return;
    if (window.location.pathname.startsWith('/b/')) {
      window.history.replaceState({}, '', '/');
    }
  }, [brandFilter]);

  // Pop /l/ when the look overlay closes. Without this the URL stayed
  // pinned on /l/<slug> after the user backed out of a look, so a tab
  // refresh re-opened the same look every time and the address bar
  // stopped reflecting the actual surface.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (selectedLook) return;
    if (window.location.pathname.startsWith('/l/')) {
      window.history.replaceState({}, '', '/');
    }
  }, [selectedLook]);

  // Fresh-load consumer: on mount, read the route param Remix gave us
  // and open the matching modal once. After this, in-app navigation
  // drives state and the URL syncs back via the push effects above.
  const params = useParams();
  const location = useLocation();
  const slugParam = params.slug;
  const initialSlugConsumed = useRef(false);
  useEffect(() => {
    if (initialSlugConsumed.current) return;
    if (!slugParam) return;
    initialSlugConsumed.current = true;
    const path = location.pathname;
    if (path.startsWith('/p/')) {
      if (!supabase) return;
      const idPrefix = extractIdPrefix(slugParam);
      if (idPrefix) {
        // UUID-suffixed slug: fetch product then its live creative so
        // the reload experience matches an in-feed tap (video + rails).
        fetchProductByUuidPrefix(idPrefix).then(async product => {
          if (!product || !product.id) return;
          const creatives = await getCreativesByProductIds([product.id]);
          const creative = creatives[0];
          if (creative) {
            onOpenCreative(creative);
          } else {
            onOpenProduct(product);
          }
        });
      } else {
        // No UUID suffix (product opened from a look without a DB id).
        // Fall back to a name-based search using the slug words.
        const nameQuery = slugParam.replace(/-/g, '%');
        supabase
          .from('products')
          .select('id, name, brand, price, image_url, url')
          .ilike('name', `%${nameQuery}%`)
          .limit(1)
          .then(({ data }) => {
            const row = data?.[0];
            if (!row) return;
            const product: Product & { id?: string } = {
              id: row.id,
              name: row.name || '',
              brand: row.brand || '',
              price: row.price || '',
              url: row.url || '',
              image: row.image_url || undefined,
            };
            onOpenProduct(product);
          });
      }
    } else if (path.startsWith('/l/')) {
      const id = extractLookId(slugParam);
      if (id != null) {
        // Numeric ID: look up in seed data.
        const look = seedLooks.find(l => l.id === id);
        if (look) onOpenLook(look);
      } else {
        // No numeric ID — try UUID-prefix lookup in the DB looks table.
        const uuidPfx = extractIdPrefix(slugParam);
        if (!uuidPfx || !supabase) return;
        const lowerUuid = `${uuidPfx}-0000-0000-0000-000000000000`;
        const nextPfx = nextHexPrefix(uuidPfx);
        let lookQ = supabase
          .from('looks_creative')
          .select('id, uuid, title, creator, video_url, thumbnail_url, gender, description, color')
          .gte('uuid', lowerUuid);
        if (nextPfx) lookQ = lookQ.lt('uuid', `${nextPfx}-0000-0000-0000-000000000000`);
        lookQ.limit(1).then(({ data }) => {
            const row = data?.[0];
            if (!row) return;
            const look: Look = {
              id: row.id,
              uuid: row.uuid,
              title: row.title || '',
              creator: row.creator || '',
              video: row.video_url || '',
              gender: row.gender || 'unisex',
              description: row.description || '',
              color: row.color || '',
              products: [],
            };
            onOpenLook(look);
          });
      }
    } else if (path.startsWith('/b/')) {
      // Brand slug is the kebab brand name. Reverse-lookup against the
      // products table to find the canonical brand string (preserves
      // original casing / spacing).
      if (!supabase) return;
      supabase
        .from('products')
        .select('brand')
        .not('brand', 'is', null)
        .limit(2000)
        .then(({ data }) => {
          if (!data) return;
          const target = slugParam.toLowerCase();
          const match = (data as { brand: string }[]).find(r => brandSlug(r.brand) === target);
          if (match?.brand) onOpenBrand(match.brand);
        });
    }
    // onOpen* are stable refs from useCallback in the caller; deliberately
    // empty deps so this only runs once. The initialSlugConsumed ref
    // guards re-runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slugParam]);
}
