import { useEffect, useRef } from 'react';
import { useParams, useLocation } from '@remix-run/react';
import type { Look, Product } from '~/data/looks';
import {
  productSlug,
  lookSlug,
  brandSlug,
  creatorSlug,
  extractIdPrefix,
  extractLookId,
  nextHexPrefix,
} from '~/utils/slug';
import { looks as seedLooks } from '~/data/looks';
import { getLooks } from '~/services/looks';
import { supabase } from '~/utils/supabase';
import { getCreativesByProductIds, type ProductAd } from '~/services/product-creative';

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
  /** Active creator handle (or null). Drives /c/<slug> URL sync so
   *  browser back returns to the previous surface instead of exiting
   *  the site. */
  creatorFilter: string | null;
  onOpenProduct: (product: Product) => void;
  onOpenCreative: (creative: ProductAd) => void;
  onOpenLook: (look: Look) => void;
  onOpenBrand: (brandName: string) => void;
  onOpenCreator: (creatorName: string) => void;
}

// Two-way binding between the overlay state (product / look / brand) and
// the URL path (/p/:slug, /l/:slug, /b/:slug). Push direction uses
// history pushState (not navigate) so the SPA doesn't remount the feed -
// we just update the address bar so copy-link / back / refresh work.
//
// Initial consumption: on mount, if the user landed on /p/<slug> etc.,
// look the entity up and call the matching onOpen* so the overlay opens
// with the same effects (rails, prefetch) as an in-app tap.
//
// Back consumption: EVERY overlay open pushes a history entry — including
// product → product and look → look (founder's call: back must return to
// the previous screen, never skip the chain to home). The popstate
// listener below re-resolves /p/ and /l/ URLs so backing into an earlier
// product/look actually re-opens it.
export function useOverlayRouter({
  selectedProduct,
  selectedLook,
  brandFilter,
  creatorFilter,
  onOpenProduct,
  onOpenCreative,
  onOpenLook,
  onOpenBrand,
  onOpenCreator,
}: UseOverlayRouterArgs) {
  // Latest open-entity slugs, readable from the (empty-dep) popstate
  // listener without stale closures.
  const currentProductSlug = selectedProduct
    ? productSlug({
        id: (selectedProduct as Product & { id?: string | null }).id ?? null,
        brand: selectedProduct.brand ?? null,
        name: selectedProduct.name ?? null,
      })
    : null;
  const currentLookSlug = selectedLook
    ? lookSlug({
        id: selectedLook.id ?? null,
        uuid: selectedLook.uuid ?? null,
        creator: selectedLook.creator ?? null,
        creatorDisplayName: selectedLook.creatorDisplayName ?? null,
        title: selectedLook.title ?? null,
      })
    : null;
  const slugsRef = useRef({ product: currentProductSlug, look: currentLookSlug });
  slugsRef.current = { product: currentProductSlug, look: currentLookSlug };

  // Push /p/<slug> when a product opens. Every distinct product gets its
  // own history entry — product → product included — so the back button
  // walks the exact trail the shopper browsed (founder's call; the old
  // replaceState "don't peel through every product" rule made back from
  // a similar-rail product skip to the home screen).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!selectedProduct) return;
    if (!currentProductSlug) return;
    const target = `/p/${currentProductSlug}`;
    if (window.location.pathname === target) return;
    window.history.pushState({ overlay: 'product' }, '', target);
  }, [selectedProduct, currentProductSlug]);

  // Push /l/<slug> when a look opens. Same rule: every look stacks.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!selectedLook) return;
    if (!currentLookSlug) return;
    const target = `/l/${currentLookSlug}`;
    if (window.location.pathname === target) return;
    window.history.pushState({ overlay: 'look' }, '', target);
  }, [selectedLook, currentLookSlug]);

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

  // Push /c/<slug> when a creator catalog opens. pushState (not
  // replace) so the browser back button pops back to whatever the
  // shopper was on before — previously the URL stayed on /#app and
  // back exited the site entirely.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!creatorFilter) return;
    const slug = creatorSlug(creatorFilter);
    if (!slug) return;
    const target = `/c/${slug}`;
    const current = window.location.pathname;
    if (current === target) return;
    if (current.startsWith('/c/')) {
      window.history.replaceState({ overlay: 'creator' }, '', target);
    } else {
      window.history.pushState({ overlay: 'creator' }, '', target);
    }
  }, [creatorFilter]);

  // ── Slug → entity resolvers ────────────────────────────────────────────
  // Shared by the fresh-load consumer (mount on /p/…) and the popstate
  // listener (back/forward landing on /p/… or /l/…). Each resolver
  // re-checks the live slug just before opening so a state-driven restore
  // that already happened (e.g. _index's look-restore on product close)
  // isn't double-opened by the async lookup finishing late.
  const resolvingRef = useRef<string | null>(null);

  const openProductFromSlug = (slug: string) => {
    if (!supabase) return;
    if (resolvingRef.current === `p:${slug}`) return;
    resolvingRef.current = `p:${slug}`;
    const finish = (open: () => void) => {
      if (resolvingRef.current === `p:${slug}`) resolvingRef.current = null;
      if (slugsRef.current.product === slug) return; // already showing it
      open();
    };
    const idPrefix = extractIdPrefix(slug);
    if (idPrefix) {
      // UUID-suffixed slug: fetch product then its live creative so the
      // experience matches an in-feed tap (video + rails).
      void fetchProductByUuidPrefix(idPrefix).then(async product => {
        if (!product || !product.id) { resolvingRef.current = null; return; }
        const creatives = await getCreativesByProductIds([product.id]);
        const creative = creatives[0];
        finish(() => {
          if (creative) onOpenCreative(creative);
          else onOpenProduct(product);
        });
      });
    } else {
      // No UUID suffix (product opened from a look without a DB id).
      // Fall back to a name-based search using the slug words.
      const nameQuery = slug.replace(/-/g, '%');
      void supabase
        .from('products')
        .select('id, name, brand, price, image_url, url')
        .ilike('name', `%${nameQuery}%`)
        .limit(1)
        .then(({ data }) => {
          const row = data?.[0];
          if (!row) { resolvingRef.current = null; return; }
          const product: Product & { id?: string } = {
            id: row.id,
            name: row.name || '',
            brand: row.brand || '',
            price: row.price || '',
            url: row.url || '',
            image: row.image_url || undefined,
          };
          finish(() => onOpenProduct(product));
        });
    }
  };

  const openLookFromSlug = (slug: string) => {
    if (resolvingRef.current === `l:${slug}`) return;
    resolvingRef.current = `l:${slug}`;
    // Resolve against the SAME getLooks() set the feed renders, so the
    // opened Look is fully-formed (creator name, video, products). It's
    // cached — no extra cost.
    const slugForLook = (l: Look) => lookSlug({
      id: l.id ?? null, uuid: l.uuid ?? null, creator: l.creator ?? null,
      creatorDisplayName: l.creatorDisplayName ?? null, title: l.title ?? null,
    });
    const uuidPfx = extractIdPrefix(slug);
    // Human part of the requested slug (trailing uuid/numeric suffix
    // removed) — rescues legacy links minted before uuid suffixes.
    const wantHuman = slug.replace(/-([0-9a-f]{8}|\d+)$/i, '');
    void getLooks().then(looks => {
      let match: Look | undefined;
      // 1. Exact slug match (covers current uuid- and numeric-suffixed links).
      match = looks.find(l => slugForLook(l) === slug);
      // 2. UUID-prefix match.
      if (!match && uuidPfx) {
        match = looks.find(l => !!l.uuid && l.uuid.toLowerCase().startsWith(uuidPfx.toLowerCase()));
      }
      // 3. Human-part match (creator+title, then title-only) for legacy links.
      if (!match) {
        match = looks.find(l => lookSlug({ creator: l.creator ?? null, title: l.title ?? null }) === wantHuman)
          || looks.find(l => lookSlug({ creatorDisplayName: l.creatorDisplayName ?? null, title: l.title ?? null }) === wantHuman)
          || looks.find(l => lookSlug({ title: l.title ?? null }) === wantHuman);
      }
      // 4. Seed fallback by numeric id (only if nothing above matched).
      if (!match) {
        const id = extractLookId(slug);
        if (id != null) match = seedLooks.find(l => l.id === id);
      }
      if (resolvingRef.current === `l:${slug}`) resolvingRef.current = null;
      if (!match) return;
      if (slugsRef.current.look === slug) return; // already showing it
      onOpenLook(match);
    });
  };

  // Back/forward landing on an overlay URL re-opens that overlay. The exit
  // paths (/p/ → /, /l/ → /, …) stay with the popstate listener in
  // routes/_index.tsx — this one only ever OPENS.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onPop = () => {
      const path = window.location.pathname;
      if (path.startsWith('/p/')) {
        const slug = decodeURIComponent(path.slice(3));
        if (slug && slug !== slugsRef.current.product) openProductFromSlug(slug);
      } else if (path.startsWith('/l/')) {
        const slug = decodeURIComponent(path.slice(3));
        if (slug && slug !== slugsRef.current.look) openLookFromSlug(slug);
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
    // openProductFromSlug / openLookFromSlug close over stable onOpen*
    // callbacks (useCallback in the caller) — safe with empty deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      openProductFromSlug(slugParam);
    } else if (path.startsWith('/l/')) {
      openLookFromSlug(slugParam);
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
    } else if (path.startsWith('/c/')) {
      // Creator slug. Two flavors mirror creatorSlug() above:
      //   • "u-<8hex>"   → owner key, resolve back to user:<uuid>
      //   • everything else → real handle, query the creators table
      //     for the canonical handle (kebab inverse can collide on
      //     unusual casing/punctuation).
      if (!supabase) return;
      if (slugParam.startsWith('u-')) {
        const pfx = slugParam.slice(2).toLowerCase();
        if (!/^[0-9a-f]{8}$/.test(pfx)) return;
        const lower = `${pfx}-0000-0000-0000-000000000000`;
        const next = nextHexPrefix(pfx);
        let q = supabase.from('profiles').select('id').gte('id', lower);
        if (next) q = q.lt('id', `${next}-0000-0000-0000-000000000000`);
        q.limit(1).then(({ data }) => {
          const row = data?.[0];
          if (row?.id) onOpenCreator(`user:${row.id}`);
        });
      } else {
        supabase
          .from('creators')
          .select('handle')
          .limit(5000)
          .then(({ data }) => {
            if (!data) return;
            const target = slugParam.toLowerCase();
            const match = (data as { handle: string }[]).find(r => creatorSlug(r.handle) === target);
            if (match?.handle) onOpenCreator(match.handle);
            else onOpenCreator(slugParam); // fallback: pass the slug verbatim
          });
      }
    }
    // onOpen* are stable refs from useCallback in the caller; deliberately
    // empty deps so this only runs once. The initialSlugConsumed ref
    // guards re-runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slugParam]);
}
