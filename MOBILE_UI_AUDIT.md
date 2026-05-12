# Mobile UI Audit — Catalog Consumer App

> Audited on: July 2025  
> Device viewport simulated: 390 × 844 px (iPhone 14 / 15 size)  
> User session: Creator role (logged-in via Google)  
> Pages covered: Main feed, product overlay, account menu, bookmarks, My Catalog, filter panel, creator page (CSS review)

---

## Summary

| Severity | Count |
|---|---|
| 🔴 Bug / broken layout | 2 |
| 🟠 UX issue | 3 |
| 🟡 Behavioral issue | 2 |
| ✅ Confirmed working | 10 |

---

## 🔴 Bugs / Broken Layouts

### 1. Account menu overflows off-screen on short viewports

**File:** `app/styles/user-menu.css`  
**Selector:** `.user-menu-popout`

The account menu popup has **no `max-height` and `overflow-y: visible`**. At the time of audit with only 2 recently-viewed items, the measured rendered height was **526 px** — and the menu starts at ~42 px from the top of the viewport. On a 844 px screen this just fits, but:

- Landscape orientation (e.g. 390 px height) → menu immediately clips
- As users accumulate more recently-viewed items (tiles stack inside the popout), the menu can reach 700–900 px+, silently overflowing off the bottom with no scrollbar

**Symptom:** Lower menu items (Profile, Settings, Sign Out) become unreachable without scrolling — but there is no scroll.

**Fix:**
```css
/* app/styles/user-menu.css */
.user-menu-popout {
  max-height: calc(100dvh - 60px);
  overflow-y: auto;
}
```

---

### 2. Import sub-menu flyout overflows off the left edge of screen

**File:** `app/styles/user-menu.css`  
**Selector:** `.user-menu-flyout`

```css
.user-menu-flyout {
  right: calc(100% + 6px);  /* flies LEFT of the parent menu */
}
```

The parent `.user-menu-popout` is right-aligned (`right: 0`) at **320 px wide**. On a 390 px device:

```
Menu right edge = 390 px
Menu left edge  = 390 - 320 = 70 px
Flyout right edge anchored to menu left = 70 - 6 = 64 px from screen right
Flyout is min-width: 180 px → left edge = 64 - 180 = –116 px ← overflows
```

The flyout extends ~116 px past the left edge of the screen and is invisible/unreachable.

**Fix:** On mobile, change the flyout to drop **below** the parent item instead of flying left:
```css
@media (max-width: 768px) {
  .user-menu-flyout {
    right: 0;
    left: auto;
    top: calc(100% + 4px);
  }
}
```

---

## 🟠 UX Issues

### 3. Filter panel ("Build Your Catalog") has no dismiss button

**File:** `app/components/CatalogBuildPanel.tsx` (or equivalent)

The filter overlay has no visible ✕ / close button. Users can dismiss it only by:
- Tapping the backdrop outside the panel (not obvious to first-time users)
- Tapping "Build My Catalog" (confirms — doesn't cancel)

There is no affordance for "I changed my mind, close this without applying filters." This is particularly problematic on mobile where the panel fills most of the screen.

**Screenshot evidence:** Filter panel fills viewport center with no X in the top-right corner.

**Fix:** Add a close icon button in the panel header area:
```tsx
<button className="catalog-build-close" onClick={onClose} aria-label="Close filters">
  ✕
</button>
```

---

### 4. Creator page uses white background in an otherwise all-dark app

**File:** `app/styles/creator-page.css`

```css
.creator-page {
  background: #fff;     /* hard-coded white */
  color: #111;
}
```

Every other surface in the app is dark (`#0a0a0a` / `#111` / `rgba(0,0,0,0.9)`). Opening a creator's catalog causes an abrupt white-flash transition that breaks the visual continuity. This is especially jarring on OLED devices.

**Fix options:**
1. Match the dark theme: `background: #0a0a0a; color: #f5f5f5`
2. Keep light theme but add a CSS fade transition on page mount
3. Add a `prefers-color-scheme` media query

---

### 5. Product card titles are hard-truncated with no full-text affordance

**Observed on:** Main feed screenshots

Card labels like `"Velvet Off-Duty Cap - Bla..."` and `"4" Alosoft High-Waist He..."` are truncated at roughly 20–25 characters with no tooltip, ARIA label, or tap-to-expand affordance. On the 2-column mobile grid the card width is ~190 px, giving very little room.

This is acceptable as a browsing pattern, but:
- Screen-reader users get a truncated/meaningless label
- Users cannot distinguish similar items (e.g. two Alo Yoga tanks)

**Fix:** Add `title` attribute to the title element, and ensure the full product name is in `aria-label` on the card.

---

## 🟡 Behavioral Issues

### 6. Grid column count not updated on device rotation

**File:** `app/components/FeedSection.tsx`

```tsx
const gridStyle = useMemo(() => {
  if (window.innerWidth <= 768) return {};   // reads viewport ONCE at mount
  // ...
}, [layout, items]);
```

`window.innerWidth` is read once when the component mounts. Rotating from portrait → landscape (or resizing a browser window) does **not** re-run this logic — the grid stays at whatever columns were set at mount time.

**Impact on mobile:** After rotating to landscape, the 2-column grid stays instead of potentially expanding to 3–4 columns.

**Fix:** Add a `resize` listener or use `useWindowSize` hook:
```tsx
const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
useEffect(() => {
  const handler = () => setIsMobile(window.innerWidth <= 768);
  window.addEventListener('resize', handler);
  return () => window.removeEventListener('resize', handler);
}, []);
```
Or, better: move the 2-column override entirely to CSS (it already partially exists in `header.css` via `!important`) and remove the JS check.

---

### 7. Feed mode (snap-scroll) unverified on real devices

**File:** `app/styles/header.css`  
**Selector:** `.feed-mode #grid-container`, `.feed-mode .look-card`

The view-toggle button on mobile cycles through Grid → Vertical → Feed modes. In "Feed mode", cards become `height: 100vh; scroll-snap-align: start` full-screen swipeable cards:

```css
.feed-mode #grid-container {
  display: flex;
  flex-direction: column;
}
.feed-mode #grid-viewport {
  scroll-snap-type: y mandatory;
  height: 100vh;
}
.feed-mode .look-card {
  height: 100vh;
  scroll-snap-align: start;
}
```

This mode was **not visually tested** during this audit. Known risks on mobile:
- `100vh` does not account for the iOS dynamic toolbar (use `100dvh`)
- Snap scrolling on Safari iOS can be unreliable with `overflow-y: scroll` on a non-`body` element
- Bottom bar (position: fixed) overlaps the card at the bottom in this mode

**Fix (preventive):**
```css
.feed-mode #grid-viewport {
  height: 100dvh;  /* dynamic viewport height — respects iOS toolbar */
}
.feed-mode .look-card {
  height: 100dvh;
}
```

---

## ✅ Confirmed Working (No Action Needed)

| Surface | Status | Notes |
|---|---|---|
| Main feed 2-column grid | ✅ | `header.css` forces `repeat(2, 1fr) !important` at `max-width: 768px` |
| Feed `padding-top` clears header | ✅ | `#grid-container { padding-top: 100px }` prevents card/header overlap |
| Look overlay mobile layout | ✅ | Vertical stack, video fills screen, drag handle shown, correct back buttons, safe-area aware |
| Product detail overlay (bottom-sheet) | ✅ | Slides up from bottom at `max-width: 959px`, stacked hero + info layout |
| "More like this" grid in product overlay | ✅ | 2-column layout on mobile |
| Bottom bar (search + filter) | ✅ | Fixed bottom, `env(safe-area-inset-bottom)` aware |
| My Catalog grid | ✅ | `@media (max-width: 600px)` changes to `minmax(150px, 1fr)` — correct 2-col |
| Creator page grid | ✅ | `responsive.css` overrides to `repeat(2, 1fr)` at `768px` |
| Bookmarks page (empty + loaded) | ✅ | Back button, empty state layout clean |
| Auth (login) screen | ✅ | `responsive.css` sets Google/phone buttons to `width: 260px` on mobile |

---

## File Reference Map

| Issue # | CSS File | Component |
|---|---|---|
| #1 Account menu overflow | `app/styles/user-menu.css` | `app/components/UserMenu.tsx` |
| #2 Import flyout off-screen | `app/styles/user-menu.css` | `app/components/UserMenu.tsx` |
| #3 Filter no dismiss button | *(component CSS)* | `app/components/CatalogBuildPanel.tsx` |
| #4 Creator page white BG | `app/styles/creator-page.css` | `app/components/CreatorPage.tsx` |
| #5 Card title truncation | `app/styles/feed.css` / grid CSS | `app/components/PromoCard.tsx` / `LookCard.tsx` |
| #6 Grid not resize-aware | — | `app/components/FeedSection.tsx` |
| #7 Feed mode `100vh` | `app/styles/header.css` | `app/components/FeedSection.tsx` |
