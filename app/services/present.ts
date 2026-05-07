// Shared types + helpers for the /present/ live-mirror feature.
//
// All presenter -> viewer traffic flows through a single public
// Supabase Realtime broadcast channel per presenter slug. The viewer
// (/present/:slug) subscribes without auth; the presenter (Robert's
// logged-in session) publishes state changes. Channel names are
// namespaced under "present:" so they're easy to filter in the
// Supabase dashboard.
//
// One broadcast event name ("tick") carries every payload. The
// envelope's `type` field discriminates: heartbeat / route / cursor
// / overlay / etc. Keeping a single event name means we only have
// one broadcast pipe to listen on, and adding a new payload type
// later is purely additive.

import type { RealtimeChannel } from '@supabase/supabase-js';

export type PresentEventType =
  | 'heartbeat'    // 1 Hz keep-alive + latency check (Phase 1)
  | 'snapshot'     // full state, periodic + on viewer connect (Phase 9)
  | 'route'        // current pathname/hash (Phase 3)
  | 'scroll'       // viewport-relative scroll % (Phase 4)
  | 'cursor'       // viewport-relative pointer coords (Phase 5)
  | 'cursor-leave' // participant left, prune their cursor (Phase 5)
  | 'click'        // click ripple (Phase 6)
  | 'hover'        // hover indicator (Phase 6)
  | 'overlay'      // look/bookmarks/creator overlay state (Phase 7)
  | 'search'       // search/filter state (Phase 8)
  | 'browser';     // in-app browser iframe state (Phase 8)

export interface PresentEnvelope<T = unknown> {
  /** Monotonic counter so the viewer can detect dropped/reordered events. */
  seq: number;
  /** ms since epoch on the presenter clock — used for latency + freshness. */
  sentAt: number;
  /** Payload type discriminator. */
  type: PresentEventType;
  /** Event payload; shape depends on `type`. */
  payload: T;
}

export interface HeartbeatPayload {
  /** Wall-clock ms on the presenter when the heartbeat was generated. */
  ts: number;
}

export const PRESENT_CHANNEL_PREFIX = 'present:';

/** The single broadcast event name. Differentiate via `envelope.type`. */
export const PRESENT_EVENT_NAME = 'tick';

/** Build the Realtime channel name for a given presenter slug. */
export function channelNameFor(slug: string): string {
  return `${PRESENT_CHANNEL_PREFIX}${slug}`;
}

// ---------- Emit bridge (consumer routes -> PresentProvider) ----------
//
// The consumer routes shouldn't have to know whether broadcasting is
// active or how to reach the channel. They dispatch a CustomEvent;
// PresentProvider listens and forwards to broadcast() if connected.
// When broadcasting is off, events are no-ops.

export const PRESENT_EMIT_EVENT = 'present:emit';

interface PresentEmitDetail {
  type: PresentEventType;
  payload: unknown;
}

/**
 * Tell the (possibly-active) PresentProvider to broadcast an event.
 * Safe to call from anywhere in the consumer app — when no broadcast
 * is active, the event has no listeners and silently goes nowhere.
 */
export function emitPresentEvent(type: PresentEventType, payload: unknown): void {
  if (typeof window === 'undefined') return;
  const detail: PresentEmitDetail = { type, payload };
  window.dispatchEvent(new CustomEvent(PRESENT_EMIT_EVENT, { detail }));
}

export type PresentChannel = RealtimeChannel;

// ---------- Payload types ----------

export interface RoutePayload {
  /** Route the presenter is currently viewing, e.g. '/' or '/l/abc-123'. */
  pathname: string;
  /** Hash portion including the leading '#', or empty string. */
  hash: string;
  /** Search portion including the leading '?', or empty string. */
  search: string;
}

export type PresentRole = 'presenter' | 'guest';

export interface CursorPayload {
  /** Stable per-tab identity. */
  id: string;
  /** Display name shown next to the cursor. */
  name: string;
  /** Hex color for the cursor + name pill. */
  color: string;
  /** Distinguishes Robert's cursor from any guest viewer's. */
  role: PresentRole;
  /** Viewport-relative x (0 left, 1 right). */
  x: number;
  /** Viewport-relative y (0 top, 1 bottom). */
  y: number;
}

export interface CursorLeavePayload {
  id: string;
}

export interface ClickPayload {
  /** Viewport-relative x (0..1). */
  x: number;
  /** Viewport-relative y (0..1). */
  y: number;
  /** Hex color so the ripple matches the clicker's cursor. */
  color: string;
  /** Sender id so the viewer can de-dupe / animate per source. */
  sourceId: string;
  /** Stable element id (data-present-id) the click landed on, if any. */
  targetId: string | null;
}

export interface HoverPayload {
  /**
   * Stable element id the presenter is now hovering, or null when
   * the pointer leaves all hoverable surfaces.
   */
  id: string | null;
}

/**
 * Snapshot of the consumer-feed look overlay. Sent from _index.tsx
 * whenever the user opens / closes / changes the open look. Carries
 * the full Look payload so /present/<slug> can render the overlay
 * without ever fetching from Supabase.
 *
 * Typed as `unknown` here to avoid pulling the Look interface into
 * services/present.ts (which is intentionally framework-light). The
 * consumer route + viewer cast at the boundary.
 */
export interface OverlayPayload {
  /** 'look' | 'creator' | 'bookmarks' | 'product' — discriminator for
   *  the kind of overlay that's open. */
  kind: 'look' | null;
  /** Full Look object (cast to ~/data/looks `Look` at the boundary)
   *  when kind === 'look'. Null when overlay is closed. */
  look: unknown;
}

export interface SearchPayload {
  /** Live search query as the presenter types it. */
  searchQuery: string;
  /** Active gender chip on the consumer feed. */
  activeFilter: 'all' | 'men' | 'women';
}

export interface BrowserPayload {
  /** When null, the in-app browser is closed on the presenter. */
  open: false;
  url?: never;
  title?: never;
  product?: never;
}

export interface BrowserOpenPayload {
  open: true;
  url: string;
  title: string;
  /** Optional product the browser was opened for; cast to ~/data/looks `Product`. */
  product?: unknown;
}

export type BrowserStatePayload = BrowserPayload | BrowserOpenPayload;

/**
 * Periodic full-state replay so a viewer joining mid-session can
 * catch up immediately instead of waiting for the next route /
 * scroll / overlay event. The payload bundles the latest of each
 * stateful sub-payload — anything the viewer reduces into its
 * state.
 */
export interface SnapshotPayload {
  route?: RoutePayload;
  scroll?: ScrollPayload[];
  overlay?: OverlayPayload;
  search?: SearchPayload;
  browser?: BrowserStatePayload;
}

export interface ScrollPayload {
  /**
   * CSS-id selector for the scrollable container, or 'window' for
   * documentElement scrolling. Lets the viewer find the equivalent
   * element when it eventually mirrors the scroll position.
   */
  selector: string;
  /** Pixel scroll offset on the presenter. */
  scrollTop: number;
  /** Total scrollable height of the container in px. */
  scrollHeight: number;
  /** Visible viewport height of the container in px. */
  clientHeight: number;
  /**
   * Convenience: scrollTop / max(1, scrollHeight - clientHeight),
   * clamped to [0, 1]. Lets the viewer render a progress bar
   * without recomputing.
   */
  ratio: number;
}

// ---------- Privacy guard ----------

/**
 * Routes that must never be broadcast. Admin tooling stays private,
 * and /present(/-test) routes would create feedback loops if they
 * showed up in the mirror.
 */
const NEVER_BROADCAST_PREFIXES = [
  '/admin',
  '/present',
];

export function isBroadcastableRoute(pathname: string): boolean {
  for (const prefix of NEVER_BROADCAST_PREFIXES) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return false;
  }
  return true;
}

// ---------- Presenter config (shared between menu toggle + provider) ----------

/**
 * localStorage key that holds the active presenter slug. When set,
 * the consumer app's PresentProvider mounts the broadcaster and
 * pushes events. Cleared = no broadcast. Single source of truth so
 * the menu toggle (Phase 10) and the dev test harness write to the
 * same place.
 */
export const PRESENT_SLUG_STORAGE_KEY = 'present:slug';

export function readPresentSlug(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(PRESENT_SLUG_STORAGE_KEY);
  } catch {
    return null;
  }
}

// ---------- Cursor identity ----------

const CURSOR_PALETTE = [
  '#ef4444', '#f97316', '#f59e0b', '#10b981',
  '#06b6d4', '#3b82f6', '#a78bfa', '#ec4899',
  '#84cc16', '#14b8a6', '#0ea5e9', '#d946ef',
];

const PRESENT_ID_STORAGE_KEY = 'present:id';
const PRESENT_NAME_STORAGE_KEY = 'present:name';

/** Deterministic hashed-color picker from a string id. */
export function colorForId(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return CURSOR_PALETTE[Math.abs(hash) % CURSOR_PALETTE.length];
}

/**
 * Returns a stable per-tab participant ID. Persists in sessionStorage
 * so reloads keep the same identity, but a new tab gets a fresh one
 * (so guests opening multiple windows show up as separate cursors,
 * which is the right mental model).
 */
export function getOrCreatePresentId(): string {
  if (typeof window === 'undefined') return 'anon';
  try {
    const existing = window.sessionStorage.getItem(PRESENT_ID_STORAGE_KEY);
    if (existing) return existing;
    const fresh = `p-${Math.random().toString(36).slice(2, 10)}`;
    window.sessionStorage.setItem(PRESENT_ID_STORAGE_KEY, fresh);
    return fresh;
  } catch {
    return `p-${Math.random().toString(36).slice(2, 10)}`;
  }
}

/** Read presenter/guest display name from localStorage, or null if unset. */
export function readPresentName(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(PRESENT_NAME_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function writePresentName(name: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (name) window.localStorage.setItem(PRESENT_NAME_STORAGE_KEY, name);
    else window.localStorage.removeItem(PRESENT_NAME_STORAGE_KEY);
  } catch {
    /* quota — fall back to generated name */
  }
}

/** Pick a friendly default name for a guest with no override. */
export function defaultGuestName(id: string): string {
  // Pull a 4-digit signature from the id so guests in the same room
  // can be told apart at a glance.
  const sig = id.replace(/[^a-z0-9]/gi, '').slice(-4).toUpperCase() || 'XXXX';
  return `Guest ${sig}`;
}

export function writePresentSlug(slug: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (slug) window.localStorage.setItem(PRESENT_SLUG_STORAGE_KEY, slug);
    else window.localStorage.removeItem(PRESENT_SLUG_STORAGE_KEY);
    // Custom event so listeners in the same tab pick up the change
    // (the native 'storage' event only fires across tabs).
    window.dispatchEvent(new CustomEvent('present:slug-changed', { detail: { slug } }));
  } catch {
    /* quota / private mode — broadcast just won't start */
  }
}
