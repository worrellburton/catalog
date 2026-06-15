import { useEffect, useRef } from 'react';
import { useLocation } from '@remix-run/react';
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
import { markOverlayReturn } from '~/utils/overlay-scroll-stash';

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
  onOpenProduct: (product: Product, opts?: { nav?: 'push' | 'seed' | 'none' }) => void;
  onOpenCreative: (creative: ProductAd, opts?: { nav?: 'push' | 'seed' | 'none' }) => void;
  onOpenLook: (look: Look, opts?: { nav?: 'push' | 'seed' | 'none' }) => void;
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

  // NOTE: the /p/ and /l/ history pushes used to live here (one useEffect
  // each, firing when selectedProduct/selectedLook changed). They moved into
  // the open handlers in routes/_index.tsx so the URL push happens in the same
  // synchronous tick as the in-memory stack-frame push — deterministically,
  // not via an effect that could re-fire during an async back-restore and
  // stack duplicate entries (the old "Back keeps landing on the same page"
  // loop). currentProductSlug / currentLookSlug below are still consumed by
  // the resolver guards (slugsRef).

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
      // The address bar may have moved on while we were resolving (slow cold
      // fetch + a fast Back/forward). Applying now would clobber whatever
      // surface the shopper is actually on. Only open if we're still on /p/slug.
      if (typeof window !== 'undefined' && window.location.pathname !== `/p/${slug}`) return;
      // Popstate opens are returns — restore the page's saved scroll.
      markOverlayReturn(slug);
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
          // 'seed': the entity is opened to match an existing history entry
          // (cold/shared link or a forward-nav slug not in the stack), so the
          // open handler records a frame but doesn't push another URL.
          if (creative) onOpenCreative(creative, { nav: 'seed' });
          else onOpenProduct(product, { nav: 'seed' });
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
          finish(() => onOpenProduct(product, { nav: 'seed' }));
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
      // Don't clobber the current surface if the bar moved on while getLooks()
      // resolved (slow first load + a fast Back). Only open if still on /l/slug.
      if (typeof window !== 'undefined' && window.location.pathname !== `/l/${slug}`) return;
      // Popstate opens are returns — restore the look's saved scroll.
      markOverlayReturn(slug);
      onOpenLook(match, { nav: 'seed' });
    });
  };

  // NOTE: the product/look re-open popstate listener that used to live here
  // was REMOVED. Back is now owned by a single listener in routes/_index.tsx
  // that restores the destination surface from the in-memory nav stack, and
  // only falls back to these async resolvers (returned below) when a popped
  // slug isn't in memory. Two listeners racing on the same popstate event was
  // the source of the feed/white flash; there is exactly one now.

  // Fresh-load consumer: on mount, read the deep-link slug and open the
  // matching modal once. After this, in-app navigation drives state and the
  // URL syncs back via the push effects above. Home is now a persistent PARENT
  // layout (see vite.config.ts), so the child route's :slug isn't reliably on
  // useParams() here — derive it from the path, which is always present.
  const location = useLocation();
  const detailMatch = location.pathname.match(/^\/(?:p|l|b|c)\/(.+)$/);
  const slugParam = detailMatch ? decodeURIComponent(detailMatch[1]) : undefined;
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

  // Surfaced for the Back reconcile in routes/_index.tsx: when a popped /p/
  // or /l/ slug isn't in the in-memory stack (forward-nav, post-reset back,
  // or a cold/shared link), it calls these to async-resolve + seed a frame.
  return { openProductFromSlug, openLookFromSlug };
}
