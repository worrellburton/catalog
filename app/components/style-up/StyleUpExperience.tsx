// Style Up, AI stylist chat, a consumer app feature. A shopper requests a
// stylist from the roster, then chats iMessage-style; the stylist (AI) sends
// product picks + on-you renders. The shopper's AI-look context rides at the
// top, read-only, so the stylist always sees who it's styling.
//
// Full-screen consumer page (dark). Roster → open/resume a thread → context
// card + live message list + composer. The AI stylist replies (style-up-chat
// edge fn), product picks, and "see it on me" renders (generate-look pipeline)
// stream in via realtime.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from '@remix-run/react';
import { useAuth } from '~/hooks/useAuth';
import { useStylistEngineMethod } from '~/hooks/useStylistEngineMethod';
import { supabase } from '~/utils/supabase';
import {
  fetchStylists, getOrCreateThread, deleteThread, getThreadHunting, getLatestThread, fetchMyThreads, fetchMessages, sendShopperMessage,
  sendStylistText, startFullLookRender, fetchSwapOptions, sendSwapOptions,
  sendChooser, recommendForSlot, sendProductPick,
  webFetchSwapOptions, webRecommendForSlot,
  type StyleUpStylist, type StyleUpMessage, type StyleUpProductRef, type StyleUpThreadSummary, type RecommendOpts,
} from '~/services/style-up';
import { roleTagFromName } from '~/services/product-roles';
import { signInWithGoogle } from '~/services/auth';
import StyleUpBackground from './StyleUpBackground';
import CatalogLogo from '~/components/CatalogLogo';

// Preferences the stylist infers from chat, budget, occasion, formality lean,
// dropped colors, simplicity, applied to every recommendation (#4/#6/#7).
interface StylePrefs {
  budgetMax: number | null;
  occasion: string | null;
  formality: 'dressier' | 'casual' | null;
  avoidColors: string[];
  simpler: boolean;
}
const EMPTY_PREFS: StylePrefs = { budgetMax: null, occasion: null, formality: null, avoidColors: [], simpler: false };
const COLORS = ['black', 'white', 'blue', 'navy', 'red', 'green', 'beige', 'tan', 'brown', 'grey', 'gray', 'pink', 'purple', 'orange', 'yellow', 'khaki', 'cream', 'olive'];

/** Fold a shopper message into the running preferences. */
function applyPrefs(prev: StylePrefs, text: string): StylePrefs {
  const t = text.toLowerCase();
  const p: StylePrefs = { ...prev, avoidColors: [...prev.avoidColors] };
  const bm = t.match(/(?:under|below|less than|max|budget(?: of)?|keep it (?:under|below))\s*\$?\s*(\d{2,4})/) || t.match(/\$\s*(\d{2,4})\b/);
  if (bm) p.budgetMax = parseInt(bm[1], 10);
  const occ = t.match(/\b(date night|date|wedding|interview|work|office|brunch|party|night out|dinner|gym|travel|vacation|festival|concert|beach|graduation|reunion|funeral)\b/);
  if (occ) p.occasion = occ[1];
  if (/\b(more casual|casual|chill|relaxed|laid.?back|dress.?down|comfy)\b/.test(t)) p.formality = 'casual';
  if (/\b(dressier|dress.?up|fancier|more formal|formal|elevated|sharper|classy|smart)\b/.test(t)) p.formality = 'dressier';
  if (/\b(simpler|less flashy|minimal|clean|understated|tone.? down|subtle|plain)\b/.test(t)) p.simpler = true;
  if (/\b(bolder|louder|more fun|flashy|statement|stand out)\b/.test(t)) p.simpler = false;
  for (const c of COLORS) {
    if (new RegExp(`\\b(?:no|not|hate|avoid|don'?t (?:like|want)|less)\\s+(?:the\\s+)?${c}\\b`).test(t) && !p.avoidColors.includes(c)) {
      p.avoidColors = [...p.avoidColors, c];
    }
  }
  return p;
}
import { getUserHeightAge, getUserCustomStyle, updateUserHeightAge, updateUserCustomStyle } from '~/services/profiles';
import { getUserGender, updateUserGender, type UserGender } from '~/services/genders';
import {
  listUserUploads, getUserSlots, saveUserSlots, uploadUserPhoto, getGeneration,
  type UserGeneration,
} from '~/services/user-generations';
import { promoteGenerationToLook } from '~/services/promote-generation';
import { generationProgress } from '~/services/generation-progress';
import { productSlug } from '~/utils/slug';
import '~/styles/style-up.css';
import '~/styles/style-up-lookbar.css';

/** "~2 min left" / "~40s left", estimated wait from the shared generation
 *  timing model (based on typical generation durations). */
function fmtRemaining(sec: number): string {
  if (sec <= 0) return 'almost done…';
  if (sec < 60) return `~${sec}s left`;
  return `~${Math.ceil(sec / 60)} min left`;
}

/** Does this shopper message read as "put the whole look on me"? Detected
 *  client-side so the existing generate-look pipeline can fire without waiting
 *  on the AI turn (and without it claiming it "can't generate photos"). */
function wantsFullLook(text: string): boolean {
  const t = text.toLowerCase();
  const onMe = /\bon me\b|\bon myself\b|\bon my body\b/.test(t);
  const lookWord = /\b(look|outfit|fit|ensemble|whole thing|all of (it|this|these|them)|these|this|it|them)\b/.test(t);
  const verb = /\b(generate|make|create|show|see|put|try|render|build|style|dress|model)\b/.test(t);
  if (onMe && lookWord) return true;
  if (verb && /\b(whole|full|entire|complete)\b[^.?!]*\b(look|outfit|fit)\b/.test(t)) return true;
  if (/\b(generate|make|create|build|render|show)\b[^.?!]*\b(the|this|that|a|my|your)\b[^.?!]*\b(look|outfit|fit)\b/.test(t)) return true;
  if (/\b(show me|let me see|can i see)\b[^.?!]*\b(look|outfit|fit|it|them|this)\b/.test(t)) return true;
  if (/\bput (it|them|this|that) on me\b|\bmodel (it|them|this)\b|\bhow (would|do) i look\b/.test(t)) return true;
  return false;
}

/** Does this message ask to swap one slot ("try different pants")? Returns the
 *  target role (ROLE_TAG) + a friendly label, or null. */
function swapTargetFromText(text: string): { role: string; label: string } | null {
  const t = text.toLowerCase();
  const change = /\b(different|another|other|swap|change|switch|new|alternativ\w*|else|instead|try|replace|lose|ditch|drop|remove|hate|not feeling|don'?t like)\b/.test(t);
  if (!change) return null;
  if (/\b(pant|pants|trouser|trousers|jean|jeans|denim|chino|chinos|bottom|bottoms|slacks|short|shorts)\b/.test(t)) return { role: 'Pants', label: 'pants' };
  if (/\b(shoe|shoes|sneaker|sneakers|boot|boots|loafer|loafers|footwear|heel|heels|sandal|sandals|trainer|trainers)\b/.test(t)) return { role: 'Shoes', label: 'shoes' };
  if (/\b(jacket|jackets|coat|coats|blazer|blazers|outerwear|parka|overcoat|bomber)\b/.test(t)) return { role: 'Jacket', label: 'jacket' };
  if (/\b(top|tops|shirt|shirts|tee|tees|t-shirt|tshirt|sweater|sweaters|knit|polo|blouse|sweatshirt|henley)\b/.test(t)) return { role: 'Top', label: 'top' };
  if (/\b(dress|dresses|gown)\b/.test(t)) return { role: 'Dress', label: 'dress' };
  if (/\b(hat|hats|cap|caps|beanie)\b/.test(t)) return { role: 'Hat', label: 'hat' };
  if (/\b(bag|bags|tote|backpack|purse|handbag)\b/.test(t)) return { role: 'Bag', label: 'bag' };
  if (/\b(sunglass\w*|shades|eyewear)\b/.test(t)) return { role: 'Sunglasses', label: 'sunglasses' };
  if (/\b(watch|jewelry|jewellery|necklace|bracelet|ring|earring|earrings)\b/.test(t)) return { role: 'Jewelry', label: 'jewelry' };
  return null;
}

/** The stylist's warm description + feedback prompt once the look is rendered. */
function describeLook(products: StyleUpProductRef[]): string {
  const names = products.map(p => p.brand || p.name).filter(Boolean).slice(0, 4) as string[];
  const list = names.length ? names.join(', ') : 'the pieces we picked';
  return `Here's the full look on you, ${list}. I kept it cohesive and true to your vibe. How do you like it? Want to adjust anything, different pants, a fresh top, another shoe? Just say the word and I'll swap it.`;
}

/** Does this read as "build me a full OUTFIT" (multi-slot) vs "see it on me"?
 *  The outfit ask kicks off the guided chooser flow; "see it" just renders. */
function wantsFullOutfit(text: string): boolean {
  const t = text.toLowerCase();
  const withFull = /\bwith (a |an )?(full|whole|complete|entire) (outfit|look|fit)\b/.test(t);
  const outfit = /\b(outfit|ensemble|full fit|whole fit)\b/.test(t);
  const build = /\b(build|put together|style me|dress me|make me|create|complete|full|whole|entire)\b/.test(t);
  return withFull || (outfit && build);
}

// A human "reading" beat before the stylist responds, always at least 1s,
// randomized to exactly 1 / 2 / 3s and unique to each response, so replies feel
// considered rather than instant.
const TYPING_BEATS = [1000, 2000, 3000];
function stylistBeat(): Promise<void> {
  const ms = TYPING_BEATS[Math.floor(Math.random() * TYPING_BEATS.length)];
  return new Promise((r) => setTimeout(r, ms));
}

// Cycling status lines for the "putting pieces together" module, playful
// stylist humor (NEVER anything that hints pieces come from anywhere external).
const HUNT_PHRASES = [
  'Consulting the style gods…',
  'Raiding the dream closet…',
  'Doing a little fashion math…',
  'Channeling main-character energy…',
  'Steaming out the wrinkles…',
  'Negotiating with the fashion police…',
  'Measuring twice, styling once…',
  'Trusting the process…',
  'Pretending this is effortless…',
];


const SLOT_LABEL: Record<string, string> = { Top: 'Top', Pants: 'Pants / Shorts', Jacket: 'Jacket', Hat: 'Hat', Shoes: 'Shoes' };

// Scene options for "where do you want to be seen?", Clean studio is always
// first, then two fun spots, and the 4th is always a little wild.
const FUN_SCENES = ['a cozy coffee shop', 'a rooftop at golden hour', 'a city street at night', 'a sunny park', 'a minimalist loft', 'an art gallery', 'a jazz bar', 'a boardwalk by the sea', 'a sidewalk café in Paris'];
const WILD_SCENES = ['a neon Tokyo alley in the rain', 'the surface of Mars', 'a 1970s disco', 'backstage at a runway show', 'a snowy mountain peak', 'an underwater glass tunnel', 'a desert at sunset'];
function sceneOptions(): Array<{ value: string; label: string }> {
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  // 1) Studio, 2) Outdoor coffee shop (both fixed), 3) a fresh spot each time,
  // 4) something wild.
  const fun = FUN_SCENES.filter(s => !s.includes('coffee')).sort(() => Math.random() - 0.5)[0] ?? 'a sunny park';
  const wild = WILD_SCENES[Math.floor(Math.random() * WILD_SCENES.length)];
  return [
    { value: 'a clean studio', label: 'Studio' },
    { value: 'an outdoor coffee shop', label: 'Outdoor coffee shop' },
    { value: fun, label: cap(fun) },
    { value: wild, label: `${cap(wild)} 🤯` },
  ];
}

/** A tap-chooser bubble, single-tap dispatches; multi-select toggles + a
 *  confirm. Used for "which shoes?" and "what do you want in the outfit?". */
function ChooserBubble({ choose, disabled, onSubmit }: {
  choose: NonNullable<StyleUpProductRef['choose']>;
  disabled: boolean;
  onSubmit: (values: string[]) => void;
}) {
  const [sel, setSel] = useState<string[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const multi = !!choose.multi;
  const hasCards = choose.options.some(o => o.image);
  const submit = (vals: string[]) => { if (submitted || vals.length === 0) return; setSubmitted(true); onSubmit(vals); };
  const toggle = (v: string) => setSel(prev => prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v]);
  return (
    <div className="su-msg su-msg--stylist">
      <div className="su-choose">
        <div className="su-choose-prompt">{choose.prompt}</div>
        <div className={`su-choose-options${hasCards ? ' su-choose-options--cards' : ''}`}>
          {choose.options.map(o => {
            const on = sel.includes(o.value);
            return (
              <button
                key={o.value}
                type="button"
                className={`su-choose-opt${o.image ? ' su-choose-opt--card' : ''}${on ? ' is-on' : ''}`}
                disabled={disabled || submitted}
                onClick={() => (multi ? toggle(o.value) : submit([o.value]))}
              >
                {o.image && <span className="su-choose-opt-media"><img src={o.image} alt="" loading="lazy" /></span>}
                <span className="su-choose-opt-label">{o.label}</span>
              </button>
            );
          })}
        </div>
        {multi && (
          <button type="button" className="su-choose-go" disabled={disabled || submitted || sel.length === 0} onClick={() => submit(sel)}>
            {submitted ? 'Done' : 'Recommend these'}
          </button>
        )}
      </div>
    </div>
  );
}

const MAX_PHOTOS = 3;

interface ShopperContext {
  photos: (string | null)[];  // resolved URL per slot (null = empty), length MAX_PHOTOS
  slots: (string | null)[];   // upload id per slot (length MAX_PHOTOS)
  heightLabel: string;
  weightLabel: string;
  ageLabel: string;
  gender: UserGender;
  style: string;
  chips: string[];
}

/** A stylist's avatar contents: their real photo when we have one, otherwise a
 *  clean line-art portrait (a croquis bust) — never bare initials. Sits inside a
 *  `.su-stylist-avatar` (accent background), so the line inherits the dark ink. */
function StylistFace({ avatarUrl, name }: { avatarUrl: string | null; name?: string }) {
  if (avatarUrl) return <img src={avatarUrl} alt={name ?? ''} loading="lazy" />;
  return (
    <svg className="su-avatar-illus" viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="20" cy="15.5" r="6.4" />
      <path d="M13.6 12.6c.6-4.4 3.5-6.8 6.4-6.8s5.8 2.4 6.4 6.8" />
      <path d="M8.5 34c0-6.3 5.2-10.2 11.5-10.2S31.5 27.7 31.5 34" />
    </svg>
  );
}

// Per-thread "last seen" marker (localStorage), so the conversations list can
// flag a thread that has a newer stylist message than the shopper has opened.
const SEEN_PREFIX = 'styleup:seen:';
function markThreadSeen(threadId: string): void {
  try { localStorage.setItem(SEEN_PREFIX + threadId, String(Date.now())); } catch { /* ignore */ }
}
function threadHasNews(t: StyleUpThreadSummary): boolean {
  if (!t.lastMessageAt) return false;
  // The shopper sent the last message → nothing new for them to read.
  if (t.lastMessage && t.lastMessage.startsWith('You: ')) return false;
  try {
    const seen = localStorage.getItem(SEEN_PREFIX + t.threadId);
    if (!seen) return true;
    return new Date(t.lastMessageAt).getTime() > Number(seen);
  } catch { return false; }
}

/** Compact relative time for the conversation list (now / 3h / 2d / Jun 8). */
function relativeTime(iso: string | null): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const mins = Math.floor((Date.now() - then) / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export interface StyleUpExperienceProps {
  /** Restrict the roster + resumed threads to the two /style landing stylists. */
  landingOnly?: boolean;
  /** Landing mode, embedded under a marketing hero (richer copy + sign-in). */
  landing?: boolean;
  /** Hero headline / subhead shown in landing mode above the roster. */
  landingTitle?: string;
  landingSubtitle?: string;
}

export function StyleUpExperience({
  landingOnly = false,
  landing = false,
  landingTitle = 'Meet your AI stylist',
  landingSubtitle = 'Two stylists, one feed. Tell them your vibe, they pull the pieces and put the look on you.',
}: StyleUpExperienceProps = {}) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const isSuperAdmin = user?.role === 'super_admin';
  const navigate = useNavigate();
  // Only auto-resume / surface threads that belong to the current surface.
  const inScope = useCallback(
    (s: StyleUpStylist) => !landingOnly || s.landingSlot != null,
    [landingOnly],
  );

  const [stylists, setStylists] = useState<StyleUpStylist[]>([]);
  const [active, setActive] = useState<StyleUpStylist | null>(null);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<StyleUpMessage[]>([]);
  const [myThreads, setMyThreads] = useState<StyleUpThreadSummary[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);        // "Find a stylist" screen
  const [allStylists, setAllStylists] = useState<StyleUpStylist[]>([]); // full roster for the picker
  const [bootResumed, setBootResumed] = useState(false);
  const [opening, setOpening] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [stylistTyping, setStylistTyping] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [ctx, setCtx] = useState<ShopperContext | null>(null);
  const [ctxMini, setCtxMini] = useState(false);     // collapse-on-scroll
  const [ctxEditing, setCtxEditing] = useState(false);
  // Render polling: generation id → its latest row. Drives the on-you render
  // bubbles (spinner → video).
  const [renders, setRenders] = useState<Record<string, UserGeneration>>({});
  const [renderError, setRenderError] = useState<string | null>(null);
  const [genLook, setGenLook] = useState(false);     // full-look render in flight
  const [published, setPublished] = useState<Set<string>>(new Set()); // gen ids added to looks
  const [followedUp, setFollowedUp] = useState<Set<string>>(new Set()); // renders the stylist has reacted to
  const [chosenBySlot, setChosenBySlot] = useState<Record<string, string>>({}); // role → chosen product id
  const [rejected, setRejected] = useState<Set<string>>(new Set());   // product ids the shopper passed on
  const [chosenScene, setChosenScene] = useState<string | null>(null); // the look's setting
  const [prefs, setPrefs] = useState<StylePrefs>(EMPTY_PREFS);
  const prefsRef = useRef<StylePrefs>(EMPTY_PREFS); // always-current copy for callbacks
  const lastRenderSigRef = useRef<string>('');      // dedupe identical re-renders (#10)
  const [viewer, setViewer] = useState<{ videoUrl: string; pieces: StyleUpProductRef[]; genId: string } | null>(null); // expanded look
  const [, setNowTick] = useState(0);                // 1s heartbeat for the render ETA
  const [isDesktop, setIsDesktop] = useState(false); // desktop = two-pane layout
  const [huntView, setHuntView] = useState<{ estSec: number; elapsed: number } | null>(null); // working module for the open thread (flag-driven)
  const [typingThreadId, setTypingThreadId] = useState<string | null>(null); // which thread the typing belongs to
  const [adminNote, setAdminNote] = useState<string | null>(null); // super-admin-only diagnostics (client-only)
  const [signingIn, setSigningIn] = useState(false); // landing Google sign-in in flight
  const [signinError, setSigninError] = useState('');
  const [edit, setEdit] = useState<{ heightLabel: string; weightLabel: string; ageLabel: string; gender: UserGender; style: string } | null>(null);
  const [savingCtx, setSavingCtx] = useState(false);
  const [uploadingSlot, setUploadingSlot] = useState<number | null>(null);
  const photoSlotRef = useRef<number>(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  // A render is in flight for this thread, used to block stacking renders.
  const pendingRender = messages.some(m => {
    if (m.kind !== 'render' || !m.renderGenerationId) return false;
    const r = renders[m.renderGenerationId];
    return !r || (r.status !== 'done' && r.status !== 'failed');
  });

  const exit = useCallback(() => {
    // Back always lands on the /style landing (never dumps out to the app feed).
    navigate('/style');
  }, [navigate]);

  // Landing sign-in, same Google OAuth the rest of the app uses. On success
  // the page redirects to Google and resolves back here authenticated.
  const handleSignIn = useCallback(async () => {
    setSigninError('');
    setSigningIn(true);
    const { error } = await signInWithGoogle();
    if (error) { setSigninError(error); setSigningIn(false); }
  }, []);

  // Desktop vs mobile, desktop gets a two-pane (rail + chat) experience.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(min-width: 769px)');
    const apply = () => setIsDesktop(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  // Pin the chat shell to the VisualViewport. The shell is position:fixed and
  // full-screen; iOS Safari ignores interactive-widget=resizes-content, so when
  // the keyboard opens it leaves the layout viewport full-height and instead
  // scrolls the fixed shell to reveal the focused composer — dragging the header
  // and messages off the top and stranding the composer over a black gap. The
  // VisualViewport excludes the keyboard AND reports how far Safari scrolled
  // (offsetTop), so size the shell to vv.height and offset it by vv.offsetTop so
  // it always overlays exactly the visible region — header at top, composer above
  // the keyboard, messages scrolling internally in between.
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!vv) return;
    const root = document.documentElement;
    let raf = 0;
    const apply = () => {
      raf = 0;
      root.style.setProperty('--su-vvh', `${Math.round(vv.height)}px`);
      root.style.setProperty('--su-vvt', `${Math.round(vv.offsetTop)}px`);
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(apply); };
    apply();
    vv.addEventListener('resize', schedule);
    vv.addEventListener('scroll', schedule);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      vv.removeEventListener('resize', schedule);
      vv.removeEventListener('scroll', schedule);
      root.style.removeProperty('--su-vvh');
      root.style.removeProperty('--su-vvt');
    };
  }, []);

  // Roster, scoped to the landing pair on /style, the full roster elsewhere.
  useEffect(() => { void fetchStylists({ landingOnly }).then(setStylists); }, [landingOnly]);

  // Shopper context, the SAME inputs the AI-look flow uses (face photos +
  // height / weight / age / gender + saved style). Editable here; saving writes
  // straight to the profile the stylist reads each turn, so it stays in sync
  // with the AI-look studio (one source of truth).
  const loadContext = useCallback(async () => {
    if (!userId) return;
    const [ha, gender, style, uploads, slots] = await Promise.all([
      getUserHeightAge(userId),
      getUserGender(userId),
      getUserCustomStyle(userId),
      listUserUploads(userId),
      getUserSlots(userId, MAX_PHOTOS),
    ]);
    const byId = new Map(uploads.map(u => [u.id, u.public_url]));
    let normSlots = slots.slice(0, MAX_PHOTOS);
    while (normSlots.length < MAX_PHOTOS) normSlots.push(null);
    // Fall back to most-recent uploads when no explicit slots are set.
    if (!normSlots.some(Boolean) && uploads.length) {
      normSlots = uploads.slice(0, MAX_PHOTOS).map(u => u.id);
      while (normSlots.length < MAX_PHOTOS) normSlots.push(null);
    }
    const photos = normSlots.map(id => (id ? byId.get(id) ?? null : null));
    const chips: string[] = [];
    if (ha.heightLabel) chips.push(ha.heightLabel);
    if (ha.weightLabel) chips.push(ha.weightLabel.replace(/\s*\(.*\)\s*/, ''));
    if (ha.ageLabel) chips.push(ha.ageLabel);
    if (gender !== 'unknown') chips.push(gender);
    setCtx({
      photos, slots: normSlots,
      heightLabel: ha.heightLabel ?? '', weightLabel: ha.weightLabel ?? '', ageLabel: ha.ageLabel ?? '',
      gender, style: style ?? '', chips,
    });
  }, [userId]);
  useEffect(() => { void loadContext(); }, [loadContext]);

  // Open a known thread (resume), loads its full history so the conversation
  // keeps going where it left off.
  const openThread = useCallback(async (id: string, s: StyleUpStylist) => {
    setActive(s);
    setThreadId(id);
    setPickerOpen(false);
    markThreadSeen(id);   // opening it clears its "new message" flag
    setMessages(await fetchMessages(id));
    // Open where they left off, pin to the latest message once the thread has
    // rendered + laid out (two frames covers the mount + first paint).
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const el = scrollerRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }));
  }, []);

  // Open (or resume) a thread with the chosen stylist from the roster.
  const openStylist = useCallback(async (s: StyleUpStylist) => {
    if (!userId || opening) return;
    setOpening(true);
    setActive(s);
    const id = await getOrCreateThread(s.id, userId);
    if (id) await openThread(id, s);
    setOpening(false);
  }, [userId, opening, openThread]);

  // Load the shopper's saved conversations (for the roster list).
  const loadThreads = useCallback(async () => {
    if (!userId) return;
    const all = await fetchMyThreads(userId);
    setMyThreads(all.filter(t => inScope(t.stylist)));
  }, [userId, inScope]);

  const closeThread = useCallback(() => {
    if (threadId) markThreadSeen(threadId); // leaving marks everything read
    setThreadId(null);
    setActive(null);
    setMessages([]);
    setDraft('');
    void loadThreads(); // refresh the saved-conversations list with the latest
  }, [loadThreads, threadId]);

  // "Find a stylist" — open the picker and load the FULL roster (not just the
  // two landing stylists) so the shopper can choose from all of them.
  const openPicker = useCallback(async () => {
    setPickerOpen(true);
    const all = await fetchStylists({ landingOnly: false });
    setAllStylists(all);
  }, []);

  // Delete a conversation (swipe-to-delete on the list). Removes it from the DB
  // and refreshes; if it's the one that's open, closes back to the list.
  const [swipedId, setSwipedId] = useState<string | null>(null); // convo card swiped open
  const swipeStartX = useRef(0);
  const swipeDX = useRef(0);
  const handleDeleteThread = useCallback(async (id: string) => {
    const ok = await deleteThread(id);
    if (!ok) return;
    setSwipedId(null);
    if (threadId === id) closeThread();
    else void loadThreads();
  }, [threadId, closeThread, loadThreads]);

  // "End conversation" from inside the thread — same delete, with a confirm.
  const endConversation = useCallback(async () => {
    if (!threadId) return;
    if (typeof window !== 'undefined' && !window.confirm('End this conversation? This permanently deletes it.')) return;
    await handleDeleteThread(threadId);
  }, [threadId, handleDeleteThread]);

  // On open, resume the shopper's most-recent conversation so an active chat's
  // history keeps going instead of dropping them back on the roster every time.
  // EXCEPT on the /style landing, that should always open on the landing hero,
  // never drop you straight into a chat, the conversations list handles resume.
  useEffect(() => {
    if (!userId || bootResumed) return;
    let cancelled = false;
    (async () => {
      const [latest] = await Promise.all([getLatestThread(userId), loadThreads()]);
      if (cancelled) return;
      setBootResumed(true);
      if (latest && inScope(latest.stylist) && !landing) {
        await openThread(latest.threadId, latest.stylist);
      }
    })();
    return () => { cancelled = true; };
  }, [userId, bootResumed, openThread, loadThreads, inScope, landing]);

  // Preference memory: per-thread set of product ids the shopper passed on, so
  // the stylist never re-recommends a no. Persisted in localStorage.
  useEffect(() => {
    setChosenBySlot({});
    setChosenScene(null);
    setAdminNote(null);
    setChatError(null);
    lastRenderSigRef.current = '';
    if (!threadId) { setRejected(new Set()); setPrefs(EMPTY_PREFS); prefsRef.current = EMPTY_PREFS; return; }
    try {
      const raw = localStorage.getItem(`styleup:rejected:${threadId}`);
      setRejected(new Set(raw ? (JSON.parse(raw) as string[]) : []));
    } catch { setRejected(new Set()); }
    try {
      const raw = localStorage.getItem(`styleup:prefs:${threadId}`);
      const p = raw ? { ...EMPTY_PREFS, ...(JSON.parse(raw) as Partial<StylePrefs>) } : EMPTY_PREFS;
      setPrefs(p); prefsRef.current = p;
    } catch { setPrefs(EMPTY_PREFS); prefsRef.current = EMPTY_PREFS; }
  }, [threadId]);

  // Persist + keep the ref current so callbacks always read fresh prefs.
  const updatePrefs = useCallback((next: StylePrefs) => {
    prefsRef.current = next;
    setPrefs(next);
    if (threadId) { try { localStorage.setItem(`styleup:prefs:${threadId}`, JSON.stringify(next)); } catch { /* ignore */ } }
  }, [threadId]);

  const { method: engineMethod } = useStylistEngineMethod();

  // Recommendation signals from current prefs + the shopper's saved style.
  const recOpts = useCallback((): RecommendOpts => {
    const p = prefsRef.current;
    const styleText = (ctx?.chips ?? []).filter(Boolean).join(' ');
    return { budgetMax: p.budgetMax, occasion: p.occasion, formality: p.formality, avoidColors: p.avoidColors, simpler: p.simpler, styleText, engineMethod };
  }, [ctx, engineMethod]);
  const rejectIds = useCallback((ids: Array<string | undefined>) => {
    const clean = ids.filter((x): x is string => !!x);
    if (!threadId || clean.length === 0) return;
    setRejected(prev => {
      const n = new Set(prev);
      clean.forEach(i => n.add(i));
      try { localStorage.setItem(`styleup:rejected:${threadId}`, JSON.stringify([...n])); } catch { /* ignore */ }
      return n;
    });
  }, [threadId]);

  // Realtime: new messages (either side) stream into the open thread.
  useEffect(() => {
    if (!threadId || !supabase) return;
    const channel = supabase
      .channel(`style-up-thread-${threadId}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'style_up_messages', filter: `thread_id=eq.${threadId}` },
        (payload) => {
          const r = payload.new as Record<string, unknown>;
          const msg: StyleUpMessage = {
            id: String(r.id), threadId: String(r.thread_id),
            sender: (r.sender as StyleUpMessage['sender']) ?? 'stylist',
            kind: (r.kind as StyleUpMessage['kind']) ?? 'text',
            body: (r.body as string | null) ?? null,
            productRef: (r.product_ref as StyleUpMessage['productRef']) ?? null,
            renderGenerationId: (r.render_generation_id as string | null) ?? null,
            createdAt: String(r.created_at),
          };
          setMessages(prev => (prev.some(m => m.id === msg.id) ? prev : [...prev, msg]));
        })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [threadId]);

  // Keep the chat pinned to the latest message (incl. the typing / researching
  // indicators as they appear).
  useEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, stylistTyping, !!huntView]);

  // The web hunt now runs SERVER-SIDE (in the style-up-chat edge fn), so it
  // finishes even if the shopper refreshes or leaves. We drive the working
  // module off the thread's `hunting_until` marker (polled), so it shows for
  // whoever has the chat open and hides the moment the server clears it.
  useEffect(() => {
    if (!threadId) { setHuntView(null); return; }
    let untilMs = 0;
    let startMs = Date.now();
    let active = false;
    let lastFetch = 0;
    const tick = async () => {
      const now = Date.now();
      if (now - lastFetch > 2500) {
        lastFetch = now;
        const until = await getThreadHunting(threadId);
        untilMs = until ? new Date(until).getTime() : 0;
      }
      if (untilMs > now) {
        if (!active) { active = true; startMs = now; }
        setHuntView({ estSec: Math.ceil((untilMs - now) / 1000), elapsed: Math.floor((now - startMs) / 1000) });
      } else {
        active = false;
        setHuntView(null);
      }
    };
    void tick();
    const h = window.setInterval(tick, 1000);
    return () => window.clearInterval(h);
  }, [threadId]);

  // Show the typing bubble for a randomized 1/2/3s before the stylist's reply
  // lands, used by the tap-driven flows (swaps, outfit, scene) so every
  // response feels considered, not instant.
  const beat = useCallback(async () => {
    setTypingThreadId(threadId);
    setStylistTyping(true);
    await stylistBeat();
    setStylistTyping(false);
  }, [threadId]);

  // Kick the AI stylist for the current thread. Its reply (+ any product picks)
  // streams back via the realtime subscription; the typing bubble holds until
  // the call resolves. For WEB stylists, the edge function ALSO runs the piece
  // hunt server-side (it sets a hunting_until marker + streams products in), so
  // nothing extra is needed here. Any failure surfaces a recoverable error row.
  const triggerStylist = useCallback(async (mode?: 'outfit') => {
    if (!threadId || !supabase) return;
    setChatError(null);
    setAdminNote(null);
    await stylistBeat();           // human "reading" pause (1/2/3s) before typing
    setTypingThreadId(threadId);
    setStylistTyping(true);
    // The Anthropic call behind the edge function can transiently 429/529/502
    // under load. Retry a couple times with backoff before surfacing an error,
    // so a momentary overload doesn't leave the shopper staring at a dead chat.
    let lastErr = '';
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 1200 * attempt));
      try {
        const { data, error } = await supabase.functions.invoke('style-up-chat', { body: { threadId, mode } });
        const resp = data as { success?: boolean; error?: string } | null;
        if (!error && resp?.success) {
          setStylistTyping(false);
          return;
        }
        lastErr = resp?.error || '';
      } catch {
        lastErr = '';
      }
    }
    setStylistTyping(false);
    setChatError(lastErr || 'Your stylist couldn’t respond. Tap to retry.');
    if (isSuperAdmin) setAdminNote(`style-up-chat failed: ${lastErr || 'no response (network / timeout)'}`);
  }, [threadId, isSuperAdmin]);

  // "Generate the look on me", the stylist confirms in-thread, then the FULL
  // set of recommended pieces is composited onto the shopper via the existing
  // generate-look pipeline. The render bubble streams in + polls to the video.
  const generateFullLook = useCallback(async (products: StyleUpProductRef[], scene?: string | null) => {
    if (!threadId || !userId || genLook) return;
    if (pendingRender) { setRenderError('Still finishing your last look, give it a sec.'); return; }
    const seen = new Set<string>();
    const uniq = products.filter(p => {
      if (!p.id || seen.has(p.id)) return false;
      seen.add(p.id); return true;
    });
    if (uniq.length === 0) { void triggerStylist(); return; }
    // Don't re-render the exact same pieces + scene (#10).
    const sig = [...uniq.map(p => p.id).sort(), scene ?? ''].join('|');
    if (sig === lastRenderSigRef.current) {
      await sendStylistText(threadId, "That's the same look + setting you just saw, change a piece or pick a new spot and I'll re-render.");
      return;
    }
    lastRenderSigRef.current = sig;
    setGenLook(true);
    setRenderError(null);
    await beat();
    await sendStylistText(threadId, "Love it, putting your full look together now. I'll send it over the second it's ready ✨");
    const { error } = await startFullLookRender({ threadId, shopperUserId: userId, products: uniq, scene });
    if (error) {
      setRenderError(error);
      await sendStylistText(threadId, `Hmm, I couldn't start that render, ${error}`);
    }
    setGenLook(false);
  }, [threadId, userId, genLook, pendingRender, triggerStylist, beat]);

  // The pieces currently in the look, the stylist's product picks, excluding
  // swap/chooser cards. Drives full-look generation + swap re-renders.
  const lookPicks = useCallback((): StyleUpProductRef[] => messages
    .filter(m => m.kind === 'product' && m.productRef?.id && !m.productRef?.swap && !m.productRef?.choose)
    .map(m => m.productRef as StyleUpProductRef), [messages]);

  // Assemble a coherent head-to-toe look: ONE piece per garment slot. The
  // shopper's explicit choice for a slot wins; otherwise the most-recent pick.
  const assembleLook = useCallback((): StyleUpProductRef[] => {
    const picks = lookPicks();
    const bySlot = new Map<string, StyleUpProductRef>();
    for (const p of picks) bySlot.set(roleTagFromName(p.name ?? null) || `other:${p.id}`, p);
    for (const [slot, id] of Object.entries(chosenBySlot)) {
      const found = picks.find(p => p.id === id);
      if (found) bySlot.set(slot, found);
    }
    return [...bySlot.values()];
  }, [lookPicks, chosenBySlot]);

  // ── Guided outfit flow (logic #1+#3+#4): ask which shoes (if ambiguous),
  // then which slots, then recommend one piece per slot. ────────────────────
  const askOutfitSlots = useCallback(async () => {
    if (!threadId) return;
    const filled = new Set(lookPicks().map(p => roleTagFromName(p.name ?? null)).filter(Boolean));
    const candidates = (['Top', 'Pants', 'Jacket', 'Hat'] as const)
      .filter(s => !filled.has(s))
      .map(s => ({ value: s, label: SLOT_LABEL[s] }));
    if (candidates.length === 0) {
      await sendStylistText(threadId, "You've got the pieces, say “show me the full look” and I'll put it all on you.");
      return;
    }
    await sendStylistText(threadId, 'Got it. What do you want in the outfit? Tap all that apply.');
    await sendChooser(threadId, { kind: 'slots', prompt: 'Build your outfit', multi: true, options: candidates });
  }, [threadId, lookPicks]);

  const startOutfitFlow = useCallback(async () => {
    if (!threadId || !userId) return;
    if (pendingRender) { setRenderError('Still finishing your last look, one sec.'); return; }
    await beat();
    const shoes = lookPicks().filter(p => roleTagFromName(p.name ?? null) === 'Shoes' && p.id);
    if (shoes.length > 1 && !chosenBySlot['Shoes']) {
      await sendStylistText(threadId, 'Love it, let’s build the full fit. First, which shoes do you want to build around?');
      await sendChooser(threadId, {
        kind: 'shoes', prompt: 'Pick your shoes', multi: false,
        options: shoes.map(s => ({ value: s.id as string, label: s.name || 'Shoes', image: s.image, ref: s })),
      });
      return;
    }
    await askOutfitSlots();
  }, [threadId, userId, pendingRender, lookPicks, chosenBySlot, askOutfitSlots, beat]);

  // Before any restyle: ask where they want to be seen (scene), then render.
  const askScene = useCallback(async () => {
    if (!threadId || !userId) return;
    if (pendingRender) { setRenderError('Still finishing your last look, one sec.'); return; }
    if (assembleLook().length === 0) { void triggerStylist(); return; }
    await beat();
    await sendStylistText(threadId, 'Before I restyle you, where do you want to be seen?');
    await sendChooser(threadId, { kind: 'scene', prompt: 'Pick your setting', multi: false, options: sceneOptions() });
  }, [threadId, userId, pendingRender, assembleLook, triggerStylist, beat]);

  const onChoose = useCallback(async (kind: string, values: string[]) => {
    if (!threadId || !userId) return;
    if (kind === 'scene') {
      const scene = values[0];
      setChosenScene(scene);
      await generateFullLook(assembleLook(), scene);
      return;
    }
    if (kind === 'shoes') {
      const id = values[0];
      setChosenBySlot(prev => ({ ...prev, Shoes: id }));
      rejectIds(lookPicks().filter(p => roleTagFromName(p.name ?? null) === 'Shoes' && p.id !== id).map(p => p.id));
      await beat();
      await sendStylistText(threadId, 'Perfect, building around those. 👟');
      await askOutfitSlots();
    } else if (kind === 'slots') {
      const isWeb = active?.sourceMode === 'web';
      await beat();
      await sendStylistText(threadId, isWeb ? 'On it, tracking those down now…' : 'On it, pulling pieces for that now…');
      const exclude = [...lookPicks().map(p => p.id).filter((x): x is string => !!x), ...rejected];
      for (const role of values) {
        const pick = isWeb
          ? await webRecommendForSlot(userId, role, exclude, recOpts())
          : await recommendForSlot(userId, role, exclude, recOpts());
        if (pick?.id) { await sendProductPick(threadId, pick); exclude.push(pick.id); }
      }
      await sendStylistText(threadId, "Here's your outfit, tap “See it on me” on any piece, or say “show me the full look” and I'll put it all on you.");
      // Proactive gap completion (#9): nudge the missing core piece, with a reason.
      const have = new Set([...lookPicks().map(p => roleTagFromName(p.name ?? null)), ...values]);
      const GAP_REASON: Record<string, string> = {
        Shoes: 'a clean pair of shoes to ground it', Top: 'a top to anchor the fit', Pants: 'bottoms to complete it', Jacket: 'a layer to pull it together',
      };
      const missing = (['Shoes', 'Top', 'Pants'] as const).find(s => !have.has(s));
      if (missing) await sendStylistText(threadId, `One more thing, you'll want ${GAP_REASON[missing]}. Say “different ${missing.toLowerCase()}” and I'll pull a few.`);
    }
  }, [threadId, userId, lookPicks, rejected, rejectIds, askOutfitSlots, assembleLook, generateFullLook, recOpts, active, beat]);

  // "Try different pants", the stylist offers 3 alternatives for that slot.
  const handleSwapRequest = useCallback(async (swap: { role: string; label: string }) => {
    if (!threadId || !userId) return;
    setRenderError(null);
    await beat();
    await sendStylistText(threadId, `Sure thing, here are a few ${swap.label} options. Tap the one you like and I'll put it on you.`);
    // Exclude what's in the look AND anything they've already passed on (memory).
    const exclude = [...lookPicks().map(p => p.id).filter((x): x is string => !!x), ...rejected];
    // Web stylists hunt the open web for alternates; catalog stylists pull ours.
    const options = active?.sourceMode === 'web'
      ? await webFetchSwapOptions(userId, swap.role, 3, exclude, recOpts())
      : await fetchSwapOptions(userId, swap.role, 3, exclude, recOpts());
    if (options.length === 0) {
      await sendStylistText(threadId, `Hmm, I'm short on alternate ${swap.label} right now, want to try a different piece?`);
      return;
    }
    await sendSwapOptions(threadId, swap.role, swap.label, options);
  }, [threadId, userId, lookPicks, rejected, recOpts, active, beat]);

  // Shopper picked one of the swap options → re-render the full look with it.
  const selectSwapOption = useCallback(async (role: string, chosen: StyleUpProductRef, siblings: StyleUpProductRef[] = []) => {
    if (!threadId || !userId || genLook) return;
    if (pendingRender) { setRenderError('Still finishing your last look, give it a sec.'); return; }
    setGenLook(true);
    setRenderError(null);
    setChosenBySlot(prev => ({ ...prev, [role]: chosen.id as string }));
    rejectIds(siblings.filter(o => o.id !== chosen.id).map(o => o.id)); // remember the passed-over options
    await beat();
    await sendStylistText(threadId, `Great pick, restyling you with the ${chosen.brand || chosen.name || 'new piece'} now ✨`);
    const { error } = await startFullLookRender({ threadId, shopperUserId: userId, products: assembleLook(), replace: { role, product: chosen }, scene: chosenScene });
    if (error) {
      setRenderError(error);
      await sendStylistText(threadId, `Couldn't render that, ${error}`);
    }
    setGenLook(false);
  }, [threadId, userId, genLook, pendingRender, assembleLook, rejectIds, chosenScene, beat]);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || !threadId || sending) return;
    setSending(true);
    setDraft('');
    const msg = await sendShopperMessage(threadId, text);
    if (msg) setMessages(prev => (prev.some(m => m.id === msg.id) ? prev : [...prev, msg]));
    setSending(false);
    // Fold any budget / occasion / formality / color / simplicity cues from this
    // message into the running prefs (applied to all future recommendations).
    const np = applyPrefs(prefsRef.current, text);
    if (JSON.stringify(np) !== JSON.stringify(prefsRef.current)) updatePrefs(np);
    // Routing: swap request → 3 options; "build a full outfit" → guided chooser
    // flow; "see the look on me" → render; a web stylist + product request →
    // hunt the web; otherwise the AI stylist takes the turn.
    // Routing: explicit swap / full-outfit / "see it on me" stay client-driven;
    // everything else goes to the stylist's brain. For web stylists the brain
    // decides when to surface pieces (returning searchQueries → a web hunt).
    const swap = swapTargetFromText(text);
    const looks = lookPicks();
    if (swap && looks.length > 0) void handleSwapRequest(swap);
    else if (wantsFullOutfit(text)) {
      if (engineMethod === 'style_engine' && active?.sourceMode !== 'web') void triggerStylist('outfit');
      else void startOutfitFlow();
    }
    else if (wantsFullLook(text) && looks.length > 0) void askScene();
    else void triggerStylist();
  }, [draft, threadId, sending, triggerStylist, handleSwapRequest, startOutfitFlow, askScene, lookPicks, engineMethod, active]);

  // Add a finished render to the shopper's own looks, promotes the generation
  // to a LIVE look (with its video + poster + pieces), associated with THIS
  // shopper, so it lands in My Catalog properly (not stuck Inactive/posterless).
  const addToLooks = useCallback(async (genId: string, pieces: StyleUpProductRef[]) => {
    if (!userId || published.has(genId)) return;
    const r = renders[genId];
    if (!r?.video_url) { setRenderError('Give it a moment to finish, then add it.'); return; }
    setPublished(prev => new Set(prev).add(genId));
    try {
      await promoteGenerationToLook({
        generationId: genId,
        creatorUserId: userId, // associate the look with this shopper
        videoUrl: r.video_url,
        creatorLabel: user?.displayName || user?.email?.split('@')[0] || 'My',
        style: 'editorial',
        gender: ctx?.gender === 'male' ? 'men' : ctx?.gender === 'female' ? 'women' : 'unisex',
        products: pieces.map(p => p.id).filter((id): id is string => !!id).map(id => ({ id })),
        status: 'live',
        titleOverride: 'My StyleUp look',
      });
    } catch (e) {
      setPublished(prev => { const n = new Set(prev); n.delete(genId); return n; });
      setRenderError(e instanceof Error ? e.message : 'Could not add to your looks.');
    }
  }, [published, renders, userId, user, ctx]);

  // Open a pick's in-app product page (deeplink). Falls back to its shop URL.
  const openProduct = useCallback((p: StyleUpProductRef) => {
    const slug = productSlug({ id: p.id, name: p.name, brand: p.brand });
    if (slug) navigate(`/p/${slug}`);
    else if (p.url) window.open(p.url, '_blank', 'noopener');
  }, [navigate]);

  // Poll any in-flight render generations referenced by the thread until they
  // reach a terminal state, so the render bubbles promote spinner → video.
  useEffect(() => {
    const ids = messages
      .filter(m => m.kind === 'render' && m.renderGenerationId)
      .map(m => m.renderGenerationId as string);
    const pending = ids.filter(id => {
      const r = renders[id];
      return !r || (r.status !== 'done' && r.status !== 'failed');
    });
    if (pending.length === 0) return;
    let cancelled = false;
    const tick = async () => {
      const rows = await Promise.all(pending.map(id => getGeneration(id)));
      if (cancelled) return;
      setRenders(prev => {
        const next = { ...prev };
        rows.forEach(r => { if (r) next[r.id] = r; });
        return next;
      });
    };
    void tick();
    const h = window.setInterval(tick, 3000);
    return () => { cancelled = true; window.clearInterval(h); };
  }, [messages, renders]);

  // 1s heartbeat while any render is in-flight so the ETA countdown ticks down.
  useEffect(() => {
    const pending = messages.some(m => {
      if (m.kind !== 'render') return false;
      const r = m.renderGenerationId ? renders[m.renderGenerationId] : null;
      return !r || (r.status !== 'done' && r.status !== 'failed');
    });
    if (!pending) return;
    const h = window.setInterval(() => setNowTick(t => t + 1), 1000);
    return () => window.clearInterval(h);
  }, [messages, renders]);

  // When a render finishes AND it's the latest message, the stylist follows up
  // with a description + asks how they like it (once per render). Gated on the
  // render being last so it never double-posts (on reload the follow-up already
  // sits after it).
  useEffect(() => {
    if (!threadId || messages.length === 0) return;
    const last = messages[messages.length - 1];
    if (last.kind !== 'render' || !last.renderGenerationId) return;
    if (followedUp.has(last.renderGenerationId)) return;
    if (renders[last.renderGenerationId]?.status !== 'done') return;
    const gid = last.renderGenerationId;
    setFollowedUp(prev => new Set(prev).add(gid));
    void sendStylistText(threadId, describeLook(assembleLook()));
  }, [messages, renders, threadId, followedUp, assembleLook]);

  // ── Context editing, writes straight to the profile (shared with the
  // AI-look studio), so edits here show up everywhere. ──────────────────────
  const beginEdit = useCallback(() => {
    if (!ctx) return;
    setEdit({ heightLabel: ctx.heightLabel, weightLabel: ctx.weightLabel, ageLabel: ctx.ageLabel, gender: ctx.gender, style: ctx.style });
    setCtxEditing(true);
    setCtxMini(false);
  }, [ctx]);
  const cancelEdit = useCallback(() => { setCtxEditing(false); setEdit(null); }, []);
  const saveCtx = useCallback(async () => {
    if (!userId || !edit) return;
    setSavingCtx(true);
    await Promise.all([
      updateUserHeightAge(userId, { heightLabel: edit.heightLabel || null, weightLabel: edit.weightLabel || null, ageLabel: edit.ageLabel || null }),
      updateUserGender(userId, edit.gender),
      updateUserCustomStyle(userId, edit.style),
    ]);
    await loadContext();
    setSavingCtx(false);
    setCtxEditing(false);
    setEdit(null);
  }, [userId, edit, loadContext]);
  const pickPhoto = useCallback((slot: number) => {
    photoSlotRef.current = slot;
    fileInputRef.current?.click();
  }, []);
  const onPhotoFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !userId || !ctx) return;
    const slot = photoSlotRef.current;
    setUploadingSlot(slot);
    const { data, error } = await uploadUserPhoto(file, userId);
    if (!error && data) {
      const slots = [...ctx.slots];
      while (slots.length < MAX_PHOTOS) slots.push(null);
      slots[slot] = data.id;
      await saveUserSlots(userId, slots);
      await loadContext();
    }
    setUploadingSlot(null);
  }, [userId, ctx, loadContext]);

  const filledPhotos = (ctx?.photos ?? []).filter((u): u is string => !!u);
  const contextCard = (
    <div className={`su-context${ctxMini && !ctxEditing ? ' su-context--mini' : ''}${ctxEditing ? ' su-context--editing' : ''}`} aria-label="Your styling context">
      {ctxMini && !ctxEditing ? (
        // Collapsed slim bar, tap to expand back to the full card.
        <button type="button" className="su-context-minibar" onClick={() => { setCtxMini(false); if (scrollerRef.current) scrollerRef.current.scrollTop = 0; }}>
          <span className="su-context-mini-photo" aria-hidden="true">
            {filledPhotos[0] ? <img src={filledPhotos[0]} alt="" /> : 'You'}
          </span>
          <span className="su-context-mini-chips">{ctx?.chips.length ? ctx.chips.join(' · ') : 'Add your stats'}</span>
          <svg className="su-context-mini-chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
      ) : ctxEditing && edit ? (
        // Inline editor: photos + the mandatory metadata (height / weight / age /
        // gender), saved to the profile.
        <div className="su-context-editor">
          <div className="su-context-photos su-context-photos--edit">
            {[0, 1, 2].map(i => (
              <button type="button" key={i} className="su-context-photo su-context-photo--edit" onClick={() => pickPhoto(i)} aria-label={`Photo ${i + 1}`}>
                {uploadingSlot === i
                  ? <span className="su-render-spinner" aria-hidden="true" />
                  : ctx?.photos[i]
                    ? <img src={ctx.photos[i] as string} alt="" />
                    : <span className="su-context-photo-add" aria-hidden="true">+</span>}
              </button>
            ))}
          </div>
          <div className="su-edit-fields">
            <div className="su-edit-row">
              <input className="su-edit-input" placeholder="Height (e.g. 6'1&quot;)" value={edit.heightLabel} onChange={e => setEdit({ ...edit, heightLabel: e.target.value })} />
              <input className="su-edit-input" placeholder="Weight" value={edit.weightLabel} onChange={e => setEdit({ ...edit, weightLabel: e.target.value })} />
            </div>
            <div className="su-edit-row">
              <input className="su-edit-input" placeholder="Age (e.g. Late 30s)" value={edit.ageLabel} onChange={e => setEdit({ ...edit, ageLabel: e.target.value })} />
              <div className="su-edit-gender">
                {(['male', 'female'] as const).map(g => (
                  <button type="button" key={g} className={`su-edit-gender-btn${edit.gender === g ? ' is-on' : ''}`} onClick={() => setEdit({ ...edit, gender: g })}>{g === 'male' ? 'Male' : 'Female'}</button>
                ))}
              </div>
            </div>
            <div className="su-edit-actions">
              <button type="button" className="su-edit-btn" onClick={cancelEdit} disabled={savingCtx}>Cancel</button>
              <button type="button" className="su-edit-btn su-edit-btn--save" onClick={() => void saveCtx()} disabled={savingCtx}>{savingCtx ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </div>
      ) : (
        // Full card.
        <>
          <div className="su-context-photos">
            {filledPhotos.length > 0
              ? filledPhotos.map((src, i) => (
                  <span className="su-context-photo" key={i}><img src={src} alt="" loading="lazy" /></span>
                ))
              : <span className="su-context-photo su-context-photo--empty" aria-hidden="true" />}
          </div>
          <div className="su-context-meta">
            <div className="su-context-title">You</div>
            <div className="su-context-chips">
              {ctx && ctx.chips.length > 0
                ? ctx.chips.map((c, i) => <span className="su-context-chip" key={i}>{c}</span>)
                : <span className="su-context-chip su-context-chip--muted">No stats yet</span>}
            </div>
            <div className="su-context-note">Your stylist sees this, keep it current.</div>
          </div>
          <button type="button" className="su-context-edit" onClick={beginEdit} aria-label="Edit your context">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>
          </button>
        </>
      )}
      <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={onPhotoFile} />
    </div>
  );

  // Shared top bar: the Catalog logo centered up top with "style" right under
  // it, and a single back control. No divider bar beneath it.
  const header = (onBack: () => void) => (
    <div className="su-shell-head">
      <button type="button" className="su-back su-shell-back" onClick={onBack} aria-label="Back">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
      </button>
      <div className="su-shell-brand">
        <CatalogLogo className="su-shell-logo" />
        <span className="su-shell-brand-style">style</span>
      </div>
    </div>
  );
  const railHeader = header(exit);

  // Expanded look viewer, the big, full-screen video + its pieces + add-to-looks.
  const viewerOverlay = viewer ? (
    <div className="su-viewer" onClick={() => setViewer(null)} role="dialog" aria-modal="true">
      <div className="su-viewer-inner" onClick={e => e.stopPropagation()}>
        <button type="button" className="su-viewer-close" onClick={() => setViewer(null)} aria-label="Close">✕</button>
        <video className="su-viewer-video" src={viewer.videoUrl} autoPlay loop controls playsInline />
        {viewer.pieces.length > 0 && (
          <div className="su-viewer-pieces">
            {viewer.pieces.map((pc, i) => (
              <button type="button" className="su-viewer-piece" key={pc.id || i} onClick={() => openProduct(pc)} title={[pc.brand, pc.name].filter(Boolean).join(' · ')}>
                {pc.image ? <img src={pc.image} alt="" /> : <span className="su-product-media--empty" />}
              </button>
            ))}
          </div>
        )}
        <button type="button" className="su-viewer-add" onClick={() => void addToLooks(viewer.genId, viewer.pieces)} disabled={published.has(viewer.genId)}>
          {published.has(viewer.genId) ? 'Added to your looks ✓' : 'Add to my looks'}
        </button>
      </div>
    </div>
  ) : null;

  // The app's Google sign-in button (used on the landing + the sign-in gate).
  const googleButton = (
    <button type="button" className="su-google" onClick={() => void handleSignIn()} disabled={signingIn}>
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
      </svg>
      <span>{signingIn ? 'Signing in…' : 'Continue with Google'}</span>
    </button>
  );

  // The /style hero — just the headline (the Catalog logo sits in the header
  // above, so no eyebrow, and no description blurb).
  const landingHero = landing ? (
    <div className="su-landing-hero">
      <h1 className="su-landing-title">{landingTitle}</h1>
    </div>
  ) : null;

  // Not signed in, Style Up is per-shopper. On /style this doubles as the
  // landing: hero + a preview of the two stylists + the Google sign-in.
  if (!userId) {
    return (
      <div className={`su-shell${landing ? ' su-shell--landing' : ''}`}>
        <div className="su-bg" aria-hidden="true"><StyleUpBackground /></div>
        {!landing && railHeader}
        <div className="su-signin">
          {landingHero}
          {landing && stylists.length > 0 && (
            <div className="su-landing-stylists">
              {stylists.map(s => (
                <div key={s.id} className="su-landing-stylist" style={{ ['--su-accent' as string]: s.accentColor ?? '#8aa0c0' }}>
                  <span className="su-stylist-avatar" aria-hidden="true">
                    <StylistFace avatarUrl={s.avatarUrl} name={s.name} />
                  </span>
                  <span className="su-landing-stylist-name">{s.name}</span>
                  {s.specialty && <span className="su-landing-stylist-spec">{s.specialty}</span>}
                </div>
              ))}
            </div>
          )}
          {!landing && <p>Sign in to chat with a stylist and see picks on yourself.</p>}
          {googleButton}
          {signinError && <p className="su-signin-error">{signinError}</p>}
        </div>
      </div>
    );
  }

  // ── Roster pane, saved conversations + the stylist list. ───────────────
  const rosterPane = (
        <div className="su-page">
          {/* Saved conversations, the shopper's ongoing chats live here so they
              can pick any one back up where they left off. */}
          {myThreads.length > 0 && (
            <div className="su-convos">
              <div className="su-section-label">Your conversations</div>
              {myThreads.map(t => (
                <button
                  key={t.threadId}
                  type="button"
                  className="su-convo-card"
                  style={{ ['--su-accent' as string]: t.stylist.accentColor ?? '#8aa0c0' }}
                  onClick={() => void openThread(t.threadId, t.stylist)}
                >
                  <span className="su-stylist-avatar" aria-hidden="true">
                    <StylistFace avatarUrl={t.stylist.avatarUrl} name={t.stylist.name} />
                  </span>
                  <span className="su-convo-info">
                    <span className="su-convo-top">
                      <span className="su-stylist-name">{t.stylist.name}</span>
                      <span className="su-convo-time">{relativeTime(t.lastMessageAt)}</span>
                    </span>
                    {t.lastMessage && <span className="su-convo-preview">{t.lastMessage}</span>}
                  </span>
                </button>
              ))}
            </div>
          )}

          {!landing && (
            <div className="su-roster-head">
              <h1>{myThreads.length > 0 ? 'Find another stylist' : 'Find your stylist'}</h1>
              <p>Request a stylist. They&apos;ll learn your vibe, send picks, and show you wearing them.</p>
            </div>
          )}
          {landing && (
            <div className="su-roster-head su-roster-head--landing">
              <h2>{myThreads.length > 0 ? 'Pick up where you left off' : 'Pick your stylist'}</h2>
            </div>
          )}
          <div className="su-roster">
            {stylists.filter(s => !myThreads.some(t => t.stylist.id === s.id)).map(s => (
              <button
                key={s.id}
                type="button"
                className="su-stylist-card"
                style={{ ['--su-accent' as string]: s.accentColor ?? '#8aa0c0' }}
                onClick={() => void openStylist(s)}
                disabled={opening}
              >
                <span className="su-stylist-avatar" aria-hidden="true">
                  <StylistFace avatarUrl={s.avatarUrl} name={s.name} />
                </span>
                <span className="su-stylist-info">
                  <span className="su-stylist-name">{s.name}</span>
                  {s.specialty && <span className="su-stylist-specialty">{s.specialty}</span>}
                  {s.bio && <span className="su-stylist-bio">{s.bio}</span>}
                </span>
                <span className="su-stylist-cta">Request</span>
              </button>
            ))}
            {stylists.length === 0 && <div className="su-empty">No stylists available yet.</div>}
            {stylists.length > 0 && stylists.every(s => myThreads.some(t => t.stylist.id === s.id)) && (
              <div className="su-empty">You&apos;re chatting with all our stylists.</div>
            )}
          </div>
        </div>
  );

  // ── Thread pane, the active conversation. ──────────────────────────────
  // Group consecutive product picks (a "pull") so they render as ONE look card
  // with a single "Generate this look" button — instead of a bubble per item.
  const lookRunPieces = new Map<string, StyleUpProductRef[]>(); // first msg id → pieces
  const skipProductIds = new Set<string>();                     // later msgs in a run
  {
    const isPick = (m: StyleUpMessage) =>
      m.kind === 'product' && !!m.productRef?.id && !m.productRef?.swap && !m.productRef?.choose;
    let i = 0;
    while (i < messages.length) {
      if (!isPick(messages[i])) { i++; continue; }
      const run: StyleUpMessage[] = [];
      let j = i;
      while (j < messages.length && isPick(messages[j])) { run.push(messages[j]); j++; }
      lookRunPieces.set(run[0].id, run.map(r => r.productRef as StyleUpProductRef));
      for (let k = 1; k < run.length; k++) skipProductIds.add(run[k].id);
      i = j;
    }
  }
  const threadPane = (
      <div className="su-page su-page--thread">
        <div className="su-thread-head">
          <button type="button" className="su-back" onClick={closeThread} aria-label="Back to stylists">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
          </button>
          <span className="su-thread-avatar" aria-hidden="true">
            <StylistFace avatarUrl={active?.avatarUrl ?? null} name={active?.name} />
          </span>
          <span className="su-thread-id">
            <span className="su-thread-name">{active?.name}</span>
            {active?.specialty && <span className="su-thread-specialty">{active.specialty}</span>}
          </span>
          <button type="button" className="su-thread-end" onClick={() => void endConversation()}>End</button>
        </div>

        {contextCard}

        <div
          className="su-chat"
          ref={scrollerRef}
          onScroll={e => { if (!ctxEditing) setCtxMini((e.target as HTMLDivElement).scrollTop > 24); }}
        >
          {messages.length === 0 && (
            <div className="su-chat-intro">
              <p>Say hi to {active?.name} and tell them what you&apos;re looking for.</p>
              <p className="su-chat-intro-sub">e.g. &ldquo;I need a date-night fit&rdquo; or &ldquo;help me build a capsule for work&rdquo;.</p>
            </div>
          )}
          {messages.map(m => {
            if (skipProductIds.has(m.id)) return null; // folded into its look card
            if (m.kind === 'product' && m.productRef?.choose) {
              return (
                <ChooserBubble
                  key={m.id}
                  choose={m.productRef.choose}
                  disabled={genLook || pendingRender}
                  onSubmit={(vals) => void onChoose(m.productRef!.choose!.kind, vals)}
                />
              );
            }
            if (m.kind === 'product' && m.productRef?.swap) {
              const sw = m.productRef.swap;
              return (
                <div key={m.id} className="su-msg su-msg--stylist">
                  <div className="su-swap">
                    <div className="su-swap-label">Pick a {sw.label}</div>
                    <div className="su-swap-options">
                      {sw.options.map((o, i) => (
                        <button
                          key={o.id || i}
                          type="button"
                          className="su-swap-opt"
                          onClick={() => void selectSwapOption(sw.role, o, sw.options)}
                          disabled={genLook}
                        >
                          <span className="su-swap-opt-media">
                            {o.image ? <img src={o.image} alt={o.name || ''} loading="lazy" /> : <span className="su-product-media--empty" />}
                          </span>
                          <span className="su-swap-opt-info">
                            {o.brand && <span className="su-swap-opt-brand">{o.brand}</span>}
                            <span className="su-swap-opt-name">{o.name || 'Option'}</span>
                            {o.price && <span className="su-swap-opt-price">{o.price}</span>}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              );
            }
            if (m.kind === 'product' && m.productRef) {
              // One card holding every piece in this pull + a single generate CTA.
              const pieces = lookRunPieces.get(m.id) ?? [m.productRef];
              return (
                <div key={m.id} className="su-msg su-msg--stylist">
                  <div className="su-lookcard">
                    <div className="su-lookcard-title">Your look</div>
                    <div className="su-lookcard-items">
                      {pieces.map((pc, i) => {
                        const role = roleTagFromName(pc.name ?? null);
                        return (
                          <div className="su-lookcard-row" key={pc.id || i}>
                            <button type="button" className="su-lookcard-media" onClick={() => openProduct(pc)} aria-label={`Open ${pc.name || 'product'}`}>
                              {pc.image ? <img src={pc.image} alt={pc.name || 'Product'} loading="lazy" /> : <span className="su-product-media--empty" />}
                            </button>
                            <button type="button" className="su-lookcard-info" onClick={() => openProduct(pc)}>
                              {pc.brand && <span className="su-lookcard-brand">{pc.brand}</span>}
                              <span className="su-lookcard-name">{pc.name || 'Product'}</span>
                              {pc.price && <span className="su-lookcard-price">{pc.price}</span>}
                            </button>
                            {role && (
                              <button
                                type="button"
                                className="su-lookcard-change"
                                onClick={() => void handleSwapRequest({ role, label: role.toLowerCase() })}
                                aria-label={`Change the ${role.toLowerCase()}`}
                              >
                                Change
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    <button
                      type="button"
                      className="su-lookcard-generate"
                      onClick={() => void askScene()}
                      disabled={genLook || pendingRender}
                    >
                      {pendingRender ? 'Generating…' : 'Generate this look'}
                    </button>
                  </div>
                </div>
              );
            }
            if (m.kind === 'render') {
              const r = m.renderGenerationId ? renders[m.renderGenerationId] : null;
              const p = m.productRef;
              const pieces = p?.pieces ?? [];
              const done = r?.status === 'done' && r.video_url;
              const failed = r?.status === 'failed';
              return (
                <div key={m.id} className="su-msg su-msg--stylist">
                  <div className="su-render">
                    {done ? (
                      <button
                        type="button"
                        className="su-render-video-btn"
                        onClick={() => setViewer({ videoUrl: r!.video_url!, pieces, genId: m.renderGenerationId as string })}
                        aria-label="Open look"
                      >
                        <video className="su-render-video" src={r!.video_url!} autoPlay loop muted playsInline />
                        <span className="su-render-expand" aria-hidden="true">
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
                        </span>
                      </button>
                    ) : failed ? (
                      <div className="su-render-status su-render-status--failed">Couldn&apos;t render that look, try another piece.</div>
                    ) : (
                      <div className="su-render-cook">
                        <div className="su-render-status">
                          <span className="su-render-spinner" aria-hidden="true" />
                          <span className="su-render-status-text">
                            Putting your look together…
                            <span className="su-render-eta">
                              {fmtRemaining(generationProgress(r?.created_at ?? m.createdAt, r?.duration_seconds ?? 10).remainingSec)}
                            </span>
                          </span>
                        </div>
                        {/* The pieces going into the look (mirrors the studio's
                            cooking screen), float them while it renders. */}
                        {pieces.length > 0 && (
                          <div className="su-render-pieces">
                            {pieces.slice(0, 6).map((pc, i) => (
                              <span className="su-render-piece" key={pc.id || i} style={{ animationDelay: `${i * 0.18}s` }} title={[pc.brand, pc.name].filter(Boolean).join(' · ')}>
                                {pc.image ? <img src={pc.image} alt="" loading="lazy" /> : <span className="su-product-media--empty" />}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    {done && pieces.length > 0 && (
                      <div className="su-render-pieces su-render-pieces--done">
                        {pieces.slice(0, 6).map((pc, i) => (
                          <span className="su-render-piece" key={pc.id || i} title={[pc.brand, pc.name].filter(Boolean).join(' · ')}>
                            {pc.image ? <img src={pc.image} alt="" loading="lazy" /> : <span className="su-product-media--empty" />}
                          </span>
                        ))}
                      </div>
                    )}
                    {done && (
                      <div className="su-render-cap">
                        <span>{p ? [p.brand, p.name].filter(Boolean).join(' · ') || 'Your look' : 'Your look'}</span>
                        <button
                          type="button"
                          className="su-product-btn su-product-btn--primary"
                          onClick={() => void addToLooks(m.renderGenerationId as string, pieces)}
                          disabled={published.has(m.renderGenerationId as string)}
                        >
                          {published.has(m.renderGenerationId as string) ? 'Added ✓' : 'Add to my looks'}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            }
            return (
              <div key={m.id} className={`su-msg su-msg--${m.sender}`}>
                {m.body && <div className="su-bubble">{m.body}</div>}
              </div>
            );
          })}
          {stylistTyping && typingThreadId === threadId && (
            <div className="su-msg su-msg--stylist">
              <div className="su-bubble su-bubble--typing" aria-label={`${active?.name ?? 'Stylist'} is typing`}>
                <span /><span /><span />
              </div>
            </div>
          )}
          {huntView && (
            <div className="su-msg su-msg--stylist">
              <div className="su-hunting" role="status" aria-live="polite">
                <span className="su-hunting-orb" aria-hidden="true" />
                <span className="su-hunting-text">{HUNT_PHRASES[Math.floor(huntView.elapsed / 2) % HUNT_PHRASES.length]}</span>
                <span className="su-hunting-eta">{fmtRemaining(Math.max(0, huntView.estSec - huntView.elapsed))}</span>
              </div>
            </div>
          )}
          {chatError && !stylistTyping && (
            <button type="button" className="su-chat-retry" onClick={() => void triggerStylist()}>
              {chatError} <span className="su-chat-retry-go">Retry</span>
            </button>
          )}
          {isSuperAdmin && adminNote && (
            <div className="su-admin-note" role="status">
              <span className="su-admin-note-tag">admin</span>
              <pre>{adminNote}</pre>
            </div>
          )}
          {renderError && <div className="su-render-err">{renderError}</div>}
        </div>

        <div className="su-composer">
          <input
            className="su-composer-input"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void send(); } }}
            placeholder={`Message ${active?.name ?? 'your stylist'}…`}
          />
          <button type="button" className="su-composer-send" onClick={() => void send()} disabled={!draft.trim() || sending} aria-label="Send">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
          </button>
        </div>
      </div>
  );

  // ── Landing: conversations only (with a "new message" dot), plus a docked
  // "Find a stylist" button. No stylist roster / "Request" here — starting a new
  // chat happens through the picker. ─────────────────────────────────────────
  const convosPane = (
    <div className="su-page su-page--convos">
      {myThreads.length > 0 ? (
        <div className="su-convos">
          <div className="su-section-label">Your conversations</div>
          {myThreads.map(t => (
            <div className="su-convo-row" key={t.threadId}>
              <button
                type="button"
                className="su-convo-delete"
                onClick={() => void handleDeleteThread(t.threadId)}
                aria-label={`Delete conversation with ${t.stylist.name}`}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                <span>Delete</span>
              </button>
              <button
                type="button"
                className={`su-convo-card${swipedId === t.threadId ? ' is-swiped' : ''}`}
                style={{ ['--su-accent' as string]: t.stylist.accentColor ?? '#8aa0c0' }}
                onTouchStart={e => { swipeStartX.current = e.touches[0].clientX; swipeDX.current = 0; }}
                onTouchMove={e => {
                  swipeDX.current = e.touches[0].clientX - swipeStartX.current;
                  const dx = Math.max(Math.min(swipeDX.current, 0), -96);
                  (e.currentTarget as HTMLElement).style.transform = `translateX(${dx}px)`;
                }}
                onTouchEnd={e => {
                  (e.currentTarget as HTMLElement).style.transform = '';
                  setSwipedId(swipeDX.current < -48 ? t.threadId : null);
                }}
                onClick={() => {
                  if (swipedId === t.threadId) { setSwipedId(null); return; }
                  void openThread(t.threadId, t.stylist);
                }}
              >
                <span className="su-stylist-avatar" aria-hidden="true">
                  <StylistFace avatarUrl={t.stylist.avatarUrl} name={t.stylist.name} />
                </span>
                <span className="su-convo-info">
                  <span className="su-convo-top">
                    <span className="su-stylist-name">{t.stylist.name}</span>
                    <span className="su-convo-time">{relativeTime(t.lastMessageAt)}</span>
                  </span>
                  {t.lastMessage && <span className="su-convo-preview">{t.lastMessage}</span>}
                </span>
                {threadHasNews(t) && <span className="su-convo-dot" aria-label="New message" />}
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="su-convos-empty">
          <p>No conversations yet.</p>
          <p className="su-convos-empty-sub">Find a stylist to start chatting.</p>
        </div>
      )}
    </div>
  );

  const findStylistBar = (
    <div className="su-find-bar">
      <button type="button" className="su-find-btn" onClick={() => void openPicker()}>Find a stylist</button>
    </div>
  );

  // The picker screen — choose from the full roster of stylists.
  const pickerPane = (
    <div className="su-page">
      <div className="su-roster-head">
        <h1>Find a stylist</h1>
        <p>Choose a stylist to start a new conversation.</p>
      </div>
      <div className="su-roster">
        {allStylists.map(s => {
          const meta = [s.age ? `${s.age}` : null, s.city].filter(Boolean).join(' · ');
          return (
            <button
              key={s.id}
              type="button"
              className="su-stylist-card su-person-card"
              style={{ ['--su-accent' as string]: s.accentColor ?? '#8aa0c0' }}
              onClick={() => void openStylist(s)}
              disabled={opening}
            >
              <span className="su-person-avatar" aria-hidden="true">
                <StylistFace avatarUrl={s.avatarUrl} name={s.name} />
              </span>
              <span className="su-stylist-info">
                <span className="su-person-top">
                  <span className="su-stylist-name">{s.name}</span>
                  {meta && <span className="su-person-meta">{meta}</span>}
                </span>
                {s.specialty && <span className="su-stylist-specialty">{s.specialty}</span>}
                {s.bio && <span className="su-stylist-bio">{s.bio}</span>}
              </span>
            </button>
          );
        })}
        {allStylists.length === 0 && <div className="su-empty">Loading stylists…</div>}
      </div>
    </div>
  );

  // Bolder drape on the landing / roster, a faint whisper once a chat is open.
  const bgLayer = <div className="su-bg" aria-hidden="true"><StyleUpBackground intensity={threadId ? 0.4 : 1} /></div>;

  // Landing (/style) → a single-column experience: hero + the two stylist cards,
  // and the full chat once a stylist is open. No two-pane rail here, it reads
  // as a focused landing rather than an inbox.
  if (landing) {
    return (
      <>
        <div className={`su-shell su-shell--landing${threadId ? ' su-shell--landing-thread' : ''}`} style={threadId ? { ['--su-accent' as string]: active?.accentColor ?? '#8aa0c0' } : undefined}>
          {bgLayer}
          {threadId ? threadPane
            : pickerOpen ? <>{header(() => setPickerOpen(false))}{pickerPane}</>
            : <>{railHeader}{landingHero}{convosPane}{findStylistBar}</>}
        </div>
        {viewerOverlay}
      </>
    );
  }

  // Desktop → a true two-pane experience: persistent stylist/conversation rail
  // on the left, the active chat on the right. Mobile → single view.
  if (isDesktop) {
    return (
      <>
        <div className="su-shell su-shell--split" style={{ ['--su-accent' as string]: active?.accentColor ?? '#8aa0c0' }}>
          {bgLayer}
          <aside className="su-rail">{railHeader}{rosterPane}</aside>
          <main className="su-main">
            {threadId ? threadPane : (
              <div className="su-main-empty">
                <div className="su-main-empty-mark" aria-hidden="true">✦</div>
                <p>Pick a stylist, or open one of your conversations, to start chatting.</p>
              </div>
            )}
          </main>
        </div>
        {viewerOverlay}
      </>
    );
  }
  return (
    <>
      <div className="su-shell" style={threadId ? { ['--su-accent' as string]: active?.accentColor ?? '#8aa0c0' } : undefined}>
        {bgLayer}
        {threadId ? threadPane : <>{railHeader}{rosterPane}</>}
      </div>
      {viewerOverlay}
    </>
  );
}
