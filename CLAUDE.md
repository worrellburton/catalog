# catalog

A visual lookbook webapp for browsing fashion "looks" — short video clips paired with product information. The interface is a grid of video cards on a dark background.

## Live Site

https://worrellburton.github.io/catalog/

## Tech Stack

- **Remix v2** with Vite in SPA mode and TypeScript
- **React 19** with functional components and hooks
- **Static SPA export** — `remix vite:build` outputs to `build/client/` for GitHub Pages deployment
- **No external UI libraries** — all styling via vanilla CSS (`globals.css`)

## Deployment

- **Workflow**: `.github/workflows/deploy.yml` deploys to GitHub Pages
- **Triggers**: Pushes to `main` or any `claude/**` branch
- **Method**: `npm ci` → `npm run build` → uploads `build/client/` directory as GitHub Pages artifact
- **Base path**: `/catalog/` (configured in `vite.config.ts` via `base` and Remix `basename`)
- **SPA fallback**: `index.html` is copied to `404.html` at build time so GitHub Pages serves the SPA for all routes
- **Environment**: The GitHub Pages environment must have `claude/**` and `main` listed as allowed deployment branches (configured in repo Settings > Environments > github-pages)

## Git / Branch Permissions

Claude Code sessions can only push to their own session branch (`claude/<description>-<sessionId>`). Pushing to `main` or another session's branch will return a 403. This is by design, not a bug. To get changes onto `main`, merge via PR.

## Key Files

| File | Purpose |
|---|---|
| `app/routes/_index.tsx` | Main page component — orchestrates all views (password gate, landing, grid, deck) via React state |
| `app/root.tsx` | Root layout with metadata, CSS import, Remix `<Scripts>` / `<Links>` |
| `app/globals.css` | All styling. Dark theme, card layout, overlay, landing page, deck, responsive breakpoints |
| `app/components/GridView.tsx` | Main grid of look cards with filtering, search, and shuffle |
| `app/components/LookCard.tsx` | Individual video card with lazy loading via IntersectionObserver |
| `app/components/LookOverlay.tsx` | Detail overlay with video, product list, bookmarking |
| `app/components/BottomBar.tsx` | Search, filter chips, bookmarks button |
| `app/components/LandingPage.tsx` | Marketing landing page with hero, features, creator/product sections |
| `app/components/DeckView.tsx` | Investor deck with scroll-snap slides |
| `app/components/PasswordGate.tsx` | Access code gate (123=app, 321=landing, deck=investor deck) |
| `app/components/BookmarksPage.tsx` | Saved looks and products |
| `app/components/CreatorPage.tsx` | Creator catalog showing all looks by a creator |
| `app/components/InAppBrowser.tsx` | Slide-in iframe for product URLs |
| `app/data/looks.ts` | Look data, creator profiles, product info, search suggestions |
| `app/data/catalogNames.ts` | Funny catalog name generator for filter combos |
| `app/hooks/useBookmarks.ts` | Bookmark state management with localStorage persistence |
| `public/*.mp4` | Video assets |
| `vite.config.ts` | Vite + Remix config (SPA mode, basePath, 404.html copy) |
| `.github/workflows/deploy.yml` | GitHub Actions workflow for building and deploying |

## Navigation / Page Structure

Single-page app with React state-driven views:

1. **Password Gate** — Initial view. Enter '123' for main app, '321' for landing page, 'deck' for investor deck
2. **Splash Screen** — Brief logo animation on transition to main app
3. **Landing Page** — Marketing page with hero, features, creator section, products, CTA
4. **Main Grid** — CSS grid of look cards with shuffle button in header
5. **Look Detail Overlay** — Opens when you click a card. Shows video + product info. Close with x, Escape, or click outside
6. **Creator Catalog Page** — Shows all looks by a creator
7. **Deck View** — Investor presentation with scroll-snap slides
8. **Bookmarks Page** — Saved looks and products (persisted in localStorage)

## Architecture Decisions

- **Remix SPA mode** — Client-side only SPA, no server runtime needed. Vite builds static assets.
- **TypeScript** — Full type safety across components and data
- **Component-based views** — Views managed by React state instead of DOM manipulation
- **Memoized components** — LookCard uses React.memo, filtered looks use useMemo
- **IntersectionObserver for video** — Videos lazy-load and auto-play/pause based on viewport visibility
- **localStorage bookmarks** — Custom useBookmarks hook for persistent state
- **`import.meta.env.BASE_URL`** — Vite's built-in env var used for asset paths (replaces Next.js basePath)
