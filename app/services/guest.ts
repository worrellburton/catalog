// Guest (signed-out) freemium state. With the app open to guests, products
// are fully browsable but looks and creator catalogs are gated behind
// signup. This module owns the small bits of client state that shape that
// gate so the components stay declarative:
//
//   • free-look — the FIRST look a guest opens plays fully (a real taste);
//     every look after that gates. Persisted per-device so a reload doesn't
//     hand out a fresh freebie.
//   • intent — the look/creator a guest tried to open when the gate fired.
//     Stashed across the Google OAuth round-trip so we can drop them right
//     back into it once they sign up (the biggest conversion lift).
//   • scroll nudge — how many times the "register for your daily feed"
//     popup has shown this session, so it re-nudges once then rests.

const FREE_LOOK_KEY = 'catalog:guest:free-look-used:v1'; // localStorage (per-device)
const INTENT_KEY    = 'catalog:guest:intent:v1';         // sessionStorage (survives OAuth)
const NUDGE_KEY     = 'catalog:guest:nudge-count:v1';    // sessionStorage (per-tab session)

export type GuestIntent =
  | { kind: 'look'; uuid: string }
  | { kind: 'creator'; handle: string };

/** A visitor with no Supabase session is a guest. Kept here so every gate
 *  reads "guest" the same way rather than scattering `!user` checks. */
export function isGuest(user: unknown | null | undefined): boolean {
  return !user;
}

// ── First-free-look ─────────────────────────────────────────────────────
// localStorage (not session) so the freebie is once per device — a guest
// shouldn't earn a new free look on every page reload.
export function hasUsedFreeLook(): boolean {
  try { return localStorage.getItem(FREE_LOOK_KEY) === '1'; } catch { return false; }
}
export function markFreeLookUsed(): void {
  try { localStorage.setItem(FREE_LOOK_KEY, '1'); } catch { /* quota / private mode */ }
}

// ── Intent (replay after signup) ────────────────────────────────────────
export function setGuestIntent(intent: GuestIntent): void {
  try { sessionStorage.setItem(INTENT_KEY, JSON.stringify(intent)); } catch { /* */ }
}
/** Read-and-clear the stored intent — single-use so it can't replay twice. */
export function takeGuestIntent(): GuestIntent | null {
  try {
    const raw = sessionStorage.getItem(INTENT_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(INTENT_KEY);
    return JSON.parse(raw) as GuestIntent;
  } catch { return null; }
}

// ── Gate bridge ─────────────────────────────────────────────────────────
// Non-React feature chokepoints (follow, like, …) can't show the signup
// scrim themselves. They call requireSignup() to ask the app shell to
// raise the gate; _index listens for this event and shows it.
export const REQUIRE_SIGNUP_EVENT = 'catalog:require-signup';
export function requireSignup(): void {
  if (typeof window === 'undefined') return;
  try { window.dispatchEvent(new CustomEvent(REQUIRE_SIGNUP_EVENT)); } catch { /* */ }
}

// ── Scroll-nudge cadence ────────────────────────────────────────────────
export function getNudgeCount(): number {
  try { return Number(sessionStorage.getItem(NUDGE_KEY) || '0') || 0; } catch { return 0; }
}
export function bumpNudgeCount(): void {
  try { sessionStorage.setItem(NUDGE_KEY, String(getNudgeCount() + 1)); } catch { /* */ }
}
