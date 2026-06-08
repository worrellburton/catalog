import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from '@remix-run/react';
import CatalogLogo from '~/components/CatalogLogo';
import ParticleBackground from '~/components/ParticleBackground';
import AutoplayVideo from '~/components/AutoplayVideo';
import { particleControls } from '~/services/particles';
import { supabase } from '~/utils/supabase';
import { useAuth } from '~/hooks/useAuth';
import { startGenerationJob } from '~/services/generation-queue';
import { playExplosion } from '~/utils/explode';

// /generate-only styles. Used to be in root.tsx where the consumer paid
// the bundle cost on every page.
import '~/styles/generate.css';
import {
  STYLE_PRESETS,
  buildGenerationPrompt,
  createGeneration,
  nameLookForGeneration,
  deleteUserGeneration,
  setGenerationPublished,
  setGenerationFeedback,
  deleteUserUpload,
  getGeneration,
  getGenerationDetail,
  getUserSlots,
  listUserGenerations,
  listUserUploads,
  saveUserSlots,
  updateGenerationCrop,
  uploadUserPhoto,
  checkFacePhoto,
  GENERATION_STALE_MS,
  type UserUpload,
  type UserGeneration,
  type GenerationProductDetail,
} from '~/services/user-generations';
import { promoteGenerationToLook } from '~/services/promote-generation';
import { getUserGender, type UserGender } from '~/services/genders';
import {
  getUserHeightAge,
  updateUserHeightAge,
  getUserCustomStyle,
  getImpersonationTarget,
  type ImpersonationTarget,
} from '~/services/profiles';
import { ConfirmModal, useConfirm } from '~/components/ConfirmModal';
import StatsEditorModal from '~/components/StatsEditorModal';
import '~/styles/style-page.css'; /* shares the stats-editor modal CSS */
import {
  createLookShare,
  getLookShare,
  shareUrlFor,
  type LookShare,
} from '~/services/look-shares';

/* -----------------------------------------------------------
   Generate flow - shopper-facing, multi-step wizard.
   Steps 1–5 cover Photos → Products → Height → Style → Review;
   submit kicks off a generate_look edge function and polls the
   user_generations row until status hits done|failed.
   ----------------------------------------------------------- */

// Head-to-toe ordering for "Products in this look". Lower index =
// higher up the body. Untagged items fall to the bottom in their
// original sort_order. Garments come first, accessories trail.
const ROLE_DISPLAY_ORDER: Record<string, number> = {
  hat: 1,
  sunglasses: 2,
  scarf: 3,
  top: 4,
  jacket: 5,
  coat: 6,
  dress: 7,
  suit: 8,
  belt: 9,
  pants: 10,
  skirt: 11,
  shorts: 12,
  shoes: 13,
  sneakers: 13,
  boots: 13,
  sandals: 13,
  heels: 13,
  socks: 14,
  bag: 15,
  wallet: 16,
  watch: 17,
  jewelry: 18,
  necklace: 18,
  ring: 18,
  earrings: 18,
  bracelet: 18,
  accessory: 19,
};

function sortProductsHeadToToe<T extends { role_tag: string | null; sort_order?: number }>(
  rows: T[],
): T[] {
  return [...rows].sort((a, b) => {
    const ar = (a.role_tag || '').toLowerCase().trim();
    const br = (b.role_tag || '').toLowerCase().trim();
    const arank = ROLE_DISPLAY_ORDER[ar] ?? 99;
    const brank = ROLE_DISPLAY_ORDER[br] ?? 99;
    if (arank !== brank) return arank - brank;
    return (a.sort_order ?? 0) - (b.sort_order ?? 0);
  });
}

const MAX_PHOTOS = 3;
const MAX_PRODUCTS = 5;

// Seedance 2 reference-to-video with multiple references runs longer
// than v1: latest data shows ~166s on the only success and ~180s+ on
// runs that timed out client-side. We now use Fal webhooks (no
// internal poller cap), so budget 180s for the user-facing progress
// bar; it eases past 95% so it never sits flat on slow jobs.
// Typical wall-clock generation time keyed by the requested clip
// length. 5s jobs route to Seedance 2 /fast (~180s); 10s jobs route
// to /pro which is materially slower (~360s). The progress bar eases
// past 95% of whichever estimate applies so it never sits at 100%
// while we're still polling.
const TYPICAL_GENERATION_SECONDS_BY_DURATION: Record<number, number> = {
  5: 180,
  10: 360,
};
const TYPICAL_GENERATION_SECONDS_DEFAULT = 180;
const typicalSecondsFor = (durationSeconds?: number | null) =>
  TYPICAL_GENERATION_SECONDS_BY_DURATION[durationSeconds ?? 0]
  ?? TYPICAL_GENERATION_SECONDS_DEFAULT;

type Step = 'photos' | 'products' | 'style' | 'review' | 'result';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Age presets keep the picker compact - Seedance just needs a phrase
// to seed how old the subject reads. Defaults to "mid 20s".
const AGE_PRESETS: { label: string }[] = [
  { label: 'late teens' },
  { label: 'early 20s' },
  { label: 'mid 20s' },
  { label: 'late 20s' },
  { label: 'early 30s' },
  { label: 'mid 30s' },
  { label: 'early 40s' },
  { label: '50s' },
  { label: '60s+' },
];

interface PickedProduct {
  id: string;
  name: string | null;
  brand: string | null;
  price: string | null;
  image_url: string | null;
  role_tag: string | null;
  // Optional richer media for the unified field cards (poster + product video).
  primary_image_url?: string | null;
  primary_video_url?: string | null;
  primary_video_poster_url?: string | null;
}

const ROLE_TAGS = ['Hat', 'Top', 'Jacket', 'Dress', 'Pants', 'Shoes', 'Bag', 'Jewelry', 'Sunglasses', 'Accessory'];

// User-facing category buckets for the products picker. Each row in the
// product picker maps to one of these. `tags: null` is the Objects
// bucket - anything roleTagFromName() couldn't classify falls in here
// so the catalog is never hidden from the picker.
const CATEGORY_GROUPS: Array<{ label: string; tags: string[] | null }> = [
  { label: 'Hat', tags: ['Hat'] },
  { label: 'Top', tags: ['Top', 'Jacket', 'Dress'] },
  { label: 'Bottoms', tags: ['Pants'] },
  { label: 'Shoes', tags: ['Shoes'] },
  { label: 'Accessories', tags: ['Bag', 'Jewelry', 'Sunglasses', 'Accessory'] },
  { label: 'Objects', tags: null },
];

// "All" row pinned at the top of the picker: aggregates every product and
// lets the shopper search across all products + brands in one place. Rendered
// before the category rows (and defaults to expanded — see `expanded` below).
const ALL_GROUP: { label: string; tags: string[] | null } = { label: 'All', tags: [] };
const PICKER_GROUPS = [...CATEGORY_GROUPS, ALL_GROUP];

/** True if the product belongs to the named bucket. `All` matches every
 *  product; `Objects` matches anything that doesn't fit a clothing role. */
function productInCategory(p: { role_tag?: string | null }, group: typeof CATEGORY_GROUPS[number]): boolean {
  if (group.label === 'All') return true;
  if (group.tags === null) {
    return !p.role_tag || !ROLE_TAGS.includes(p.role_tag);
  }
  return !!p.role_tag && group.tags.includes(p.role_tag);
}

// Height options cover 4'10" – 6'8" in 1" increments; we store the cm value
// on the row and the human label verbatim in the Seedance prompt so the
// model hears "5'10\"" the way the shopper picked it.
const HEIGHT_OPTIONS = (() => {
  const out: { cm: number; label: string }[] = [];
  for (let totalInches = 58; totalInches <= 80; totalInches++) {
    const ft = Math.floor(totalInches / 12);
    const inches = totalInches % 12;
    out.push({ cm: Math.round(totalInches * 2.54), label: `${ft}'${inches}"` });
  }
  return out;
})();

function roleTagFromName(name: string | null): string | null {
  if (!name) return null;
  const lower = name.toLowerCase();
  if (/\b(hat|cap|beanie)\b/.test(lower)) return 'Hat';
  if (/\b(sunglass|shades|eyewear)\b/.test(lower)) return 'Sunglasses';
  if (/\b(jacket|coat|parka|blazer)\b/.test(lower)) return 'Jacket';
  if (/\b(dress|gown)\b/.test(lower)) return 'Dress';
  if (/\b(pant|trouser|chino|jean|denim|short|skirt|legging)\b/.test(lower)) return 'Pants';
  if (/\b(sneaker|trainer|shoe|boot|heel|loafer|sandal)\b/.test(lower)) return 'Shoes';
  if (/\b(bag|tote|clutch|purse|backpack)\b/.test(lower)) return 'Bag';
  if (/\b(necklace|ring|earring|bracelet|watch|chain|pendant)\b/.test(lower)) return 'Jewelry';
  if (/\b(shirt|tee|top|sweater|hoodie|polo|henley|tank)\b/.test(lower)) return 'Top';
  return null;
}

const STEP_VALUES: readonly Step[] = ['photos', 'products', 'style', 'review', 'result'];

function readStepFromUrl(): Step {
  if (typeof window === 'undefined') return 'photos';
  try {
    const q = new URLSearchParams(window.location.search).get('step');
    if (q && (STEP_VALUES as readonly string[]).includes(q)) return q as Step;
  } catch { /* ignore */ }
  return 'photos';
}

// Per-style glyph for the style cards. Animated (float / pop) via CSS so
// each 3:4 card has a little moving icon above its label.
// Per-style line-art glyph (SVG, no emoji) for the style cards.
function StyleGlyph({ value }: { value: string }) {
  const p = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (value) {
    case 'editorial': // camera
      return <svg {...p}><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>;
    case 'commercial': // megaphone (ad)
      return <svg {...p}><path d="M3 11l16-5v12L3 14z"/><path d="M11.5 16.5a3 3 0 1 1-5.7-1.6"/><line x1="21" y1="9" x2="21" y2="13"/></svg>;
    case 'lifestyle': // coffee cup
      return <svg {...p}><path d="M18 8h1a3 3 0 0 1 0 6h-1"/><path d="M3 8h15v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4z"/><line x1="7" y1="2" x2="7" y2="5"/><line x1="11" y1="2" x2="11" y2="5"/></svg>;
    case 'studio': // lightbulb
      return <svg {...p}><line x1="9" y1="18" x2="15" y2="18"/><line x1="10" y1="22" x2="14" y2="22"/><path d="M12 2a7 7 0 0 0-4 12.7c.6.4 1 1.1 1 1.8v.5h6v-.5c0-.7.4-1.4 1-1.8A7 7 0 0 0 12 2z"/></svg>;
    case 'athletic': // bolt
      return <svg {...p}><polyline points="13 2 4 14 11 14 10 22 20 9 13 9 13 2"/></svg>;
    case 'evening': // moon
      return <svg {...p}><path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/></svg>;
    case 'beach': // sun
      return <svg {...p}><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>;
    case 'cinematic': // film strip
      return <svg {...p}><rect x="2.5" y="3" width="19" height="18" rx="2"/><line x1="7" y1="3" x2="7" y2="21"/><line x1="17" y1="3" x2="17" y2="21"/><line x1="2.5" y1="12" x2="21.5" y2="12"/></svg>;
    case 'street':
    default: // walking person
      return <svg {...p}><circle cx="13" cy="4" r="2"/><path d="M13 22l-2-6-3-2 1-5 4 2 2 3"/><path d="M11 9l-3 1-2 4"/></svg>;
  }
}

export default function GeneratePage() {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [step, setStep] = useState<Step>(() => readStepFromUrl());

  // Admin impersonation: when /generate?as_user=<id> is set AND the
  // current session is an admin AND the target is an AI persona
  // (is_ai=true), every wizard write attaches to the persona, not the
  // admin. The RLS policies in 20260521020000 mirror this gate so a
  // forged query string can't bypass it server-side either.
  //
  // `impersonate` is the resolved target row when impersonation is
  // active, or null. `effectiveUserId` is what every downstream call
  // keys off — defaults to the signed-in user.
  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';
  const asUserParam = useMemo(() => {
    if (typeof window === 'undefined') return null;
    const v = new URLSearchParams(window.location.search).get('as_user');
    return v && UUID_RE.test(v) ? v : null;
  }, []);
  const [impersonate, setImpersonate] = useState<ImpersonationTarget | null>(null);
  const [impersonateError, setImpersonateError] = useState<string | null>(null);
  const impersonationRequested = !!asUserParam;
  useEffect(() => {
    if (!asUserParam) { setImpersonate(null); return; }
    if (!user?.id) return;
    if (!isAdmin) {
      setImpersonate(null);
      setImpersonateError('Only admins can run /generate as another user.');
      return;
    }
    let cancelled = false;
    getImpersonationTarget(asUserParam).then(t => {
      if (cancelled) return;
      if (!t) {
        setImpersonate(null);
        setImpersonateError('That user is not an AI persona — refusing to impersonate.');
        return;
      }
      setImpersonate(t);
      setImpersonateError(null);
    });
    return () => { cancelled = true; };
  }, [asUserParam, isAdmin, user?.id]);

  const effectiveUserId = impersonate?.id ?? user?.id ?? null;
  // True only once the impersonation handshake has resolved (or wasn't
  // requested at all). Used to gate every wizard side-effect so we
  // don't accidentally load the admin's own uploads/slots in the
  // window between mount and the profiles lookup landing.
  const effectiveUserReady = !impersonationRequested || impersonate?.id != null || !!impersonateError;
  // Branded confirm modal — drop-in replacement for window.confirm()
  // across the three destructive sites in this page (feedback delete,
  // saved-look delete, upload delete). Render `confirmHostModal` once
  // near the page root and call `await confirmAction(...)` anywhere a
  // yes/no decision is needed.
  const { confirm: confirmAction, modal: confirmHostModal } = useConfirm();

  // Two-way bind ?step= against the wizard's internal step. Pushing a
  // history entry on every step change means the browser back button
  // walks the user back through the flow (result → review → style →
  // about → products → photos) instead of leaving /generate entirely
  // on the first back press.
  //
  // popstate handles the back/forward direction — it reads the URL
  // and applies it. The applyingUrlRef guard prevents the push effect
  // below from echoing it as a forward entry on top of the one we
  // just walked back to.
  const applyingUrlRef = useRef(false);

  useEffect(() => {
    if (applyingUrlRef.current) {
      applyingUrlRef.current = false;
      return;
    }
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    const current = url.searchParams.get('step') ?? 'photos';
    if (current === step) return;
    if (step === 'photos') url.searchParams.delete('step');
    else                   url.searchParams.set('step', step);
    window.history.pushState({ step }, '', url.toString());
  }, [step]);

  useEffect(() => {
    const onPop = () => {
      const next = readStepFromUrl();
      setStep(prev => {
        if (prev === next) return prev;
        applyingUrlRef.current = true;
        return next;
      });
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // Photos - fixed 3-slot layout. `slots[i]` is either an upload id (filled)
  // or null (empty). We derive an ordered upload-id list from this for the
  // rest of the wizard + submit payload.
  const [existingUploads, setExistingUploads] = useState<UserUpload[]>([]);
  const [slots, setSlots] = useState<(string | null)[]>([null, null, null]);
  const [uploading, setUploading] = useState(false);
  // Per-slot upload state. `slot` survives the whole upload (a separate
  // ref was being cleared synchronously, so the old "Uploading…" label
  // never showed); `pct` is the byte-level progress reported by the XHR
  // upload.onprogress event.
  const [uploadProgress, setUploadProgress] = useState<{ slot: number; pct: number } | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  // Combined Fal/ByteDance photo pre-validation. We submit ALL filled
  // slots together because ByteDance's `partner_validation_failed`
  // safety filter only fires for multi-image submissions - single-image
  // checks always pass and miss the real failure mode. All filled slots
  // share the same state from the most recent combo check.
  //   idle → checking (edge function running) → ok | blocked
  const [slotChecks, setSlotChecks] = useState<('idle' | 'checking' | 'ok' | 'blocked')[]>(['idle', 'idle', 'idle']);
  // The reason returned by the last failing combo check, used to show a
  // human-readable banner. Only set when at least one slot is 'blocked'.
  const [photoCheckReason, setPhotoCheckReason] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const pickedUploadIds = useMemo(
    () => slots.filter((x): x is string => !!x),
    [slots],
  );

  // Combo photo pre-validation. Whenever the filled slot set changes,
  // debounce 600ms then submit ALL filled slots together to Fal. The
  // edge function polls until ByteDance's safety filter responds (~10s
  // for a rejection, 15s timeout for a likely-pass). Skip the check for
  // a single filled slot - single-image submissions almost always pass
  // and would just produce false-positive green checkmarks.
  const filledPublicUrls = useMemo(
    () => pickedUploadIds
      .map(id => existingUploads.find(u => u.id === id)?.public_url)
      .filter((u): u is string => !!u),
    [pickedUploadIds, existingUploads],
  );
  const filledKey = filledPublicUrls.join('|');
  useEffect(() => {
    if (!effectiveUserId || !effectiveUserReady) return;
    if (filledPublicUrls.length === 0) {
      setSlotChecks(['idle', 'idle', 'idle']);
      setPhotoCheckReason(null);
      return;
    }
    // Mark every filled slot as 'checking' immediately for visual feedback.
    setSlotChecks(prev => {
      const next = [...prev];
      slots.forEach((id, i) => { next[i] = id ? 'checking' : 'idle'; });
      return next;
    });
    setPhotoCheckReason(null);

    let cancelled = false;
    const timer = setTimeout(async () => {
      const result = await checkFacePhoto(filledPublicUrls, effectiveUserId);
      if (cancelled) return;
      setSlotChecks(prev => {
        const next = [...prev];
        slots.forEach((id, i) => {
          next[i] = id ? (result.ok ? 'ok' : 'blocked') : 'idle';
        });
        return next;
      });
      setPhotoCheckReason(result.ok ? null : (result.reason ?? 'blocked'));
    }, 600);
    return () => { cancelled = true; clearTimeout(timer); };
    // We deliberately key off filledKey + slot count so we don't re-run
    // when the user just reorders existingUploads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filledKey, effectiveUserId, effectiveUserReady]);

  // Past generations - rendered in phase 7 as the "Your looks" grid. We poll
  // pending/generating rows here so the grid promotes itself to done/failed
  // without a page refresh.
  const [generations, setGenerations] = useState<UserGeneration[]>([]);
  const [loadingList, setLoadingList] = useState(false);

  // Count of consecutive failed generations at the head of the list.
  // The streak resets the moment we hit a 'done'. Used to gate the
  // "These photos may be rejected" warning so it only fires after the
  // user's actually hit the wall three times in a row, not on the
  // first photo-check blip.
  const consecutiveFailures = useMemo(() => {
    let count = 0;
    for (const g of generations) {
      if (g.status === 'failed') count++;
      else if (g.status === 'done') break;
      // pending/generating rows are still in-flight - skip without
      // counting or breaking the streak.
    }
    return count;
  }, [generations]);

  // Phase 8 - products
  const [productQuery, setProductQuery] = useState('');
  const [productResults, setProductResults] = useState<PickedProduct[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);
  // Per-category client-side search. Each row in the new horizontal-
  // scroll picker has its own input that filters that row's products
  // by name/brand without re-fetching from Supabase.
  const [categoryQueries, setCategoryQueries] = useState<Record<string, string>>({});
  const setCategoryQuery = useCallback((label: string, value: string) => {
    setCategoryQueries(prev => (prev[label] === value ? prev : { ...prev, [label]: value }));
  }, []);

  // Per-category brand filter. Null = no filter active. Selecting a
  // brand chip narrows the row to just that brand's products; tapping
  // the active chip again clears it.
  const [categoryBrandFilters, setCategoryBrandFilters] = useState<Record<string, string | null>>({});
  const setCategoryBrand = useCallback((label: string, brand: string | null) => {
    setCategoryBrandFilters(prev => ({ ...prev, [label]: brand }));
  }, []);

  // Per-category collapse. Categories default to COLLAPSED — the picker
  // opens compact and the user expands the rows they care about (a typed
  // search auto-expands its row).
  const [expandedCats, setExpandedCats] = useState<Record<string, boolean>>({});
  const toggleCat = useCallback((label: string) => {
    setExpandedCats(prev => ({ ...prev, [label]: !prev[label] }));
  }, []);

  // Slice productResults into the 6 display buckets. Each bucket also
  // applies its own per-row search query (name/brand contains) AND its
  // active brand-chip filter. Memoized so re-renders that don't change
  // inputs skip the work entirely.
  const productsByCategory = useMemo(() => {
    const out: Record<string, PickedProduct[]> = {};
    for (const group of PICKER_GROUPS) {
      const q = (categoryQueries[group.label] || '').trim().toLowerCase();
      const brand = categoryBrandFilters[group.label] || null;
      out[group.label] = productResults.filter(p => {
        if (!productInCategory(p, group)) return false;
        if (brand && (p.brand || '').toLowerCase() !== brand.toLowerCase()) return false;
        if (!q) return true;
        const name = (p.name || '').toLowerCase();
        const pBrand = (p.brand || '').toLowerCase();
        return name.includes(q) || pBrand.includes(q);
      });
    }
    return out;
  }, [productResults, categoryQueries, categoryBrandFilters]);

  // Unified product field — one floating cloud of ALL products with a single
  // search + category chips (replaces the per-category rows).
  const [cloudQuery, setCloudQuery] = useState('');
  const [cloudCat, setCloudCat] = useState<string | null>(null);
  const [cloudBrand, setCloudBrand] = useState<string | null>(null);

  // Grid-density dial for the product picker — mirrors the creator catalog's
  // wheel: cycles the grid between 2 / 3 / 4 columns on mobile. Scroll/drag to
  // change, tap to cycle; persisted across sessions. Default = 3 columns.
  const PICK_COLS = [2, 3, 4] as const;
  const [pickColsIndex, setPickColsIndex] = useState<number>(() => {
    try {
      const v = Number(window.localStorage.getItem('catalog:gen-grid-cols'));
      const i = PICK_COLS.indexOf(v as 2 | 3 | 4);
      return i >= 0 ? i : 1;
    } catch { return 1; }
  });
  const pickCols = PICK_COLS[pickColsIndex];
  useEffect(() => {
    try { window.localStorage.setItem('catalog:gen-grid-cols', String(pickCols)); } catch { /* quota */ }
  }, [pickCols]);
  const pickDialRef = useRef<HTMLDivElement | null>(null);
  const pickDialDraggedRef = useRef(false);
  const [pickDialHidden, setPickDialHidden] = useState(false);
  const cyclePickCols = useCallback(() => {
    if (pickDialDraggedRef.current) { pickDialDraggedRef.current = false; return; }
    setPickColsIndex(i => (i + 1) % PICK_COLS.length);
  }, []);
  // Auto-hide on scroll-down / reveal on scroll-up — .gen-page is the scroller.
  useEffect(() => {
    if (step !== 'products') return;
    const el = document.querySelector('.gen-page') as HTMLElement | null;
    if (!el) return;
    let last = el.scrollTop;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const y = el.scrollTop;
        if (y < 40) { setPickDialHidden(false); last = y; return; }
        if (y - last > 8) { setPickDialHidden(true); last = y; }
        else if (last - y > 8) { setPickDialHidden(false); last = y; }
      });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => { cancelAnimationFrame(raf); el.removeEventListener('scroll', onScroll); };
  }, [step]);
  // Wheel + vertical-drag stepping (non-passive so the dial doesn't scroll the page).
  useEffect(() => {
    const el = pickDialRef.current;
    if (!el) return;
    const clamp = (i: number) => Math.min(PICK_COLS.length - 1, Math.max(0, i));
    let accum = 0;
    let touchY: number | null = null;
    const onWheel = (e: WheelEvent) => { e.preventDefault(); accum += e.deltaY; if (Math.abs(accum) > 22) { setPickColsIndex(i => clamp(i + (accum > 0 ? 1 : -1))); accum = 0; } };
    const onTouchStart = (e: TouchEvent) => { touchY = e.touches[0].clientY; pickDialDraggedRef.current = false; };
    const onTouchMove = (e: TouchEvent) => {
      if (touchY == null) return;
      e.preventDefault();
      const dy = e.touches[0].clientY - touchY;
      if (Math.abs(dy) > 24) { setPickColsIndex(i => clamp(i + (dy > 0 ? 1 : -1))); touchY = e.touches[0].clientY; pickDialDraggedRef.current = true; }
    };
    const onTouchEnd = () => { touchY = null; };
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
    };
  }, [step]);
  // Products in the active category (before brand/query filters) — drives both
  // the brand chips and the final list.
  const cloudInCat = useMemo(() => {
    const grp = cloudCat ? CATEGORY_GROUPS.find(g => g.label === cloudCat) : null;
    return grp ? productResults.filter(p => productInCategory(p, grp)) : productResults;
  }, [productResults, cloudCat]);
  // Top brands within the active category, for the brand chip row under types.
  const cloudBrands = useMemo(() => {
    const tally = new Map<string, number>();
    for (const p of cloudInCat) {
      const b = (p.brand || '').trim();
      if (b) tally.set(b, (tally.get(b) || 0) + 1);
    }
    return [...tally.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]).slice(0, 12);
  }, [cloudInCat]);
  // Final, filtered product list for the unified field.
  const cloudProducts = useMemo(() => {
    const q = cloudQuery.trim().toLowerCase();
    return cloudInCat.filter(p => {
      if (cloudBrand && (p.brand || '').toLowerCase() !== cloudBrand.toLowerCase()) return false;
      if (!q) return true;
      return (p.name || '').toLowerCase().includes(q) || (p.brand || '').toLowerCase().includes(q);
    });
  }, [cloudInCat, cloudQuery, cloudBrand]);

  // Top brands available within each category (pre-filter). We pull
  // them from the unfiltered productResults so flipping a chip doesn't
  // change which chips are visible.
  const brandsByCategory = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const group of PICKER_GROUPS) {
      const tally = new Map<string, number>();
      for (const p of productResults) {
        if (!productInCategory(p, group)) continue;
        const b = (p.brand || '').trim();
        if (!b) continue;
        tally.set(b, (tally.get(b) || 0) + 1);
      }
      out[group.label] = [...tally.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([b]) => b);
    }
    return out;
  }, [productResults]);
  const [picked, setPicked] = useState<PickedProduct[]>([]);
  // Build transition: when leaving the pick step, the picked products fly
  // forward into the next screen (the "build order"). null = idle.
  const [launching, setLaunching] = useState(false);
  const launchToNext = useCallback(() => {
    if (picked.length === 0) { goNext('products', setStep); return; }
    setLaunching(true);
    window.setTimeout(() => { setLaunching(false); goNext('products', setStep); }, 720);
  }, [picked.length]);

  // Pre-pick a product when the user lands here from a Product page's
  // "Try it on" button (?product_url=…). One-shot — once we hydrate we
  // strip the param off the URL so a refresh doesn't re-add a row the
  // user may have just removed. Matches against products.url since the
  // consumer Product type has no id.
  //
  // Style → Shop this look → Try it on also lands here with an
  // additional `?occasion=…` param. We capture it into state and feed
  // it into the prompt builder at submit time so the resulting look
  // reads "for {occasion}" alongside the picked products.
  const productUrlPrefilled = useRef(false);
  const [prefilledProductId, setPrefilledProductId] = useState<string | null>(null);
  const [occasionHint, setOccasionHint] = useState<string>('');
  // The user's saved "your style" descriptor (Style page). Threaded into
  // the Seedance prompt so generations reflect their personal aesthetic.
  const [customStyle, setCustomStyle] = useState<string>('');
  // Resume a render by id — the activity "Your looks" rail links a still-
  // rendering tile to /generate?gen=<id> so the creator lands straight on
  // its progress screen (the result step polls it to completion).
  const genResumeRef = useRef(false);
  useEffect(() => {
    if (genResumeRef.current) return;
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    const genId = url.searchParams.get('gen');
    genResumeRef.current = true;
    if (!genId) return;
    url.searchParams.delete('gen');
    window.history.replaceState({}, '', url.toString());
    let cancelled = false;
    (async () => {
      const g = await getGeneration(genId);
      if (cancelled || !g) return;
      setGeneration(g);
      setStep('result');
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (productUrlPrefilled.current) return;
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    const productUrl = url.searchParams.get('product_url');
    const occasionParam = url.searchParams.get('occasion');
    if (occasionParam) {
      setOccasionHint(occasionParam);
      url.searchParams.delete('occasion');
      window.history.replaceState({}, '', url.toString());
    }
    if (!productUrl) { productUrlPrefilled.current = true; return; }
    productUrlPrefilled.current = true;

    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('products')
        .select('id, name, brand, price, image_url')
        .eq('url', productUrl)
        .maybeSingle();
      if (cancelled || !data) return;
      const row = data as { id: string; name: string | null; brand: string | null; price: string | null; image_url: string | null };
      setPicked(prev => prev.some(p => p.id === row.id) ? prev : [
        { id: row.id, name: row.name, brand: row.brand, price: row.price, image_url: row.image_url, role_tag: roleTagFromName(row.name) },
        ...prev,
      ]);
      // Surface the prefilled product as the centerpiece — the dock
      // chip gets scrolled into the viewport center and a brief
      // highlight ring fires so it's unmistakable that this is the
      // product the user came here to try on.
      setPrefilledProductId(row.id);
      // Strip the param off so a hard reload doesn't re-prefill.
      url.searchParams.delete('product_url');
      window.history.replaceState({}, '', url.toString());
    })();
    return () => { cancelled = true; };
  }, []);

  // Center + highlight effect for the prefilled product. Runs after the
  // dock chip mounts; clears the highlight after the pulse animation
  // (~2s) so it doesn't linger as the user keeps interacting.
  useEffect(() => {
    if (!prefilledProductId) return;
    if (typeof window === 'undefined') return;
    const tries = [0, 80, 240, 600]; // retry until the chip is mounted
    const timers: number[] = [];
    let scrolled = false;
    tries.forEach(delay => {
      timers.push(window.setTimeout(() => {
        if (scrolled) return;
        const el = document.querySelector<HTMLElement>(
          `[data-prefilled-id="${prefilledProductId}"]`,
        );
        if (el) {
          scrolled = true;
          el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
        }
      }, delay));
    });
    const clear = window.setTimeout(() => setPrefilledProductId(null), 2400);
    return () => { timers.forEach(clearTimeout); clearTimeout(clear); };
  }, [prefilledProductId]);

  // Phase 9/10 - height + style
  const [heightCm, setHeightCm] = useState<number>(178);  // 5'10" default
  const [heightLabel, setHeightLabel] = useState<string>("5'10\"");
  const [weightKg, setWeightKg] = useState<number | null>(null);
  const [weightLabel, setWeightLabel] = useState<string | null>(null);
  const [ageLabel, setAgeLabel] = useState<string>('mid 20s');
  // Stats editor visibility (shared StatsEditorModal). The chips
  // render next to the "You" title so the user can adjust height /
  // age / gender without leaving the wizard.
  const [editingStats, setEditingStats] = useState(false);
  const [style, setStyle] = useState<string>('street');
  // Output clip length. Seedance 2 /fast is 5s only; Pro can do 5
  // or 10. Default 5 for Fast; the model picker bumps it to 10 when
  // Pro is selected (and the user can knock it back to 5 if they
  // want).
  const [clipSeconds, setClipSeconds] = useState<5 | 10>(10);
  // Seedance 2 variant. 'fast' is fast + cheap + 5s only. 'pro' is
  // longer + higher quality when Fal exposes it; the edge function
  // falls back to /fast if the Pro slug 404s.
  // Default to the premium path: Pro model, 10-second clip. The review
  // screen still exposes the Fast / 5s toggles, but every new look starts
  // as Pro+10s per the product default.
  const [model, setModel] = useState<'fast' | 'pro'>('pro');
  // Shopper's gender, used to filter the product picker so a male
  // shopper only sees male + unisex (+ untagged) products. 'unknown'
  // disables the filter so we don't hide the catalog from anyone we
  // can't tag.
  const [userGender, setUserGender] = useState<UserGender>('unknown');
  useEffect(() => {
    if (!effectiveUserId || !effectiveUserReady) { setUserGender('unknown'); return; }
    getUserGender(effectiveUserId).then(setUserGender);
  }, [effectiveUserId, effectiveUserReady]);

  // Prefill height + age from the user's profile so they don't have
  // to re-enter on every wizard open. Set a flag once the prefill has
  // landed so the persist-on-change effect below doesn't write the
  // initial defaults back over the saved values during hydration.
  const heightAgeHydrated = useRef(false);
  useEffect(() => {
    heightAgeHydrated.current = false;
    if (!effectiveUserId || !effectiveUserReady) { heightAgeHydrated.current = true; return; }
    let cancelled = false;
    getUserHeightAge(effectiveUserId).then(saved => {
      if (cancelled) return;
      if (saved.heightCm)    setHeightCm(saved.heightCm);
      if (saved.heightLabel) setHeightLabel(saved.heightLabel);
      if (saved.weightKg != null) setWeightKg(saved.weightKg);
      if (saved.weightLabel) setWeightLabel(saved.weightLabel);
      if (saved.ageLabel)    setAgeLabel(saved.ageLabel);
      heightAgeHydrated.current = true;
    });
    getUserCustomStyle(effectiveUserId).then(s => { if (!cancelled && s) setCustomStyle(s); });
    return () => { cancelled = true; };
  }, [effectiveUserId, effectiveUserReady]);

  // Persist height + age on change. Debounced so dragging the height
  // slider doesn't fire one PATCH per cm. The hydrated guard prevents
  // writing the local defaults back over the user's saved values
  // before the prefill has landed.
  useEffect(() => {
    if (!effectiveUserId || !heightAgeHydrated.current) return;
    const handle = window.setTimeout(() => {
      updateUserHeightAge(effectiveUserId, { heightCm, heightLabel, weightKg, weightLabel, ageLabel }).catch(() => {});
    }, 600);
    return () => window.clearTimeout(handle);
  }, [effectiveUserId, heightCm, heightLabel, weightKg, weightLabel, ageLabel]);

  // Phase 12 - submit + poll
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Shown on the photos step when the user's last look failed, so they know
  // to retry rather than being dumped directly on the error result frame.
  const [failedLastLookBanner, setFailedLastLookBanner] = useState<string | null>(null);
  const [generation, setGeneration] = useState<UserGeneration | null>(null);
  // Products + reference uploads tied to the currently-viewed generation.
  // Hydrated whenever we land on the result step so the look surfaces the
  // outfit it was built from (not just the video).
  const [resultProducts, setResultProducts] = useState<GenerationProductDetail[]>([]);
  const [resultRefs, setResultRefs] = useState<UserUpload[]>([]);
  useEffect(() => {
    if (step !== 'result' || !generation?.id) {
      setResultProducts([]); setResultRefs([]); return;
    }
    let cancelled = false;
    getGenerationDetail(generation.id).then(d => {
      if (cancelled) return;
      setResultProducts(sortProductsHeadToToe(d.products));
      setResultRefs(d.uploads);
    });
    return () => { cancelled = true; };
  }, [generation?.id, step]);

  // Images that orbit on the "Vision composes…" screen: the shopper's face
  // photos + their chosen products. Prefer the data fetched for the
  // generation being viewed (resultRefs / resultProducts); fall back to the
  // in-session picks (slots + picked) for a just-submitted look.
  const orbitImages = useMemo(() => {
    const facesFromRefs = resultRefs.map(u => u.public_url).filter((u): u is string => !!u);
    const facesFromSlots = slots
      .map(id => existingUploads.find(u => u.id === id)?.public_url)
      .filter((u): u is string => !!u);
    const faces = facesFromRefs.length ? facesFromRefs : facesFromSlots;
    const prodFromResult = resultProducts
      .map(p => p.product?.image_url)
      .filter((u): u is string => !!u);
    const prodFromPicked = picked.map(p => p.image_url).filter((u): u is string => !!u);
    const prods = prodFromResult.length ? prodFromResult : prodFromPicked;
    return [...faces, ...prods];
  }, [resultRefs, slots, existingUploads, resultProducts, picked]);

  // Load the user's existing uploads once we know who they are, so the
  // dropzone can offer "use a face you already uploaded" instead of
  // forcing a re-upload on every session. We also fetch the saved
  // slot picks from Supabase in parallel so the shopper's previously-
  // chosen reference photos roam across devices (filtered against
  // what still exists, in case any were deleted).
  const slotsHydrated = useRef(false);
  useEffect(() => {
    slotsHydrated.current = false;
    if (!effectiveUserId || !effectiveUserReady) return;
    let cancelled = false;
    Promise.all([
      listUserUploads(effectiveUserId),
      getUserSlots(effectiveUserId, MAX_PHOTOS),
    ]).then(([uploads, savedSlots]) => {
      if (cancelled) return;
      setExistingUploads(uploads);
      const known = new Set(uploads.map(u => u.id));
      const restored: (string | null)[] = [null, null, null];
      savedSlots.slice(0, MAX_PHOTOS).forEach((id, i) => {
        if (typeof id === 'string' && known.has(id)) restored[i] = id;
      });
      // Admin-impersonation convenience: when no saved slots exist on
      // the persona but reference photos do, auto-pick the most recent
      // uploads so the admin doesn't have to drag them in by hand
      // every time. Only fires when ALL slots are empty so we never
      // overwrite a deliberate pick during a re-hydrate; the
      // persist-on-change effect below saves the choice back so it
      // sticks for the next session.
      const noSavedPicks = restored.every(id => id === null);
      if (impersonate && noSavedPicks && uploads.length > 0) {
        uploads.slice(0, MAX_PHOTOS).forEach((u, i) => {
          (restored as Array<string | null>)[i] = u.id;
        });
      }
      setSlots(restored);
      slotsHydrated.current = true;
    });
    return () => { cancelled = true; };
  }, [effectiveUserId, effectiveUserReady, impersonate?.id]);

  // Persist slot changes back to Supabase so they survive across
  // sessions and devices. Skipped until after the initial hydrate so
  // we don't overwrite the saved row with the empty `[null,null,null]`
  // default before we've had a chance to read it.
  useEffect(() => {
    if (!effectiveUserId || !slotsHydrated.current) return;
    saveUserSlots(effectiveUserId, slots);
  }, [effectiveUserId, slots]);

  // Initial load of past generations - Phase 7 renders them as cards.
  useEffect(() => {
    if (!effectiveUserId || !effectiveUserReady) return;
    let cancelled = false;
    setLoadingList(true);
    listUserGenerations(effectiveUserId).then(rows => {
      if (cancelled) return;
      setGenerations(rows);
      setLoadingList(false);
      // Phase B step 5: if the most-recent generation failed, stay on photos
      // and show a dismissible banner rather than auto-landing on the error result.
      const latest = rows[0];
      if (latest?.status === 'failed') {
        setFailedLastLookBanner('Your last look failed - let\'s try again.');
        // step starts at 'photos' already, so no setStep needed.
      }
    });
    return () => { cancelled = true; };
  }, [effectiveUserId, effectiveUserReady]);

  // Poll in-flight list rows every 3s so the grid promotes pending/generating
  // rows as soon as the edge function finishes.
  useEffect(() => {
    const inFlightIds = generations
      .filter(g => g.status === 'pending' || g.status === 'generating')
      .map(g => g.id);
    if (inFlightIds.length === 0) return;
    const handle = window.setInterval(async () => {
      const updates = await Promise.all(inFlightIds.map(id => getGeneration(id)));
      setGenerations(prev => prev.map(g => {
        const fresh = updates.find(u => u?.id === g.id);
        return fresh ?? g;
      }));
    }, 3000);
    return () => window.clearInterval(handle);
  }, [generations]);

  // Phase 8 - search products in the library. Pulls the same active
  // product set the consumer feed uses.
  useEffect(() => {
    if (step !== 'products' || !supabase) return;
    let cancelled = false;
    setProductsLoading(true);
    const q = productQuery.trim();
    const run = async () => {
      // Show every product the catalog has, not just the ones live on
      // the consumer feed -- the shopper picking products for their
      // own generation should see the same set the admin sees in
      // /admin/content -> Products. Image is still required since the
      // generation pipeline needs a visual reference per product.
      let query = supabase!
        .from('products')
        .select('id, name, brand, price, image_url, primary_image_url, primary_video_url, primary_video_poster_url')
        .not('image_url', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1000);
      // Gender filter: a male shopper only sees male + unisex; a
      // female shopper only sees female + unisex. 'unknown' disables
      // the filter so we never hide the catalog from someone whose
      // gender we can't tag. Untagged (gender is null) products are
      // explicitly excluded for tagged users — the user's preference
      // is "only show products for that user's gender + unisex," so
      // untagged rows need a gender backfill before they show up.
      // Use the audit button on /admin/content to backfill.
      if (userGender === 'male') {
        query = query.or('gender.eq.male,gender.eq.unisex');
      } else if (userGender === 'female') {
        query = query.or('gender.eq.female,gender.eq.unisex');
      }
      if (q) query = query.or(`name.ilike.%${q}%,brand.ilike.%${q}%`);
      const { data } = await query;
      if (cancelled) return;
      const mapped = ((data || []) as PickedProduct[]).map(p => ({
        ...p,
        role_tag: roleTagFromName(p.name),
      }));
      // Dresses are women-only: never surface them to a male creator, even
      // when the row's gender tag is unisex / untagged.
      setProductResults(
        userGender === 'male' ? mapped.filter(p => p.role_tag !== 'Dress') : mapped,
      );
      setProductsLoading(false);
    };
    const handle = window.setTimeout(run, 180);
    return () => { cancelled = true; window.clearTimeout(handle); };
  }, [step, productQuery, userGender]);

  // Phase 17 - poll the generation row every 2.5s until it lands on a
  // terminal status, so the Result view replaces the spinner as soon
  // as the edge function finishes.
  //
  // Keyed off `generation?.id` only (not the whole `generation`
  // object) so we don't tear down and rebuild the interval on every
  // poll tick — the previous shape did, which left a ~2.5s gap each
  // time the row updated and made the perceived "stuck at 99%" window
  // longer than it had to be. We also kick a one-shot refetch when
  // the tab becomes visible again, in case the browser throttled the
  // interval while the page was backgrounded.
  const generationIdForPoll = generation?.id ?? null;
  const generationIsTerminal = generation?.status === 'done' || generation?.status === 'failed';

  // Auto-add every completed generation to the creator's My Catalog as an
  // INACTIVE look. Idempotent (promoteGenerationToLook keys off
  // source_generation_id and leaves an existing row's status alone), fires
  // once per generation id. The creator flips it Live from My Catalog.
  const autoArchivedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const g = generation;
    if (!g || g.status !== 'done' || !g.video_url || !effectiveUserId) return;
    if (autoArchivedRef.current.has(g.id)) return;
    autoArchivedRef.current.add(g.id);
    const gender: 'men' | 'women' | 'unisex' =
      userGender === 'male' ? 'men' : userGender === 'female' ? 'women' : 'unisex';
    promoteGenerationToLook({
      generationId: g.id,
      creatorUserId: effectiveUserId,
      videoUrl: g.video_url,
      creatorLabel: g.display_name || 'You',
      style: g.style || 'look',
      gender,
      status: 'archived',
      products: picked.map(p => ({ id: p.id })),
    }).catch(() => { autoArchivedRef.current.delete(g.id); });
  }, [generation, effectiveUserId, userGender, picked]);
  useEffect(() => {
    if (!generationIdForPoll || generationIsTerminal) return;
    let cancelled = false;
    const tick = async () => {
      const next = await getGeneration(generationIdForPoll);
      if (cancelled || !next) return;
      setGeneration(next);
    };
    const intervalId = window.setInterval(tick, 2500);
    const onVisible = () => { if (document.visibilityState === 'visible') void tick(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [generationIdForPoll, generationIsTerminal]);

  // Surface the in-flight try-on render in the global Generation Queue
  // (bottom-right panel) so it shows alongside admin jobs. We mirror the
  // poll's lifecycle: open a queue job when a generation goes in-flight,
  // finish/fail it when it reaches a terminal status. Keyed off id+status
  // so it fires exactly on the transitions.
  const queueJobRef = useRef<{ genId: string; finish: (ms?: number, msg?: string) => void; fail: (msg?: string) => void } | null>(null);
  useEffect(() => {
    if (!generation) return;
    const st = generation.status;
    const inFlight = st === 'pending' || st === 'generating';
    if (inFlight && queueJobRef.current?.genId !== generation.id) {
      queueJobRef.current?.finish(); // close any stale one
      const job = startGenerationJob({
        kind: 'primary-video',
        label: generation.display_name || 'Your look',
        context: STYLE_PRESETS.find(s => s.value === style)?.label || 'Try-on',
        model: model === 'pro' ? 'Seedance 2 Pro' : 'Seedance 2 Fast',
        thumbnailUrl: existingUploads.find(u => u.id === pickedUploadIds[0])?.public_url ?? null,
      });
      queueJobRef.current = { genId: generation.id, finish: job.finish, fail: job.fail };
    } else if ((st === 'done' || st === 'failed') && queueJobRef.current?.genId === generation.id) {
      if (st === 'done') queueJobRef.current.finish(undefined, 'Done');
      else queueJobRef.current.fail(generation.error || 'Failed');
      queueJobRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generation?.id, generation?.status]);

  // Generating view = the in-flight result screen. The design wants it to
  // read as one focused moment: header says "Generating" and the whole
  // screen is pinned to a single mobile viewport with no page scroll.
  const isGeneratingView = step === 'result'
    && (generation?.status === 'pending' || generation?.status === 'generating');
  // The Review step is also pinned to a single viewport (no page scroll) —
  // the selected products live in the bottom dock, so the body stays short.
  const lockOneViewport = isGeneratingView || step === 'review';
  useEffect(() => {
    if (!lockOneViewport) return;
    const prevBody = document.body.style.overflow;
    const prevHtml = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevBody;
      document.documentElement.style.overflow = prevHtml;
    };
  }, [lockOneViewport]);

  // Tapping an existing upload toggles its membership in the slots - drops
  // it into the first empty slot, or removes it if it's already placed.
  const onPickExistingUpload = (id: string) => {
    setSlots(prev => {
      const idx = prev.indexOf(id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = null;
        return next;
      }
      const empty = prev.indexOf(null);
      if (empty < 0) return prev;
      const next = [...prev];
      next[empty] = id;
      return next;
    });
  };

  // Place a specific upload into a specific slot - used by the picker
  // modal so the choice always lands in the slot the user tapped, even
  // if it was already filled.
  const placeUploadInSlot = (slotIndex: number, uploadId: string) => {
    setSlots(prev => {
      const next = [...prev];
      // If this upload is already in another slot, vacate it so we
      // never end up with the same id in two slots at once.
      const existing = next.indexOf(uploadId);
      if (existing >= 0 && existing !== slotIndex) next[existing] = null;
      next[slotIndex] = uploadId;
      return next;
    });
  };

  const removeUpload = async (upload: UserUpload) => {
    setExistingUploads(prev => prev.filter(u => u.id !== upload.id));
    setSlots(prev => prev.map(id => id === upload.id ? null : id));
    const { error } = await deleteUserUpload(upload);
    if (error) setUploadError(error);
  };

  // useCallback so the LookCard rows (memo'd) don't re-render on every
  // parent re-render (e.g. typing into the prompt field). Both setState
  // refs and the deleteUserGeneration module function are stable, so
  // empty deps are safe.
  const removeGeneration = useCallback(async (id: string) => {
    setGenerations(prev => prev.filter(g => g.id !== id));
    await deleteUserGeneration(id);
  }, []);

  // Which slot the next file-picker upload should land in. Tracked via a
  // ref so onFileInput can target a specific slot when the user taps an
  // empty frame, rather than always filling the first empty one.
  const pendingSlotRef = useRef<number | null>(null);

  // Slot the upload-picker modal is currently choosing for. `null` =
  // closed. When non-null, clicking a thumbnail in the modal places it
  // into this slot (instead of the first empty slot).
  const [pickerSlot, setPickerSlot] = useState<number | null>(null);

  // Crop tool - modal state. Lives on the result step; opens when the
  // user taps the Crop button. Saving writes back through
  // updateGenerationCrop() and the in-memory generation gets updated
  // optimistically so the result video re-renders with the new crop
  // immediately.
  const [cropOpen, setCropOpen] = useState(false);
  // Export-share state. exportShare holds the look_shares row once
  // the share-look edge fn has minted it; we then poll until the
  // Modal worker fills in watermarked_video_url.
  const [exportOpen, setExportOpen] = useState(false);
  const [exportShare, setExportShare] = useState<LookShare | null>(null);
  const [exportSlug, setExportSlug] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportSubmitting, setExportSubmitting] = useState(false);
  // "How did I do?" feedback bar state. After generation completes the
  // user picks one of three answers (love / off / delete). 'love'
  // expands inline to keep-private vs publish-to-catalog; 'off'
  // expands to a free-text reason; 'delete' fires a confirm + hard-
  // delete. feedbackBusy guards double-click during the round-trip.
  const [feedbackKind, setFeedbackKind] = useState<'love' | 'off' | null>(null);
  const [feedbackReason, setFeedbackReason] = useState('');
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const [feedbackDone, setFeedbackDone] = useState<'kept' | 'published' | 'reported' | null>(null);
  // Reset feedback state whenever the active generation changes so the
  // bar doesn't show stale "Published!" UI on a fresh generation.
  useEffect(() => {
    setFeedbackKind(null);
    setFeedbackReason('');
    setFeedbackBusy(false);
    setFeedbackDone(null);
  }, [generation?.id]);

  const openPickerForSlot = (slotIndex: number) => {
    // If the user has any existing uploads, prefer the modal so they can
    // pick from history (and delete) rather than re-uploading. Empty
    // history → straight to the file picker.
    if (existingUploads.length > 0) {
      setPickerSlot(slotIndex);
      return;
    }
    pendingSlotRef.current = slotIndex;
    fileInputRef.current?.click();
  };

  const openFileChooserFromModal = () => {
    pendingSlotRef.current = pickerSlot;
    setPickerSlot(null);
    fileInputRef.current?.click();
  };

  const clearSlot = (slotIndex: number) => {
    setSlots(prev => {
      const next = [...prev];
      next[slotIndex] = null;
      return next;
    });
    setSlotChecks(prev => {
      const next = [...prev];
      next[slotIndex] = 'idle';
      return next;
    });
  };

  // Slots currently rendering a "drag is hovering me" outline. We
  // track them as a Set since multiple drag events fire across nested
  // children, and using counter math gets ugly.
  const [dragSlots, setDragSlots] = useState<Set<number>>(new Set());

  // Shared core upload pipeline - used by both the file picker
  // (`onFileInput`) and the slot drop handler. `targetSlot` is the
  // slot the upload should land in; pass `null` to fall back to the
  // first empty slot.
  const uploadFileIntoSlot = async (file: File, targetSlot: number | null) => {
    if (!effectiveUserId) return;
    setUploading(true);
    setUploadError(null);
    const slotForProgress = targetSlot != null && targetSlot >= 0 && targetSlot < MAX_PHOTOS
      ? targetSlot
      : slots.indexOf(null);
    if (slotForProgress >= 0) setUploadProgress({ slot: slotForProgress, pct: 0 });

    // Fal/Seedance partner-validates every reference image and rejects
    // anything outside plain 8-bit sRGB JPEG/PNG. Three failure modes we
    // saw in practice: iPhone HEIC (Bytedance can't decode it), iPhone
    // HDR screenshots saved as 16-bit-per-channel PNG, and iPhone
    // screenshots in 9:19.5 aspect ratio that fall outside Seedance's
    // accepted input window. All three kill the job with 422
    // partner_validation_failed.
    //
    // Solution: pipe every upload through createImageBitmap → canvas →
    // toBlob('image/jpeg'). HEIC gets pre-decoded with heic2any (lazy-
    // loaded). The canvas pass normalizes bit depth + color profile +
    // EXIF rotation + alpha channel, center-crops to 9:16 to match the
    // generation aspect ratio, and caps long-edge at 1920 px. Output is
    // always a standard sRGB 8-bit baseline JPEG.
    const nameLower = file.name.toLowerCase();
    const isHeic = file.type === 'image/heic'
      || file.type === 'image/heif'
      || nameLower.endsWith('.heic')
      || nameLower.endsWith('.heif');
    let fileToUpload: File;
    try {
      let source: Blob = file;
      if (isHeic) {
        const { default: heic2any } = await import('heic2any');
        const converted = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.92 });
        source = Array.isArray(converted) ? converted[0] : converted;
      }
      const bitmap = await createImageBitmap(source, { imageOrientation: 'from-image' });
      try {
        // Center-crop to 9:16 portrait. iPhone screenshots come in at
        // 9:19.5 which sometimes trips Seedance's input validator.
        const TARGET_W = 9;
        const TARGET_H = 16;
        const targetRatio = TARGET_W / TARGET_H;
        const srcRatio = bitmap.width / bitmap.height;
        let cropX = 0, cropY = 0, cropW = bitmap.width, cropH = bitmap.height;
        if (srcRatio > targetRatio) {
          cropW = Math.round(bitmap.height * targetRatio);
          cropX = Math.round((bitmap.width - cropW) / 2);
        } else if (srcRatio < targetRatio) {
          cropH = Math.round(bitmap.width / targetRatio);
          cropY = Math.round((bitmap.height - cropH) / 2);
        }
        // Cap the long edge at 1920 px so the JPEG stays under Fal's
        // 30 MB ceiling and Bytedance's input-resolution limits.
        const MAX_EDGE = 1920;
        let outW = cropW;
        let outH = cropH;
        const longEdge = Math.max(outW, outH);
        if (longEdge > MAX_EDGE) {
          const scale = MAX_EDGE / longEdge;
          outW = Math.round(outW * scale);
          outH = Math.round(outH * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = outW;
        canvas.height = outH;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas 2D context unavailable');
        // Flatten any alpha channel onto white so transparent PNGs don't
        // produce a JPEG with black artifacts.
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, outW, outH);
        ctx.drawImage(bitmap, cropX, cropY, cropW, cropH, 0, 0, outW, outH);
        const blob = await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/jpeg', 0.92);
        });
        const baseName = file.name.replace(/\.[^.]+$/, '') || 'photo';
        fileToUpload = new File([blob], `${baseName}.jpg`, { type: 'image/jpeg' });
      } finally {
        bitmap.close();
      }
    } catch (err) {
      setUploading(false);
      setUploadProgress(null);
      setUploadError(err instanceof Error ? `Couldn’t process photo: ${err.message}` : 'Couldn’t process this photo. Please try a different one.');
      return;
    }

    const { data, error } = await uploadUserPhoto(fileToUpload, effectiveUserId, (pct) => {
      setUploadProgress(prev => prev?.slot === slotForProgress
        ? { slot: slotForProgress, pct }
        : prev);
    });
    setUploading(false);
    setUploadProgress(null);
    if (error) { setUploadError(error); return; }
    if (!data) return;

    setExistingUploads(prev => [data, ...prev]);
    setSlots(prev => {
      const next = [...prev];
      const idx = targetSlot != null && targetSlot >= 0 && targetSlot < MAX_PHOTOS
        ? targetSlot
        : next.indexOf(null);
      if (idx >= 0) next[idx] = data.id;
      return next;
    });
    // The combo-validation effect below picks up the slot change and
    // re-runs the multi-photo check. We don't validate per-photo here
    // because ByteDance's `partner_validation_failed` filter only fires
    // when 2–3 face references are submitted together - single-image
    // checks always pass and don't catch the real failure mode.
  };

  const onSlotDrop = (slotIndex: number, e: React.DragEvent) => {
    e.preventDefault();
    setDragSlots(prev => { const next = new Set(prev); next.delete(slotIndex); return next; });
    // HEIC files often report no mime type on drop, so fall back to the
    // file extension. uploadFileIntoSlot will transcode HEIC→JPEG before
    // it hits storage.
    const file = Array.from(e.dataTransfer.files).find(f => {
      if (f.type.startsWith('image/')) return true;
      const n = f.name.toLowerCase();
      return n.endsWith('.heic') || n.endsWith('.heif');
    });
    if (!file) return;
    uploadFileIntoSlot(file, slotIndex);
  };

  const onFileInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const targetSlot = pendingSlotRef.current;
    pendingSlotRef.current = null;
    await uploadFileIntoSlot(files[0], targetSlot);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const togglePick = (p: PickedProduct) => {
    let wasPicked = false;
    let hitLimit = false;
    setPicked(prev => {
      wasPicked = prev.some(x => x.id === p.id);
      if (wasPicked) return prev.filter(x => x.id !== p.id);
      if (prev.length >= MAX_PRODUCTS) {
        hitLimit = true;
        return prev;
      }
      return [...prev, p];
    });
    if (hitLimit) {
      // Surface the limit so the tap doesn't feel like a silent no-op.
      // The dock's count chip already shows "5/5", but a tap on a 6th
      // card needs explicit feedback or it reads as broken.
      setLimitWarning(`You can pick up to ${MAX_PRODUCTS} products. Remove one to swap.`);
      return;
    }
    // Scroll the freshly-picked card into the visible center of its
    // category row so the user gets immediate confirmation. Only fires
    // on the pick (not the unpick).
    //
    // We can't use Element.scrollIntoView({ inline: 'center' }) here —
    // that method walks EVERY scrollable ancestor and centers each one,
    // so picking a card in a middle row also page-scrolls the rows
    // above and below it (the regression in the user's screenshot).
    // Instead we manually scroll ONLY the row's horizontal scroller by
    // the delta between the card's centre and the row's centre. The
    // page stays put.
    if (!wasPicked && typeof document !== 'undefined') {
      requestAnimationFrame(() => {
        const card = document.querySelector(`[data-gen-card-id="${p.id}"]`) as HTMLElement | null;
        if (!card) return;
        // Horizontal centering only applies to the legacy per-category rows;
        // the unified cloud is a grid (no horizontal scroller).
        const row = card.closest('.gen-cat-row-scroll') as HTMLElement | null;
        if (row) {
          const cardRect0 = card.getBoundingClientRect();
          const rowRect = row.getBoundingClientRect();
          const delta = (cardRect0.left + cardRect0.width / 2) - (rowRect.left + rowRect.width / 2);
          if (Math.abs(delta) >= 4) row.scrollBy({ left: delta, behavior: 'smooth' });
        }
        const cardRect = card.getBoundingClientRect();
        // Also bring the card to the vertical middle of the screen. Target
        // ~46% of the viewport so the bottom dock doesn't cover it. Scroll the
        // ACTUAL scroll container: .gen-page only scrolls on some viewports —
        // on others the window scrolls — so walk to the nearest scrollable
        // ancestor and fall back to the window. (Was scrolling .gen-page
        // unconditionally, which no-ops when the window is the real scroller,
        // so the card never moved to the middle.)
        const vDelta = (cardRect.top + cardRect.height / 2) - window.innerHeight * 0.46;
        if (Math.abs(vDelta) > 10) {
          let scroller: HTMLElement | null = (row || card).parentElement;
          while (scroller) {
            const oy = getComputedStyle(scroller).overflowY;
            if ((oy === 'auto' || oy === 'scroll') && scroller.scrollHeight > scroller.clientHeight + 1) break;
            scroller = scroller.parentElement;
          }
          if (scroller) scroller.scrollBy({ top: vDelta, behavior: 'smooth' });
          else window.scrollBy({ top: vDelta, behavior: 'smooth' });
        }
      });
    }
  };

  // Transient toast surfaced when the user taps a 6th product. Auto-
  // dismisses after a few seconds; clears on next successful pick or
  // unpick so it never lingers past relevance.
  const [limitWarning, setLimitWarning] = useState<string | null>(null);
  useEffect(() => {
    if (!limitWarning) return;
    const t = window.setTimeout(() => setLimitWarning(null), 2800);
    return () => window.clearTimeout(t);
  }, [limitWarning]);
  useEffect(() => {
    // Any change to picked while the warning is up means the user
    // resolved the situation - drop the toast immediately.
    if (limitWarning) setLimitWarning(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked.length]);

  const setPickedRole = (id: string, role: string | null) => {
    setPicked(prev => prev.map(x => x.id === id ? { ...x, role_tag: role } : x));
  };

  // Open a past generation in the Result view. Used when the shopper taps
  // a card in the "Your looks" grid.
  const openGeneration = useCallback((g: UserGeneration) => {
    setGeneration(g);
    setStep('result');
  }, []);

  // Hydrate the wizard from an existing generation and jump to Review so
  // the shopper can tweak + re-submit. A fresh row is created on submit so
  // the history in "Your looks" is preserved.
  const editGeneration = useCallback(async (id: string) => {
    const detail = await getGenerationDetail(id);
    if (!detail.generation) return;

    const ids = detail.uploadIds.slice(0, MAX_PHOTOS);
    const padded: (string | null)[] = [null, null, null];
    ids.forEach((id, i) => { padded[i] = id; });
    setSlots(padded);

    // Merge any referenced uploads into the library so the review step's
    // thumbnails resolve immediately (they may not be loaded yet).
    if (detail.uploads.length) {
      setExistingUploads(prev => {
        const have = new Set(prev.map(u => u.id));
        const add = detail.uploads.filter(u => !have.has(u.id));
        return add.length ? [...add, ...prev] : prev;
      });
    }

    setPicked(detail.products.map(row => ({
      id: row.product_id,
      name: row.product?.name ?? null,
      brand: row.product?.brand ?? null,
      price: row.product?.price ?? null,
      image_url: row.product?.image_url ?? null,
      role_tag: row.role_tag,
    })));

    if (detail.generation.height_cm) setHeightCm(detail.generation.height_cm);
    if (detail.generation.height_label) setHeightLabel(detail.generation.height_label);
    if (detail.generation.age_label) setAgeLabel(detail.generation.age_label);
    if (detail.generation.style) setStyle(detail.generation.style);
    if (detail.generation.duration_seconds === 5 || detail.generation.duration_seconds === 10) {
      setClipSeconds(detail.generation.duration_seconds);
    }
    if (detail.generation.model === 'fast' || detail.generation.model === 'pro') {
      setModel(detail.generation.model);
    }

    setGeneration(null);
    setSubmitError(null);
    setStep('review');
  }, []);

  const startNewLook = () => {
    setGeneration(null);
    setSubmitError(null);
    setPicked([]);
    setStep('photos');
  };

  // Export the current generation: mint a public share + open the
  // share modal. The Modal worker fills in the watermarked URL
  // asynchronously; the modal polls via getLookShare on a 2 s
  // interval until status === 'done' or 'failed'.
  const handleExportShare = useCallback(async () => {
    if (!generation || generation.status !== 'done') return;
    setExportError(null);
    setExportSubmitting(true);
    setExportOpen(true);
    const resp = await createLookShare(generation.id);
    setExportSubmitting(false);
    if (resp.error || !resp.slug) {
      setExportError(resp.error || 'Couldn’t create share. Try again.');
      return;
    }
    setExportSlug(resp.slug);
    setExportShare({
      id: resp.share_id,
      slug: resp.slug,
      generation_id: generation.id,
      created_by: '',
      watermarked_video_url: resp.watermarked_video_url ?? null,
      watermarked_storage_path: null,
      status: resp.status,
      error: null,
      created_at: new Date().toISOString(),
      rendered_at: null,
    });
  }, [generation]);

  // Poll the share row until the watermark renders or fails. Stops
  // the moment the modal closes or a terminal status lands.
  useEffect(() => {
    if (!exportOpen || !exportShare?.id) return;
    if (exportShare.status === 'done' || exportShare.status === 'failed') return;
    const tick = window.setInterval(async () => {
      const fresh = await getLookShare(exportShare.id);
      if (!fresh) return;
      setExportShare(fresh);
    }, 2000);
    return () => window.clearInterval(tick);
  }, [exportOpen, exportShare?.id, exportShare?.status]);

  const canAdvance = useMemo(() => {
    // Photos step now also requires height + age. Without this, a user
    // could skip the About step's prereqs (only validated when the
    // wizard is on About itself) by hitting the "Make a new look" CTA
    // from the photos step. The model needs both anchors to render a
    // believable look, so we gate at the entry point.
    if (step === 'photos') return pickedUploadIds.length > 0 && !uploading && !!heightLabel && !!ageLabel;
    // Products are optional — a shopper can render a styled video of just
    // themselves (photos only), or drive it purely with a custom text
    // direction. Don't block Next on having picked a product.
    if (step === 'products') return true;
    // A preset style OR a typed custom direction is enough to proceed.
    if (step === 'style') return !!style || !!customStyle.trim();
    return true;
  }, [step, pickedUploadIds.length, uploading, heightLabel, ageLabel, style, customStyle]);

  const handleSubmit = async () => {
    if (!effectiveUserId) {
      setSubmitError(impersonationRequested ? 'Impersonation target unresolved' : 'Sign in required');
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    const prompt = buildGenerationPrompt({
      heightLabel,
      weightLabel,
      ageLabel,
      gender: userGender,
      style,
      occasion: occasionHint || undefined,
      customStyle: customStyle || undefined,
      durationSeconds: clipSeconds,
      productLines: picked.map(p => ({
        role_tag: p.role_tag,
        brand: p.brand,
        name: p.name,
      })),
    });
    const { data, error } = await createGeneration({
      userId: effectiveUserId,
      uploadIds: pickedUploadIds,
      products: picked.map((p, i) => ({ product_id: p.id, role_tag: p.role_tag, sort_order: i })),
      heightCm,
      heightLabel,
      weightLabel,
      ageLabel,
      style,
      prompt,
      durationSeconds: clipSeconds,
      model,
      // Stamp the admin's auth id on the row when impersonating an AI
      // persona so the admin user detail page can split its queue into
      // "Triggered by Admin" vs "Self-triggered".
      triggeredByAdminId: impersonate ? user?.id ?? null : null,
    });
    setSubmitting(false);
    if (error || !data) {
      setSubmitError(error || 'Failed to start generation');
      return;
    }
    setGeneration(data);
    // Fire-and-forget Claude name generation. Doesn't block the user
    // from advancing to the result screen - the name lands on the row
    // asynchronously and shows up in "Your looks" once it does. Surfaced
    // in the global Generation Queue too (a quick text job).
    {
      const nameJob = startGenerationJob({ kind: 'other', label: 'Naming look', model: 'claude' });
      nameLookForGeneration(data.id).then(() => nameJob.finish(undefined, 'Named')).catch(() => nameJob.fail());
    }
    // Prepend the new row to the in-memory list so it shows up in
    // "Your looks" the moment the shopper hits Back from the result
    // screen - no page refresh needed. The list-polling effect will
    // promote it through generating -> done|failed in place.
    setGenerations(prev => [data, ...prev.filter(g => g.id !== data.id)]);
    setStep('result');
  };

  if (authLoading) return <div className="gen-page"><div className="gen-empty">Loading…</div></div>;
  if (!user) {
    return (
      <div className="gen-page">
        <div className="gen-empty">
          <h2>Sign in to generate</h2>
          <p>We need your account to save uploads and track your generations.</p>
          <button className="gen-btn-primary" onClick={() => navigate('/#app')}>Back to catalog</button>
        </div>
      </div>
    );
  }
  // Admin asked to impersonate but the target lookup either failed or
  // resolved to a non-AI profile. Hard-stop the wizard so the admin
  // doesn't think they're generating "as" the persona while every
  // write silently lands on their own row.
  if (impersonationRequested && !impersonate && (impersonateError || effectiveUserReady)) {
    return (
      <div className="gen-page">
        <div className="gen-empty">
          <h2>Can't generate as that user</h2>
          <p>{impersonateError ?? 'That user is not an AI persona.'}</p>
          <button className="gen-btn-primary" onClick={() => navigate('/admin/users?tab=ai')}>
            Back to AI users
          </button>
        </div>
      </div>
    );
  }
  if (impersonationRequested && !effectiveUserReady) {
    return <div className="gen-page"><div className="gen-empty">Resolving impersonation target…</div></div>;
  }

  return (
    <div className={`gen-page${isGeneratingView ? ' gen-page--generating' : ''}${step === 'review' ? ' gen-page--review' : ''}${step === 'style' ? ' gen-page--style' : ''}`}>
      {/* Pick + Review: a live WebGL particle field sits behind the screen so
          products/photos read as floating in 3D space over it. */}
      {(step === 'products' || step === 'review' || step === 'photos') && (
        <div className="gen-products-particles" aria-hidden="true">
          <ParticleBackground />
        </div>
      )}
      {/* Build transition: the picked products fly forward into the next screen. */}
      {launching && (
        <div className="gen-launch-overlay" aria-hidden="true">
          {picked.map((p, i) => (
            <div
              key={p.id}
              className="gen-launch-card"
              style={{
                ['--i']: i,
                backgroundImage: p.image_url ? `url(${p.image_url})` : undefined,
              } as React.CSSProperties}
            />
          ))}
        </div>
      )}
      {confirmHostModal}
      {impersonate && (
        <div
          role="status"
          style={{
            position: 'sticky', top: 0, zIndex: 50,
            display: 'flex', alignItems: 'center', gap: 10,
            background: '#fef3c7', color: '#92400e',
            border: '1px solid #fcd34d', borderRadius: 8,
            padding: '8px 12px', margin: '8px 12px 0', fontSize: 13,
          }}
        >
          {impersonate.avatar_url && (
            <img
              src={impersonate.avatar_url}
              alt=""
              width={24}
              height={24}
              style={{ width: 24, height: 24, borderRadius: '50%', objectFit: 'cover' }}
            />
          )}
          <span>
            <strong>Generating as</strong>{' '}
            {impersonate.full_name || impersonate.id.slice(0, 8)} — every upload &amp; look attaches to this AI persona, not your admin account.
          </span>
          <button
            type="button"
            onClick={() => navigate(`/admin/user/${impersonate.id}`)}
            style={{
              marginLeft: 'auto', background: 'transparent', border: '1px solid #fcd34d',
              color: '#92400e', padding: '4px 8px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
            }}
          >
            Open persona
          </button>
        </div>
      )}
      <div className={`gen-head${step === 'products' ? ' gen-head-compact' : ''}`}>
        {/* On the Products step the back affordance becomes the Catalog
            wordmark — tap the logo to bail back to the home feed. The
            text "Back to catalog" + arrow was wide and competed with
            "Pick your products" below it. Logo reads as the canonical
            "go home" gesture in every other consumer app. */}
        {(() => {
          // On the mid-wizard steps (style, review) the back affordance
          // should walk one step back through the flow — not bail all the
          // way out to the catalog — and the label names the screen you'll
          // land on. Review → "Back to style" (the screen right before it),
          // Style → "Back to products". Everything else keeps the
          // catalog/your-looks exits.
          const PREV_LABEL: Partial<Record<Step, string>> = {
            review: 'Back to style',
            style: 'Back to products',
          };
          const prevLabel = PREV_LABEL[step];
          const label =
            step === 'result' ? 'Back to your looks' : prevLabel || 'Back to catalog';
          return (
            <button
              className={`gen-back${step === 'products' ? ' gen-back-logo' : ''}`}
              onClick={() => {
                // From the result view, "back" should land the shopper on
                // the Photos step (with their looks grid) rather than
                // bouncing them all the way out to the catalog.
                if (step === 'result') {
                  setStep('photos');
                  return;
                }
                // Style / review step back to the previous wizard screen.
                if (prevLabel) {
                  goPrev(step, setStep);
                  return;
                }
                navigate('/#app');
              }}
              aria-label={label}
            >
              {step === 'products' ? (
                <CatalogLogo className="gen-back-logo-svg" />
              ) : (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
                  {label}
                </>
              )}
            </button>
          );
        })()}
        {/* Photos step gets a "Try this on" headline - the actual primary
            verb the page does. Products is dense and gets the back-only
            header. Other secondary steps fall back to the original
            "Generate" framing. */}
        {step === 'photos' && (
          <>
            <h1>Create a new look</h1>
            <p className="gen-sub">Drop in a few clean shots of yourself, then pick up to five products to dress up in.</p>
          </>
        )}
        {step !== 'products' && step !== 'photos' && (
          <>
            <h1>{isGeneratingView ? 'Generating' : step === 'review' ? 'Review' : 'Generate'}</h1>
            <p className="gen-sub">
              {isGeneratingView
                ? 'Hang tight — we’re composing your look.'
                : step === 'review'
                  ? 'Give it a once-over, then build your look.'
                  : "Upload a face, pick up to five products, and we'll compose the look."}
            </p>
          </>
        )}
      </div>

      <main className="gen-main">
        {step === 'photos' && (
          <section className="gen-step gen-step-photos">
            {/* Failed-last-look banner - dismissible */}
            {failedLastLookBanner && (
              <div className="gen-failed-banner" role="alert">
                <span>{failedLastLookBanner}</span>
                <button
                  type="button"
                  className="gen-failed-banner-close"
                  aria-label="Dismiss"
                  onClick={() => setFailedLastLookBanner(null)}
                >
                  ×
                </button>
              </div>
            )}
            {/* Compact input form: title + slots + height + age + Create
                look button. Capped at ~1/3 of the viewport height so the
                "Your looks" grid below can dominate the screen. */}
            <div className="gen-photos-form">
              <div className="gen-photos-title-row">
                <h2 className="gen-photos-title">You</h2>
                {/* Stats chips + Edit button mirror the /style page so the
                    user can spot and adjust the height / age / gender values
                    that get fed into every prompt. Reuses the shared
                    StatsEditorModal so both surfaces persist to the same
                    profiles row. */}
                <div className="style-context-meta gen-photos-stats">
                  {heightLabel && <span className="style-context-chip">{heightLabel}</span>}
                  {ageLabel && <span className="style-context-chip">{ageLabel}</span>}
                  {userGender !== 'unknown' && (
                    <span className="style-context-chip">{userGender}</span>
                  )}
                  <button
                    type="button"
                    className="style-context-edit"
                    onClick={() => setEditingStats(true)}
                  >
                    Edit
                  </button>
                </div>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                hidden
                onChange={onFileInput}
              />

            <div className="gen-slots">
              {slots.map((uploadId, i) => {
                const upload = uploadId ? existingUploads.find(u => u.id === uploadId) : null;
                const isUploadingHere = uploadProgress?.slot === i;
                const pctHere = isUploadingHere ? Math.round(uploadProgress!.pct * 100) : 0;
                const isDragging = dragSlots.has(i);
                // Same 3-strike gate as the warning banner. The
                // pre-validator's blocked signal is noisy enough
                // (false positives on perfectly-fine selfies) that
                // we don't trust it on its own — only after the
                // user has actually hit the wall three times in a
                // row do we paint the slot's red ! badge. Once a
                // generation succeeds, the streak is 0 and the
                // badges clear automatically.
                const rawCheckState = slotChecks[i];
                const checkState = rawCheckState === 'blocked' && consecutiveFailures < 3
                  ? 'ok'
                  : rawCheckState;
                return (
                  <div
                    key={i}
                    className={`gen-slot${upload ? ' is-filled' : ''}${isUploadingHere ? ' is-uploading' : ''}${isDragging ? ' is-dragover' : ''}${checkState === 'blocked' ? ' is-check-blocked' : ''}`}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'copy';
                    }}
                    onDragEnter={(e) => {
                      e.preventDefault();
                      setDragSlots(prev => new Set(prev).add(i));
                    }}
                    onDragLeave={(e) => {
                      // Ignore enter/leave bubbling between children - only
                      // clear the highlight when we actually leave the slot.
                      if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                      setDragSlots(prev => { const next = new Set(prev); next.delete(i); return next; });
                    }}
                    onDrop={(e) => onSlotDrop(i, e)}
                  >
                    {upload ? (
                      <>
                        <img src={upload.public_url} alt={`Reference ${i + 1}`} />
                        {checkState === 'checking' && (
                          <div className="gen-slot-check gen-slot-check--checking" aria-label="Checking photo…" />
                        )}
                        {checkState === 'ok' && (
                          <div className="gen-slot-check gen-slot-check--ok" aria-label="Photo accepted" />
                        )}
                        {checkState === 'blocked' && (
                          <div
                            className="gen-slot-check gen-slot-check--blocked"
                            title="This photo may be rejected - try a different selfie"
                            aria-label="Photo may be blocked"
                          />
                        )}
                        <button
                          type="button"
                          className="gen-slot-clear"
                          onClick={() => clearSlot(i)}
                          aria-label="Remove photo"
                        >×</button>
                        <button
                          type="button"
                          className="gen-slot-replace"
                          onClick={() => openPickerForSlot(i)}
                        >Replace</button>
                      </>
                    ) : isUploadingHere ? (
                      <div className="gen-slot-uploading">
                        <div className="gen-slot-uploading-pct">{pctHere}%</div>
                        <div className="gen-slot-uploading-track">
                          <div className="gen-slot-uploading-fill" style={{ width: `${pctHere}%` }} />
                        </div>
                        <div className="gen-slot-uploading-label">
                          {pctHere >= 100 ? 'Saving…' : 'Uploading'}
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="gen-slot-empty"
                        onClick={() => openPickerForSlot(i)}
                        disabled={uploading}
                      >
                        <span className="gen-slot-plus">+</span>
                        <span className="gen-slot-label">Photo {i + 1}</span>
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            {uploadError && <div className="gen-error">{uploadError}</div>}
            {/* Warning gated on 3 consecutive failed generations. Photo-check
                blocks alone aren't a strong-enough signal (false positives are
                common in the validator); we surface the rejection warning
                only after the user has hit the wall three times in a row so
                we're confident the photo set really is the bottleneck. */}
            {!uploadError && photoCheckReason && slotChecks.some(c => c === 'blocked') && consecutiveFailures >= 3 && (
              <div className="gen-photo-warn">
                {photoCheckReason === 'partner_validation_failed'
                  ? '⚠ ByteDance’s safety filter rejected this photo set. Try replacing one with a different selfie, or use a single photo instead of all three.'
                  : photoCheckReason === 'content_policy_violation'
                    ? '⚠ One of these photos was flagged by the content policy. Try a different selfie.'
                    : photoCheckReason === 'no_face_detected'
                      ? '⚠ No face detected in one of these photos. Use a clear front-facing selfie.'
                      : '⚠ These photos may be rejected by the video provider. Try replacing one or use a different selfie.'}
              </div>
            )}

              {/* Height + age are read from the user's profile (set
                  once, prefilled from getUserHeightAge on mount) so
                  the wizard never asks twice. The values are still
                  passed to the generation request below. */}

            </div>

            {/* "Make a new look" is the single primary CTA on the
                photos step. Two states:
                  - canAdvance (user uploaded photos + picked style) →
                    call goNext to actually kick off generation. This
                    folds in the work the previous "Create look" sticky
                    button used to do, so there's only one button to
                    click instead of two competing CTAs.
                  - otherwise → scroll to the top of the page so the
                    user lands on the upload slots and can start the
                    flow. The button is never disabled because there's
                    always a useful action to take.
                Sits in the dock-style sticky bar at the bottom of the
                viewport so it's always reachable, even with many
                "Your looks" cards below. */}
            <div className="gen-photos-cta-bar">
              <button
                type="button"
                className="gen-creator-cta gen-creator-cta--primary"
                onClick={() => {
                  if (canAdvance) goNext(step, setStep);
                  else window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
              >
                <span className="gen-creator-cta-icon" aria-hidden="true">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                </span>
                <span className="gen-creator-cta-label">Make a new look</span>
                <span className="gen-creator-cta-chevron" aria-hidden="true">›</span>
              </button>
            </div>
            {/* "Your looks" grid removed from this page — generated looks now
                live in My Catalog (as Inactive) instead. */}
          </section>
        )}

        {pickerSlot !== null && (
          <UploadPickerModal
            slot={pickerSlot}
            uploads={existingUploads}
            pickedIds={pickedUploadIds}
            currentSlotId={slots[pickerSlot]}
            onClose={() => setPickerSlot(null)}
            onPick={(id) => { placeUploadInSlot(pickerSlot, id); setPickerSlot(null); }}
            onDelete={removeUpload}
            onUploadNew={openFileChooserFromModal}
          />
        )}

        {step === 'products' && (
          <section className="gen-step gen-step-products">
            <h2>Pick your products</h2>
            {/* Picked-products preview moved into the unified gen-dock at
                the bottom (see render below) so the three previously
                separate fixed elements (picks, Back/Next, step rail)
                read as one cohesive control surface. */}

            {/* Six horizontal-scroll rows. Each row is one of CATEGORY_GROUPS
                - Hat / Top / Bottoms / Shoes / Accessories / Objects.
                Empty rows are still rendered so the layout is predictable
                across catalog states; they show a quiet empty hint. */}
            {productsLoading && productResults.length === 0 ? (
              <div className="gen-empty">Loading products…</div>
            ) : (
              <>
                {/* Unified field: one search + category chips over a single
                    floating cloud of all products. */}
                <div className="gen-cloud-controls">
                  <input
                    type="search"
                    className="gen-cloud-search"
                    placeholder="Search products…"
                    value={cloudQuery}
                    onChange={e => setCloudQuery(e.target.value)}
                    aria-label="Search products"
                  />
                  <div className="gen-cloud-chips" role="tablist" aria-label="Filter by category">
                    <button type="button" role="tab" aria-selected={!cloudCat} className={`gen-cloud-chip${!cloudCat ? ' is-active' : ''}`} onClick={() => { setCloudCat(null); setCloudBrand(null); }}>All</button>
                    {CATEGORY_GROUPS.map(g => (
                      <button
                        key={g.label}
                        type="button"
                        role="tab"
                        aria-selected={cloudCat === g.label}
                        className={`gen-cloud-chip${cloudCat === g.label ? ' is-active' : ''}`}
                        onClick={() => { setCloudCat(c => (c === g.label ? null : g.label)); setCloudBrand(null); }}
                      >{g.label}</button>
                    ))}
                  </div>
                  {/* Brands under the types — filter the field to one brand. */}
                  {cloudBrands.length > 0 && (
                    <div className="gen-cloud-chips gen-cloud-chips--brands" role="tablist" aria-label="Filter by brand">
                      {cloudBrands.map(b => (
                        <button
                          key={b}
                          type="button"
                          role="tab"
                          aria-selected={cloudBrand === b}
                          className={`gen-cloud-chip gen-cloud-chip--brand${cloudBrand === b ? ' is-active' : ''}`}
                          onClick={() => setCloudBrand(c => (c === b ? null : b))}
                        >{b}</button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="gen-cloud" style={{ ['--gen-cols']: pickCols } as React.CSSProperties}>
                  {cloudProducts.length === 0 ? (
                    <div className="gen-cat-row-empty">
                      {cloudQuery ? `No products match "${cloudQuery}"` : 'No products yet'}
                    </div>
                  ) : (
                    cloudProducts.map(p => {
                      const isPicked = picked.some(x => x.id === p.id);
                      const poster = p.primary_video_poster_url || p.primary_image_url || p.image_url;
                      return (
                        <button
                          key={p.id}
                          type="button"
                          className={`gen-cloud-card${isPicked ? ' is-picked' : ''}`}
                          data-gen-card-id={p.id}
                          onClick={() => togglePick(p)}
                        >
                          {p.primary_video_url ? (
                            <AutoplayVideo className="gen-cloud-media" src={p.primary_video_url} poster={poster || undefined} />
                          ) : poster ? (
                            <img className="gen-cloud-media" src={poster} alt="" loading="lazy" decoding="async" />
                          ) : null}
                          <span className="gen-cloud-card-name">{p.name || 'Product'}</span>
                          <span className="gen-cloud-card-brand">{p.brand}</span>
                        </button>
                      );
                    })
                  )}
                </div>
                {/* Grid-density dial — same wheel as the creator catalog.
                    Scroll/drag to change columns (2/3/4), tap to cycle.
                    Mobile-only; auto-hides on scroll-down. */}
                <div
                  ref={pickDialRef}
                  className={`gen-grid-dial${pickDialHidden ? ' gen-grid-dial--hidden' : ''}`}
                  role="group"
                  aria-label="Grid columns"
                  onClick={cyclePickCols}
                >
                  {PICK_COLS.map((c, i) => (
                    <span
                      key={c}
                      className={`gen-grid-dial-dot${i === pickColsIndex ? ' is-active' : ''}`}
                      aria-label={`${c} columns`}
                      aria-current={i === pickColsIndex}
                    >
                      <span className="gen-grid-dial-bars">
                        {Array.from({ length: c }).map((_, b) => <i key={b} />)}
                      </span>
                    </span>
                  ))}
                </div>
              </>
            )}
          </section>
        )}

        {step === 'style' && (
          <section className="gen-step">
            <h2>Style</h2>
            {/* Horizontal swiper of preset styles. */}
            <div className="gen-styleswiper">
              {STYLE_PRESETS.map(s => (
                <button
                  key={s.value}
                  type="button"
                  className={`gen-stylecard${style === s.value ? ' is-picked' : ''}`}
                  onClick={() => { setStyle(s.value); setCustomStyle(''); }}
                  aria-pressed={style === s.value}
                >
                  <span className="gen-stylecard-icon" aria-hidden="true"><StyleGlyph value={s.value} /></span>
                  <span className="gen-stylecard-label">{s.label}</span>
                  <span className="gen-stylecard-blurb">{s.blurb}</span>
                </button>
              ))}
            </div>

            {/* Direct your own video — free-text prompt fed straight into the
                Seedance generation prompt (buildGenerationPrompt → customStyle
                → "Style direction: …"). The render notifies globally on
                completion via the existing generation-status toast. */}
            <div className="gen-direct">
              <h3 className="gen-direct-title">Or direct your own video</h3>
              <p className="gen-direct-sub">Describe the vibe, setting, motion — anything you want your video to be like.</p>
              <textarea
                className="gen-direct-input"
                value={customStyle}
                onChange={e => {
                  const v = e.target.value;
                  setCustomStyle(v);
                  // One or the other: typing a custom direction deselects the
                  // preset cards; clearing it restores the default preset.
                  setStyle(v.trim() ? '' : 'street');
                }}
                placeholder="e.g. slow walk through a neon-lit Tokyo alley at night, cinematic, light rain"
                rows={3}
                maxLength={500}
              />
            </div>
          </section>
        )}

        {step === 'review' && (
          <section className="gen-step gen-step-review">
            {/* Rebuilt review — one centred stage, locked to a single
                viewport. The chosen PRODUCTS are the hero in the middle of
                the screen; the reference FACES sit above them as a single
                connected chain (overlapping circles joined by a thread) so
                they read as "these combine into one model". Build lives in
                the fixed bottom dock. */}
            <div className="gen-rv-stage">
              {filledPublicUrls.length > 0 && (
                <div className="gen-rv-faces" aria-label="Your reference photos">
                  <span className="gen-rv-faces-thread" aria-hidden="true" />
                  {filledPublicUrls.slice(0, 5).map((src, i, arr) => (
                    <span
                      key={`${src}-${i}`}
                      className="gen-rv-face"
                      style={{ ['--i' as string]: i, ['--n' as string]: arr.length }}
                    >
                      <img src={src} alt="" loading="lazy" decoding="async" />
                    </span>
                  ))}
                </div>
              )}

              {picked.length > 0 && (
                <div className="gen-rv-products" role="list" aria-label="Selected products">
                  {picked.map((p, i) => (
                    <span
                      key={p.id}
                      role="listitem"
                      className="gen-rv-product"
                      style={{ ['--i' as string]: i }}
                    >
                      {p.image_url && <img src={p.image_url} alt={p.name || 'Product'} loading="lazy" decoding="async" />}
                      <span className="gen-rv-product-name">{p.name || 'Product'}</span>
                    </span>
                  ))}
                </div>
              )}

              {/* Only the controls that change the build live here now —
                  Model + Length. Height / age / style are already locked in
                  on earlier steps, so the cluttered summary table is gone. */}
              <div className="gen-rv-controls">
                <div className="gen-rv-control">
                  <span className="gen-rv-control-label">Model</span>
                  <div className="gen-review-toggle">
                    <button
                      type="button"
                      className={`gen-review-toggle-btn${model === 'fast' ? ' is-picked' : ''}`}
                      onClick={() => { setModel('fast'); setClipSeconds(5); }}
                      title="Fast: cheaper, ~3 min, 5-second output"
                    >Fast</button>
                    <button
                      type="button"
                      className={`gen-review-toggle-btn${model === 'pro' ? ' is-picked' : ''}`}
                      onClick={() => setModel('pro')}
                      title="Pro is in preview - currently runs at Fast quality (5-second clips) while Pro is being rolled out."
                    >Pro</button>
                  </div>
                </div>
                <div className="gen-rv-control">
                  <span className="gen-rv-control-label">Length</span>
                  {model === 'pro' ? (
                    <div className="gen-review-toggle">
                      {[5, 10].map(sec => (
                        <button
                          key={sec}
                          type="button"
                          className={`gen-review-toggle-btn${clipSeconds === sec ? ' is-picked' : ''}`}
                          onClick={() => setClipSeconds(sec as 5 | 10)}
                        >{sec}s</button>
                      ))}
                    </div>
                  ) : (
                    <span className="gen-rv-control-value">{clipSeconds}s</span>
                  )}
                </div>
              </div>
            </div>

            {submitError && <div className="gen-error">{submitError}</div>}
          </section>
        )}

        {step === 'result' && (
          <section className="gen-step gen-step-result">
            <h2>Your look</h2>
            <div className="gen-result-layout">
              <div className="gen-result-stage">
            {!generation && <div className="gen-empty">Loading…</div>}
            {(generation?.status === 'pending' || generation?.status === 'generating') && (
              <GenerationProgress generation={generation} images={orbitImages} />
            )}
            {generation?.status === 'failed' && (
              <GenerationErrorBox generation={generation} pickedCount={picked.length} faceCount={slots.filter(Boolean).length} />
            )}
            {generation?.status === 'done' && generation.video_url && (
              <div className="gen-build gen-build-done">
                <div className="gen-build-burst" aria-hidden="true" />
                <div className="gen-build-burst gen-build-burst-2" aria-hidden="true" />
                <div className="gen-build-frame is-done">
                  <video
                    src={generation.video_url}
                    autoPlay
                    loop
                    muted
                    playsInline
                    className="gen-result-video"
                    style={cropTransformStyle(generation)}
                  />
                </div>
              </div>
            )}
            {generation?.status === 'done' && resultProducts.length > 0 && (
              <div className="gen-result-products">
                <div className="gen-result-products-label">Products in this look</div>
                <ul className="gen-result-products-list">
                  {resultProducts.map(p => (
                    <li key={p.product_id} className="gen-result-product">
                      {p.product?.image_url ? (
                        <img src={p.product.image_url} alt="" className="gen-result-product-img" />
                      ) : (
                        <div className="gen-result-product-img gen-result-product-img-empty" />
                      )}
                      <div className="gen-result-product-text">
                        {p.role_tag && <span className="gen-result-product-role">{p.role_tag}</span>}
                        <span className="gen-result-product-name">
                          {[p.product?.brand, p.product?.name].filter(Boolean).join(' - ') || 'Product'}
                        </span>
                        {p.product?.price && <span className="gen-result-product-price">{p.product.price}</span>}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {/* "How did I do?" feedback bar — only on the done state.
                One of three answers expands inline:
                  - love  → keep private / publish to catalog
                  - off   → free-text reason
                  - delete → confirm + hard delete (existing flow) */}
            {generation?.status === 'done' && generation.video_url && !feedbackDone && (
              <div className="gen-feedback">
                <div className="gen-feedback-prompt">
                  {feedbackKind === null && <span>Well, how did I do?</span>}
                  {feedbackKind === 'love' && <span>Love it. Want others to see it too?</span>}
                  {feedbackKind === 'off'  && <span>What was off?</span>}
                </div>

                {feedbackKind === null && (
                  <div className="gen-feedback-options">
                    <button
                      type="button"
                      className="gen-feedback-btn gen-feedback-btn-love"
                      onClick={() => setFeedbackKind('love')}
                    >
                      It looks great!!
                    </button>
                    <button
                      type="button"
                      className="gen-feedback-btn gen-feedback-btn-off"
                      onClick={() => setFeedbackKind('off')}
                    >
                      It&apos;s okay…
                    </button>
                    <button
                      type="button"
                      className="gen-feedback-btn gen-feedback-btn-delete"
                      disabled={feedbackBusy}
                      onClick={async () => {
                        const ok = await confirmAction({
                          title: 'Delete this look?',
                          body: 'This can’t be undone.',
                          confirmLabel: 'Delete',
                          destructive: true,
                        });
                        if (!ok) return;
                        setFeedbackBusy(true);
                        await deleteUserGeneration(generation.id);
                        setFeedbackBusy(false);
                        startNewLook();
                      }}
                    >
                      Don&apos;t like — delete
                    </button>
                  </div>
                )}

                {feedbackKind === 'love' && (
                  <div className="gen-feedback-options">
                    <button
                      type="button"
                      className="gen-feedback-btn gen-feedback-btn-secondary"
                      disabled={feedbackBusy}
                      onClick={async () => {
                        setFeedbackBusy(true);
                        await setGenerationFeedback(generation.id, 'love');
                        await setGenerationPublished(generation.id, false);
                        setFeedbackBusy(false);
                        setFeedbackDone('kept');
                      }}
                    >
                      Keep private
                    </button>
                    <button
                      type="button"
                      className="gen-feedback-btn gen-feedback-btn-publish"
                      disabled={feedbackBusy}
                      onClick={async () => {
                        setFeedbackBusy(true);
                        await setGenerationFeedback(generation.id, 'love');
                        await setGenerationPublished(generation.id, true);
                        setFeedbackBusy(false);
                        setFeedbackDone('published');
                      }}
                    >
                      Publish to catalog &amp; make $$$
                    </button>
                    <button
                      type="button"
                      className="gen-feedback-btn-link"
                      onClick={() => setFeedbackKind(null)}
                    >
                      ←
                    </button>
                  </div>
                )}

                {feedbackKind === 'off' && (
                  <div className="gen-feedback-off">
                    <textarea
                      className="gen-feedback-textarea"
                      placeholder="What was off about it? (face, fit, vibe, lighting…)"
                      value={feedbackReason}
                      onChange={(e) => setFeedbackReason(e.target.value)}
                      rows={3}
                    />
                    <div className="gen-feedback-options">
                      <button
                        type="button"
                        className="gen-feedback-btn-link"
                        onClick={() => { setFeedbackKind(null); setFeedbackReason(''); }}
                      >
                        ←
                      </button>
                      <button
                        type="button"
                        className="gen-feedback-btn gen-feedback-btn-secondary"
                        disabled={feedbackBusy || !feedbackReason.trim()}
                        onClick={async () => {
                          setFeedbackBusy(true);
                          await setGenerationFeedback(generation.id, 'off', feedbackReason.trim());
                          setFeedbackBusy(false);
                          setFeedbackDone('reported');
                        }}
                      >
                        Send feedback
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {feedbackDone && (
              <div className={`gen-feedback-done gen-feedback-done-${feedbackDone}`}>
                {feedbackDone === 'kept' && <span>Saved privately. You can publish anytime from your looks.</span>}
                {feedbackDone === 'published' && <span>Published to the catalog. Earn when shoppers buy from this look.</span>}
                {feedbackDone === 'reported' && <span>Got it — feedback saved. We&apos;ll tune the model.</span>}
              </div>
            )}

            {generation && (
              <div className="gen-result-actions">
                <button className="gen-btn-primary" onClick={startNewLook}>
                  Get a new look going
                </button>
                {/* "Keep discovering" lets the shopper bail off the
                    progress screen back to the catalog feed while the
                    render finishes. The look continues processing in
                    the background — generation state lives in
                    user_generations and is polled the moment the user
                    returns. Subtext reassures so they don't think the
                    button cancels their in-flight look. */}
                {generation.status !== 'done' && (
                  <button
                    type="button"
                    className="gen-btn-secondary gen-btn-keep-discovering"
                    onClick={() => {
                      // Skip the cold-open splash — the shopper is mid-session
                      // bailing back to the feed, not booting the app fresh.
                      try { sessionStorage.setItem('catalog:cold-open-done', '1'); } catch { /* ignore */ }
                      navigate('/#app');
                      // Land at the very top of the feed, not wherever it was
                      // last scrolled — otherwise the home opens mid-page.
                      requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'auto' }));
                      window.setTimeout(() => window.scrollTo({ top: 0, behavior: 'auto' }), 60);
                    }}
                  >
                    <span className="gen-btn-keep-discovering-label">Keep discovering</span>
                    <span className="gen-btn-keep-discovering-sub">
                      Don&rsquo;t worry — this won&rsquo;t end your look
                    </span>
                  </button>
                )}
                {generation.status === 'done' && generation.video_url && (
                  <>
                    <button
                      className="gen-btn-secondary"
                      onClick={() => setCropOpen(true)}
                    >
                      Crop
                    </button>
                    {/* Mints a public /s/:slug share link via the
                        share-look edge function + Modal worker. The
                        modal shows the URL with a copy button. */}
                    <button
                      className="gen-btn-secondary"
                      onClick={handleExportShare}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ marginRight: 6, verticalAlign: '-2px' }}>
                        <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
                        <polyline points="16 6 12 2 8 6"/>
                        <line x1="12" y1="2" x2="12" y2="15"/>
                      </svg>
                      Share link
                    </button>
                    {/* Edit & regenerate is only meaningful once the
                        current look has finished rendering — there's
                        nothing to "edit" while the pipeline is still
                        working on it. */}
                    <button
                      className="gen-btn-secondary"
                      onClick={() => editGeneration(generation.id)}
                    >
                      Edit &amp; regenerate
                    </button>
                  </>
                )}
              </div>
            )}

            {cropOpen && generation?.video_url && (
              <CropModal
                videoUrl={generation.video_url}
                initial={{
                  scale: generation.crop_scale ?? 1,
                  x: generation.crop_x ?? 0,
                  y: generation.crop_y ?? 0,
                }}
                onClose={() => setCropOpen(false)}
                onSave={async (crop) => {
                  setGeneration(prev => prev ? { ...prev, crop_scale: crop.scale, crop_x: crop.x, crop_y: crop.y } : prev);
                  setGenerations(prev => prev.map(g =>
                    g.id === generation.id
                      ? { ...g, crop_scale: crop.scale, crop_x: crop.x, crop_y: crop.y }
                      : g));
                  setCropOpen(false);
                  await updateGenerationCrop(generation.id, crop);
                }}
              />
            )}

            {exportOpen && (
              <ExportShareModal
                share={exportShare}
                slug={exportSlug}
                submitting={exportSubmitting}
                error={exportError}
                onClose={() => {
                  setExportOpen(false);
                  setExportError(null);
                }}
              />
            )}
              </div>

              {/* Desktop-only "while you wait" rail. The phone-mockup
                  progress fills the left column; we use the right column
                  to surface the user's other looks so the wait feels
                  like browsing their own catalog. Hidden on mobile via
                  CSS so the existing single-column flow is preserved. */}
              <aside className="gen-result-side" aria-label="Your other looks">
                <div className="gen-result-side-label">
                  {generation?.status === 'done' ? 'Your looks' : 'While we compose your look…'}
                </div>
                {generations.filter(g => g.id !== generation?.id && g.video_url).length === 0 ? (
                  <div className="gen-result-side-empty">
                    Your past looks will appear here as you make more.
                  </div>
                ) : (
                  <div className="gen-result-side-grid">
                    {generations
                      .filter(g => g.id !== generation?.id && g.video_url)
                      .slice(0, 8)
                      .map(g => (
                        <button
                          key={g.id}
                          type="button"
                          className="gen-result-side-tile"
                          onClick={() => openGeneration(g)}
                          aria-label="Open this look"
                        >
                          <video
                            src={g.video_url || undefined}
                            autoPlay
                            loop
                            muted
                            playsInline
                            preload="metadata"
                          />
                          <span className="gen-result-side-tile-style">{g.style}</span>
                        </button>
                      ))}
                  </div>
                )}
              </aside>
            </div>
          </section>
        )}
      </main>

      {/* Unified bottom dock - single horizontal row that combines the
          picked-products strip (when applicable) with the Back/Next
          action buttons. Step progress rail removed at the user's
          request; the section heading on the page already tells you
          which step you're on. */}
      {step !== 'result' && step !== 'photos' && (
        <>
        {limitWarning && (
          <div className="gen-limit-toast" role="status" aria-live="polite">
            {limitWarning}
          </div>
        )}
        <aside
          className={`gen-dock${
            // Products step + nothing picked yet → dock slides off
            // the bottom and waits. The moment the user picks their
            // first product the class flips and the dock eases up
            // into view. Other steps (style, review) always show it.
            step === 'products' && picked.length === 0 ? ' is-hidden' : ' is-revealed'
          }`}
          aria-label="Step controls"
          aria-hidden={step === 'products' && picked.length === 0 ? 'true' : undefined}
        >
          {/* Picked-products strip stays visible across products → style so
              the user always sees what they're building. Hidden on REVIEW —
              the floating circles already show the face + products there, so
              the thumbnail strip just crowds the dock. The tap-to-remove × is
              still wired on the earlier steps. */}
          {picked.length > 0 && step !== 'review' && (
            <div className="gen-dock-picks-strip" role="region" aria-label="Selected products">
              {picked.map(p => (
                <div
                  key={p.id}
                  className={`gen-dock-pick${prefilledProductId === p.id ? ' is-prefilled' : ''}`}
                  data-prefilled-id={prefilledProductId === p.id ? p.id : undefined}
                >
                  {p.image_url && <img src={p.image_url} alt={p.name || 'Product'} />}
                  <button
                    type="button"
                    className="gen-dock-pick-x"
                    onClick={() => togglePick(p)}
                    aria-label={`Remove ${p.name || 'product'}`}
                  >×</button>
                </div>
              ))}
              <div className="gen-dock-picks-count" aria-hidden="true">
                {picked.length}/{MAX_PRODUCTS}
              </div>
            </div>
          )}

          <div className="gen-dock-actions">
            <button className="gen-btn-secondary" onClick={() => goPrev(step, setStep)}>
              Back
            </button>
            {step === 'review' ? (
              <button
                className="gen-btn-primary gen-continue"
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  playExplosion(r.left + r.width / 2, r.top + r.height / 2, () => { void handleSubmit(); });
                }}
                disabled={submitting}
              >
                <span className="gen-continue-spark" aria-hidden="true" />
                {submitting ? 'Starting…' : 'Build'}
              </button>
            ) : (
              <button
                className="gen-btn-primary"
                disabled={!canAdvance}
                onClick={() => (step === 'products' ? launchToNext() : goNext(step, setStep))}
              >
                Next
              </button>
            )}
          </div>
        </aside>
        </>
      )}

      {editingStats && effectiveUserId && (
        <StatsEditorModal
          userId={effectiveUserId}
          initial={{ heightCm, heightLabel, weightKg, weightLabel, ageLabel, gender: userGender }}
          onClose={() => setEditingStats(false)}
          onSaved={(next) => {
            if (next.heightCm != null) setHeightCm(next.heightCm);
            if (next.heightLabel) setHeightLabel(next.heightLabel);
            if (next.weightKg != null) setWeightKg(next.weightKg);
            if (next.weightLabel) setWeightLabel(next.weightLabel);
            if (next.ageLabel) setAgeLabel(next.ageLabel);
            setUserGender(next.gender);
            setEditingStats(false);
          }}
        />
      )}
    </div>
  );
}

const STEP_ORDER: Step[] = ['photos', 'products', 'style', 'review'];

function goNext(current: Step, set: (s: Step) => void) {
  const i = STEP_ORDER.indexOf(current);
  if (i >= 0 && i < STEP_ORDER.length - 1) set(STEP_ORDER[i + 1]);
}
function goPrev(current: Step, set: (s: Step) => void) {
  const i = STEP_ORDER.indexOf(current);
  if (i > 0) set(STEP_ORDER[i - 1]);
}

// Ten labelled phases the build pass flows through. They're cosmetic  - 
// Fal doesn't expose stage progress - but the gradual reveal builds
// anticipation and gives the wait a sense of motion. Each phase owns
// 10% of the typical budget; we mark prior phases as done as we cross
// the boundary into the next one.
const BUILD_PHASES = [
  'Queueing your look',
  'Reading reference photos',
  'Mapping facial features',
  'Locking in proportions',
  'Pulling product details',
  'Composing the outfit',
  'Lighting the scene',
  'Rendering motion frames',
  'Color grading',
  'Final pass',
];

// Rotating "analyzing" one-liners shown on the build screen — a words
// ticker that keeps the wait playful. Cosmetic only; cycles independently
// of the BUILD_PHASES label so there's always something moving.
const BUILD_JOKES = [
  'Analyzing your impeccable taste…',
  'Consulting the fashion oracle…',
  'Steaming the pixels…',
  'Negotiating with the lighting…',
  'Teaching the fabric to drape…',
  'Auditioning camera angles…',
  'Convincing the shoes to behave…',
  'Whispering to the color grade…',
  'Removing the awkward blink…',
  'Tailoring at the speed of light…',
  'Asking the AI to “make it pop”…',
  'Polishing every last thread…',
];

// Friendly summary for known Fal/Seedance failure shapes. Returns a
// short headline (rendered as the red banner) and a hint that helps the
// user fix it themselves where possible. Prefers structured error_code
// (set by fal-webhook); falls back to substring matching on the legacy
// raw error string for older rows.
function summarizeGenerationError(
  raw: string,
  code?: string | null,
): { headline: string; hint: string | null } {
  // Prefer structured code - fal-webhook now classifies every failure.
  switch (code) {
    case 'content_policy':
      return {
        headline: 'The video provider blocked this look.',
        hint: 'Most often this is a recognisable celebrity or public figure in the photo - try a different selfie. Other triggers: photos of minors, brand logos prominently in frame, or NSFW content.',
      };
    case 'no_face_detected':
      return {
        headline: 'No face detected in the reference photo.',
        hint: 'Try a clearer, front-facing selfie with good lighting.',
      };
    case 'invalid_image':
      return {
        headline: 'A reference photo couldn’t be read.',
        hint: 'Re-upload as JPEG or PNG.',
      };
    case 'timeout':
      return { headline: 'The video provider timed out.', hint: 'Please try again.' };
    case 'rate_limit':
      return { headline: 'Rate limit hit.', hint: 'Try again in a minute.' };
    case 'face_rehost_failed':
      return {
        headline: 'Reference photos couldn’t be loaded.',
        hint: 'Re-upload your face photo and try again.',
      };
    case 'fal_submit_error':
      return {
        headline: 'The video provider rejected the request.',
        hint: 'See details below - usually fixed by re-uploading the photo or picking fewer products.',
      };
  }
  // Legacy fallback for rows from before error_code existed.
  const text = (raw || '').toLowerCase();
  if (text.includes('partner_validation_failed') || text.includes('content_policy')) {
    return {
      headline: 'The video provider blocked this look.',
      hint: 'Most often this is a recognisable celebrity in the photo - try a different selfie. Other triggers: minors, brand logos in frame, or NSFW content.',
    };
  }
  if (text.includes('heic')) {
    return { headline: 'Photo format not supported.', hint: 'Please re-upload as JPEG or PNG.' };
  }
  if (text.includes('all reference photos failed')) {
    return {
      headline: 'Reference photos couldn’t be loaded.',
      hint: 'Re-upload your face photo and try again.',
    };
  }
  if (text.includes('fal_key')) {
    return { headline: 'Server config error.', hint: 'The Fal API key is missing on the server. Contact support.' };
  }
  return { headline: 'Something went wrong while generating this look.', hint: null };
}

function GenerationErrorBox({
  generation,
  pickedCount,
  faceCount,
}: {
  generation: UserGeneration;
  pickedCount: number;
  faceCount: number;
}) {
  const [showDetails, setShowDetails] = useState(false);
  const [copied, setCopied] = useState(false);
  const { headline, hint } = summarizeGenerationError(generation.error || '', generation.error_code);

  const diagnostics = {
    generation_id: generation.id,
    fal_request_id: generation.fal_request_id || null,
    veo_model: generation.veo_model || null,
    error_code: generation.error_code || null,
    error_raw: generation.error_raw || null,
    style: generation.style,
    height_label: generation.height_label,
    age_label: generation.age_label,
    duration_seconds: generation.duration_seconds,
    face_photos: faceCount,
    products_picked: pickedCount,
    created_at: generation.created_at,
    completed_at: generation.completed_at,
    error: generation.error || 'Unknown',
    user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
  };

  const copyText = Object.entries(diagnostics)
    .map(([k, v]) => `${k}: ${v ?? '-'}`)
    .join('\n');

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(copyText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2200);
    } catch {
      // Fallback: legacy execCommand path. Older iOS Safari in the
      // shell webview sometimes blocks clipboard.writeText without a
      // user-gesture marker even though we are inside one.
      try {
        const ta = document.createElement('textarea');
        ta.value = copyText;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2200);
      } catch { /* give up silently */ }
    }
  };

  return (
    <div className="gen-error" role="alert">
      <div className="gen-error-summary">{headline}</div>
      {hint && <div>{hint}</div>}
      <div className="gen-error-actions">
        <button type="button" className="gen-error-btn" onClick={() => setShowDetails(s => !s)}>
          {showDetails ? 'Hide details' : 'Show details'}
        </button>
        <button type="button" className="gen-error-btn" onClick={handleCopy}>
          {copied ? 'Copied' : 'Copy details'}
        </button>
      </div>
      {/* Build stamp so a stale-cache device is obvious at a glance.
          If this string isn't present, you're running an older bundle
          and a hard reload (or App swipe-up + relaunch in the Flutter
          shell) will pick up the new code. */}
      <div className="gen-error-build">build: error-ui v2</div>
      {showDetails && (
        <div className="gen-error-details">
          <dl>
            {Object.entries(diagnostics).map(([k, v]) => (
              <span key={k}>
                <dt>{k}</dt>
                <dd>{String(v ?? '-')}</dd>
              </span>
            ))}
          </dl>
        </div>
      )}
    </div>
  );
}

function GenerationProgress({ generation, images }: { generation: UserGeneration; images: string[] }) {
  // Tick four times a second so the border-progress + phase rotation
  // feel alive between polls.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 250);
    return () => clearInterval(id);
  }, []);

  // Crank the shared particle field while the look is building — the
  // singleton canvas reads particleControls.speed every frame, and we
  // mount a local ParticleBackground below so the field is visible on
  // this screen regardless of route. Restore on unmount. (Same pattern
  // as AddProductV2 / SearchCeremony.)
  useEffect(() => {
    const prev = particleControls.speed;
    particleControls.speed = 5;
    return () => { particleControls.speed = prev; };
  }, []);

  // Jokes ticker — rotate a playful "analyzing" line every ~3.4s,
  // independent of the phase label so something is always in motion.
  const [jokeIdx, setJokeIdx] = useState(() => Math.floor(Math.random() * BUILD_JOKES.length));
  useEffect(() => {
    const id = setInterval(() => setJokeIdx(i => (i + 1) % BUILD_JOKES.length), 3400);
    return () => clearInterval(id);
  }, []);

  const startedAt = useMemo(() => new Date(generation.created_at).getTime(), [generation.created_at]);
  const elapsedSec = Math.max(0, (Date.now() - startedAt) / 1000);
  const typicalSec = typicalSecondsFor(generation.duration_seconds);
  // Linear up to 95% across the typical budget; soft asymptote past that
  // so users never see a static 100% bar while we're still polling Fal.
  const linearPct = (elapsedSec / typicalSec) * 95;
  const overflowPct = elapsedSec > typicalSec
    ? 95 + (1 - Math.exp(-(elapsedSec - typicalSec) / 60)) * 4.5
    : linearPct;
  const pct = Math.min(99.5, Math.max(2, overflowPct));

  // Phase index - 0..9. We pace it slightly behind raw % so the
  // current label feels like it's still working when the bar is at
  // its boundary, instead of jumping ahead instantly.
  const phaseIdx = Math.min(
    BUILD_PHASES.length - 1,
    Math.floor((pct / 100) * BUILD_PHASES.length),
  );
  const activePhase = BUILD_PHASES[phaseIdx];

  const remaining = Math.max(0, Math.round(typicalSec - elapsedSec));
  const subLabel = remaining > 0
    ? `About ${remaining}s left`
    : 'Almost there…';

  return (
    <div
      className="gen-build gen-build-v2"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      aria-label={`Generating - ${activePhase}`}
    >
      <div className="gen-build-particles" aria-hidden="true">
        <ParticleBackground />
      </div>

      {/* Frameless generating stage: the face + product circles (flowed in
          from the review screen) orbit inside a soft glow halo over the
          particle field — no phone frame. */}
      <div className="gen-build-stage">
        <div className="gen-build-halo" aria-hidden="true" />
        {images.length > 0 && (
          <div className="gen-orbit" aria-hidden="true">
            <div className="gen-orbit-ring" style={{ ['--n' as string]: images.length }}>
              {images.map((src, i) => (
                <span key={`${src}-${i}`} className="gen-orbit-item" style={{ ['--i' as string]: i }}>
                  <img src={src} alt="" loading="lazy" decoding="async" />
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="gen-build-meta">
          <div className="gen-build-phase">{activePhase}</div>
          <div key={jokeIdx} className="gen-build-joke">{BUILD_JOKES[jokeIdx]}</div>
          <div className="gen-build-bar" aria-hidden="true">
            <div className="gen-build-bar-fill" style={{ width: `${pct}%` }} />
          </div>
          <div className="gen-build-sub">{subLabel} &middot; {Math.round(pct)}%</div>
        </div>
      </div>
    </div>
  );
}

/**
 * Build the CSS transform that applies a saved crop to a 9:16 video.
 * The video sits inside a fixed-aspect frame with overflow hidden;
 * we scale up by `crop_scale` and translate by the saved x/y. Pan is
 * normalized -1..1 → percentage of the post-scale extra width/height
 * the video can offer (e.g. scale=2 lets you pan up to ±50%).
 */
function cropTransformStyle(
  gen: { crop_scale?: number | null; crop_x?: number | null; crop_y?: number | null } | null | undefined,
): React.CSSProperties {
  const scale = Math.max(1, Math.min(4, gen?.crop_scale ?? 1));
  const x = Math.max(-1, Math.min(1, gen?.crop_x ?? 0));
  const y = Math.max(-1, Math.min(1, gen?.crop_y ?? 0));
  if (scale === 1 && x === 0 && y === 0) return {};
  // ((scale - 1) / 2) is the slack on each side after scaling, in
  // post-scale pixels. We translate the video before the scale so
  // the math reads as a fraction of the original viewport.
  const slack = (scale - 1) / 2;
  const tx = x * slack * 100; // %
  const ty = y * slack * 100; // %
  return {
    transform: `scale(${scale}) translate(${tx}%, ${ty}%)`,
    transformOrigin: 'center center',
  };
}

interface Crop { scale: number; x: number; y: number }

/**
 * ExportShareModal - opens after the user taps Export. Shows a copy-
 * link affordance with the public /s/:slug URL, plus a small status
 * line that flips from "Watermarking..." to "Ready" once the Modal
 * worker finishes baking the wordmark onto the video. The native
 * share sheet button uses navigator.share when available and falls
 * back to copy-to-clipboard.
 */
function ExportShareModal({
  share,
  slug,
  submitting,
  error,
  onClose,
}: {
  share: LookShare | null;
  slug: string | null;
  submitting: boolean;
  error: string | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const url = slug ? shareUrlFor(slug) : '';
  const isReady = share?.status === 'done' && !!share?.watermarked_video_url;
  const isFailed = share?.status === 'failed';

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleCopy = useCallback(async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard API gated on https in some browsers - silently fail */
    }
  }, [url]);

  const handleNativeShare = useCallback(async () => {
    if (!url) return;
    const nav = navigator as Navigator & { share?: (data: ShareData) => Promise<void> };
    if (nav.share) {
      try {
        await nav.share({
          title: 'My Catalog look',
          text: 'Made with Catalog',
          url,
        });
        return;
      } catch {
        /* user cancelled - fall through to copy */
      }
    }
    await handleCopy();
  }, [url, handleCopy]);

  return (
    <div className="gen-modal-backdrop" onClick={onClose}>
      <div className="gen-modal gen-export-modal" onClick={(e) => e.stopPropagation()}>
        <div className="gen-modal-head">
          <div>
            <h2 className="gen-modal-title">Export this look</h2>
            <p className="gen-modal-sub">
              Share a public link to this look. The Catalog wordmark is
              baked onto the video so it travels with every save and re-share.
            </p>
          </div>
          <button className="gen-modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="gen-export-body">
          {error && <div className="gen-error">{error}</div>}

          {!error && (
            <>
              <div className="gen-export-status">
                {submitting && <span>Creating share…</span>}
                {!submitting && share && !isReady && !isFailed && (
                  <span>
                    <span className="gen-export-spinner" aria-hidden="true" />
                    Watermarking your video…
                  </span>
                )}
                {!submitting && isReady && <span className="gen-export-status-done">Ready to share</span>}
                {!submitting && isFailed && (
                  <span className="gen-export-status-failed">
                    Watermark failed{share?.error ? `: ${share.error}` : '.'} You can still share the link below.
                  </span>
                )}
              </div>

              {url && (
                <>
                  <div className="gen-export-link" role="region" aria-label="Share link">
                    <input
                      type="text"
                      readOnly
                      value={url}
                      onFocus={(e) => e.currentTarget.select()}
                      className="gen-export-link-input"
                    />
                    <button
                      type="button"
                      className="gen-export-link-copy"
                      onClick={handleCopy}
                    >
                      {copied ? 'Copied' : 'Copy'}
                    </button>
                  </div>

                  <div className="gen-export-actions">
                    <button
                      type="button"
                      className="gen-btn-primary"
                      onClick={handleNativeShare}
                    >
                      Share link
                    </button>
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="gen-btn-secondary gen-export-open"
                    >
                      Open
                    </a>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * CropModal - drag to pan + slider to zoom. Output stays 9:16 (the
 * source video aspect). Save writes scale/x/y on the row; we don't
 * re-encode the video so the change is instant.
 */
function CropModal({
  videoUrl,
  initial,
  onClose,
  onSave,
}: {
  videoUrl: string;
  initial: Crop;
  onClose: () => void;
  onSave: (crop: Crop) => void;
}) {
  const [scale, setScale] = useState<number>(initial.scale ?? 1);
  const [x, setX] = useState<number>(initial.x ?? 0);
  const [y, setY] = useState<number>(initial.y ?? 0);
  const dragRef = useRef<{ startX: number; startY: number; startCx: number; startCy: number; rect: DOMRect } | null>(null);

  // Close on Escape so the modal feels like a normal dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Clamp pan whenever scale changes - at scale=1 there's no slack
  // to pan into, so we snap x/y back to 0.
  useEffect(() => {
    if (scale <= 1) {
      if (x !== 0) setX(0);
      if (y !== 0) setY(0);
    }
  }, [scale, x, y]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (scale <= 1) return;
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    const rect = e.currentTarget.getBoundingClientRect();
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startCx: x,
      startCy: y,
      rect,
    };
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    const { startX, startY, startCx, startCy, rect } = dragRef.current;
    // Pixels of pan / pixels of slack -> normalized -1..1.
    const slackPxX = (rect.width  * (scale - 1)) / 2;
    const slackPxY = (rect.height * (scale - 1)) / 2;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    const nx = slackPxX > 0 ? Math.max(-1, Math.min(1, startCx + dx / slackPxX)) : 0;
    const ny = slackPxY > 0 ? Math.max(-1, Math.min(1, startCy + dy / slackPxY)) : 0;
    setX(nx);
    setY(ny);
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    try { (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  };

  const reset = () => { setScale(1); setX(0); setY(0); };

  const transform = cropTransformStyle({ crop_scale: scale, crop_x: x, crop_y: y });

  return (
    <div className="gen-modal-backdrop" onClick={onClose}>
      <div
        className="gen-modal gen-crop-modal"
        role="dialog"
        aria-label="Crop your look"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="gen-modal-head">
          <div>
            <h3 className="gen-modal-title">Crop your look</h3>
            <p className="gen-modal-sub">Drag to pan. Use the slider to zoom in.</p>
          </div>
          <button type="button" className="gen-modal-close" onClick={onClose} aria-label="Close">×</button>
        </header>

        <div className="gen-crop-stage">
          <div
            className="gen-crop-frame"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            style={{ cursor: scale > 1 ? 'grab' : 'default' }}
          >
            <video
              src={videoUrl}
              autoPlay
              loop
              muted
              playsInline
              className="gen-crop-video"
              style={transform}
            />
          </div>
        </div>

        <div className="gen-crop-controls">
          <label className="gen-crop-zoom">
            <span>Zoom</span>
            <input
              type="range"
              min={1}
              max={3}
              step={0.05}
              value={scale}
              onChange={(e) => setScale(parseFloat(e.target.value))}
            />
            <span className="gen-crop-zoom-val">{scale.toFixed(2)}×</span>
          </label>
          <div className="gen-crop-actions">
            <button type="button" className="gen-btn-secondary" onClick={reset}>Reset</button>
            <button type="button" className="gen-btn-primary" onClick={() => onSave({ scale, x, y })}>Save</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// memo'd so a parent re-render (e.g. a keystroke in the prompt field on
// the same screen) does not re-render every row in the looks grid. The
// id-based callback signatures let the parent hand down stable refs;
// without that, inline `() => onDelete(g.id)` arrows would defeat memo
// on every render even when `generation` itself is unchanged.
const LookCard = memo(function LookCard({
  generation,
  onOpen,
  onRegenerate,
  onDelete,
}: {
  generation: UserGeneration;
  onOpen: (g: UserGeneration) => void;
  onRegenerate: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const style = STYLE_PRESETS.find(s => s.value === generation.style);
  const isDone = generation.status === 'done' && generation.video_url;
  const startedAt = useMemo(() => new Date(generation.created_at).getTime(), [generation.created_at]);
  // A row stuck non-terminal far past any real render budget is dead —
  // the generate-look pipeline never reconciled it. Treat it as failed
  // ("Timed out") so it stops showing "Queued / 100%" forever and the
  // delete button works. Mirrors PendingLookPill's staleness guard.
  const isStale = (generation.status === 'pending' || generation.status === 'generating')
    && (Date.now() - startedAt) > GENERATION_STALE_MS;
  const isFailed = generation.status === 'failed' || isStale;
  const isBusy = (generation.status === 'pending' || generation.status === 'generating') && !isStale;

  // Tick once a second while the row is in flight so the mini border
  // progress + phase label stay live on the grid card. We only run
  // the timer for busy items so done/failed/stale cards stay still.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!isBusy) return;
    const id = window.setInterval(() => setTick(t => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [isBusy]);

  const elapsedSec = Math.max(0, (Date.now() - startedAt) / 1000);
  const typicalSec = typicalSecondsFor(generation.duration_seconds);
  const linearPct = (elapsedSec / typicalSec) * 95;
  const overflowPct = elapsedSec > typicalSec
    ? 95 + (1 - Math.exp(-(elapsedSec - typicalSec) / 60)) * 4.5
    : linearPct;
  const pct = Math.min(99.5, Math.max(2, overflowPct));
  const phaseIdx = Math.min(
    BUILD_PHASES.length - 1,
    Math.floor((pct / 100) * BUILD_PHASES.length),
  );

  return (
    <div className="gen-lookcard">
      <div className="gen-lookcard-media-wrap" style={{ position: 'relative' }}>
        <button type="button" className="gen-lookcard-media" onClick={() => onOpen(generation)}>
          {isDone && generation.video_url ? (
            <video
              src={generation.video_url}
              autoPlay
              loop
              muted
              playsInline
              preload="auto"
              style={cropTransformStyle(generation)}
            />
          ) : (
            <div className={`gen-lookcard-placeholder${isFailed ? ' is-failed' : ''}`}>
              {isBusy && (
                <>
                  <div className="gen-lookcard-busy is-busy" aria-hidden="true" />
                  <div className="gen-lookcard-pulse" aria-hidden="true" />
                  <svg className="gen-lookcard-border" viewBox="0 0 90 160" preserveAspectRatio="none" aria-hidden="true">
                    <rect className="gen-build-track" x="1" y="1" width="88" height="158" rx="6" ry="6" pathLength={100} />
                    <rect className="gen-build-fill" x="1" y="1" width="88" height="158" rx="6" ry="6" pathLength={100} strokeDasharray={`${pct} 100`} />
                  </svg>
                  <span className="gen-lookcard-phase">{BUILD_PHASES[phaseIdx]}</span>
                  <span className="gen-lookcard-pct">{Math.round(pct)}%</span>
                </>
              )}
              {isFailed && <span>{isStale ? 'Timed out' : 'Failed'}</span>}
            </div>
          )}
          {isBusy && <span className="gen-lookcard-chip">{generation.status === 'pending' ? 'Queued' : 'Generating'}</span>}
        </button>
        <button
          type="button"
          className="gen-lookcard-delete"
          onClick={(e) => {
            e.stopPropagation();
            setConfirmOpen(true);
          }}
          aria-label="Delete look"
          title="Delete look"
        >×</button>
        <ConfirmModal
          open={confirmOpen}
          title="Delete this look?"
          body="This can’t be undone."
          confirmLabel="Delete"
          destructive
          onConfirm={() => { setConfirmOpen(false); onDelete(generation.id); }}
          onCancel={() => setConfirmOpen(false)}
        />
      </div>
      <div className="gen-lookcard-foot">
        <span className="gen-lookcard-label">{generation.display_name || style?.label || generation.style}</span>
        <button
          type="button"
          className="gen-lookcard-regen"
          onClick={() => onRegenerate(generation.id)}
          aria-label="Edit and regenerate"
          title="Edit & regenerate"
        >↻</button>
      </div>
    </div>
  );
});

function UploadPickerModal({
  slot,
  uploads,
  pickedIds,
  currentSlotId,
  onClose,
  onPick,
  onDelete,
  onUploadNew,
}: {
  slot: number;
  uploads: UserUpload[];
  pickedIds: string[];
  currentSlotId: string | null;
  onClose: () => void;
  onPick: (id: string) => void;
  onDelete: (upload: UserUpload) => void;
  onUploadNew: () => void;
}) {
  // Close on Escape so the modal feels like a normal dialog.
  // Per-thumbnail confirm state. We hold the upload object while the
  // user decides so the inner ConfirmModal can show "Delete this
  // upload?" without us having to re-find the upload by id.
  const [pendingDelete, setPendingDelete] = useState<UserUpload | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="gen-modal-backdrop" onClick={onClose}>
      <div
        className="gen-modal"
        role="dialog"
        aria-label={`Choose photo for slot ${slot + 1}`}
        onClick={(e) => e.stopPropagation()}
      >
        <ConfirmModal
          open={!!pendingDelete}
          title="Delete this upload?"
          body="It will be removed from your photo library."
          confirmLabel="Delete"
          destructive
          onConfirm={() => {
            const u = pendingDelete;
            setPendingDelete(null);
            if (u) onDelete(u);
          }}
          onCancel={() => setPendingDelete(null)}
        />
        <header className="gen-modal-head">
          <div>
            <h3 className="gen-modal-title">Choose a photo</h3>
            <p className="gen-modal-sub">Tap a photo to drop it into Photo {slot + 1}, or upload a new one.</p>
          </div>
          <button
            type="button"
            className="gen-modal-close"
            onClick={onClose}
            aria-label="Close"
          >×</button>
        </header>

        <button
          type="button"
          className="gen-modal-upload"
          onClick={onUploadNew}
        >
          <span className="gen-slot-plus">+</span>
          Upload new photo
        </button>

        {uploads.length === 0 ? (
          <div className="gen-empty">No uploads yet - tap above to add one.</div>
        ) : (
          <div className="gen-modal-grid">
            {uploads.map(u => {
              const isCurrent = u.id === currentSlotId;
              const inOther = pickedIds.includes(u.id) && !isCurrent;
              return (
                <div key={u.id} className={`gen-modal-thumb${isCurrent ? ' is-picked' : ''}${inOther ? ' is-inuse' : ''}`}>
                  <button
                    type="button"
                    className="gen-modal-thumb-pick"
                    onClick={() => onPick(u.id)}
                    aria-label={isCurrent ? 'Currently picked' : 'Pick this photo'}
                  >
                    <img src={u.public_url} alt="" />
                    {isCurrent && <span className="gen-thumb-check">✓</span>}
                    {inOther && <span className="gen-modal-thumb-badge">In use</span>}
                  </button>
                  <button
                    type="button"
                    className="gen-modal-thumb-del"
                    onClick={(e) => {
                      e.stopPropagation();
                      setPendingDelete(u);
                    }}
                    aria-label="Delete photo"
                    title="Delete photo"
                  >×</button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function StepRail({
  step, photosCount, productsCount, style, embedded = false,
}: {
  step: Step;
  photosCount: number;
  productsCount: number;
  style: string;
  /** When true, the rail is being rendered as a row inside the unified
   *  gen-dock - drop the fixed positioning + glass background since
   *  the dock supplies both. */
  embedded?: boolean;
}) {
  const filled = {
    photos: photosCount > 0,
    products: productsCount > 0,
    style: !!style,
    review: false,
    result: false,
  } as Record<Step, boolean>;
  const items: { k: Step; label: string }[] = [
    { k: 'photos',   label: 'Photos' },
    { k: 'products', label: 'Products' },
    { k: 'style',    label: 'Style' },
    { k: 'review',   label: 'Review' },
  ];
  const activeIdx = STEP_ORDER.indexOf(step);
  return (
    <nav className={`gen-rail${embedded ? ' is-embedded' : ''}`} aria-label="Generate steps">
      <ol className="gen-rail-glass">
        {items.map((item, i) => {
          const cls =
            i === activeIdx ? 'is-active' :
            filled[item.k] ? 'is-done' : '';
          return (
            <li key={item.k} className={`gen-rail-item ${cls}`}>
              <span className="gen-rail-num">
                {filled[item.k] && i !== activeIdx ? '✓' : i + 1}
              </span>
              <span className="gen-rail-label">{item.label}</span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
