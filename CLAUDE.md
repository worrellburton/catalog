# catalog

A visual lookbook webapp for browsing fashion "looks" — short video clips paired with product information. The interface is a zoomable grid of video cards on a dark background.

## Live Site

https://rwb8771.github.io/catalogwebapp/

## Tech Stack

- **Next.js 15** with App Router and TypeScript
- **React 19** with functional components and hooks
- **Static export** — `next build` outputs to `out/` for GitHub Pages deployment
- **No external UI libraries** — all styling via vanilla CSS (`globals.css`)

## Deployment

- **Workflow**: `.github/workflows/deploy.yml` deploys to GitHub Pages
- **Triggers**: Pushes to `main` or any `claude/**` branch
- **Method**: `npm ci` → `npx next build` → uploads `out/` directory as GitHub Pages artifact
- **Base path**: `/catalogwebapp` (configured in `next.config.ts`)
- **Environment**: The GitHub Pages environment must have `claude/**` and `main` listed as allowed deployment branches (configured in repo Settings > Environments > github-pages)

## Git / Branch Permissions

Claude Code sessions can only push to their own session branch (`claude/<description>-<sessionId>`). Pushing to `main` or another session's branch will return a 403. This is by design, not a bug. To get changes onto `main`, merge via PR.

## Key Files

| File | Purpose |
|---|---|
| `src/app/page.tsx` | Main page component — orchestrates all views (password gate, landing, grid, deck) via React state |
| `src/app/layout.tsx` | Root layout with metadata |
| `src/app/globals.css` | All styling. Dark theme, card layout, overlay, landing page, deck, responsive breakpoints |
| `src/components/GridView.tsx` | Main grid of look cards with filtering and search |
| `src/components/LookCard.tsx` | Individual video card with lazy loading via IntersectionObserver |
| `src/components/LookOverlay.tsx` | Detail overlay with video, product list, bookmarking |
| `src/components/BottomBar.tsx` | Search, filter chips, scale slider, bookmarks button |
| `src/components/LandingPage.tsx` | Marketing landing page with hero, features, creator/product sections |
| `src/components/DeckView.tsx` | Investor deck with scroll-snap slides |
| `src/components/PasswordGate.tsx` | Access code gate (123=app, 321=landing, deck=investor deck) |
| `src/components/BookmarksPage.tsx` | Saved looks and products |
| `src/components/CreatorPage.tsx` | Creator catalog showing all looks by a creator |
| `src/components/InAppBrowser.tsx` | Slide-in iframe for product URLs |
| `src/data/looks.ts` | Look data, creator profiles, product info, search suggestions |
| `src/data/catalogNames.ts` | Funny catalog name generator for filter combos |
| `src/hooks/useBookmarks.ts` | Bookmark state management with localStorage persistence |
| `public/*.mp4` | Video assets |
| `next.config.ts` | Next.js config (static export, basePath, asset prefix) |
| `.github/workflows/deploy.yml` | GitHub Actions workflow for building and deploying |

## Navigation / Page Structure

Single-page app with React state-driven views:

1. **Password Gate** — Initial view. Enter '123' for main app, '321' for landing page, 'deck' for investor deck
2. **Splash Screen** — Brief logo animation on transition to main app
3. **Landing Page** — Marketing page with hero, features, creator section, products, CTA
4. **Main Grid** — CSS grid of look cards that can be resized via the bottom slider
5. **Look Detail Overlay** — Opens when you click a card. Shows video + product info. Close with x, Escape, or click outside
6. **Creator Catalog Page** — Shows all looks by a creator
7. **Deck View** — Investor presentation with scroll-snap slides
8. **Bookmarks Page** — Saved looks and products (persisted in localStorage)

## Architecture Decisions

- **Next.js with static export** — React components with SSG, no server runtime needed
- **TypeScript** — Full type safety across components and data
- **Component-based views** — Views managed by React state instead of DOM manipulation
- **Memoized components** — LookCard uses React.memo, filtered looks use useMemo
- **IntersectionObserver for video** — Videos lazy-load and auto-play/pause based on viewport visibility
- **localStorage bookmarks** — Custom useBookmarks hook for persistent state
- **CSS unchanged** — Same CSS class names, migrated from styles.css to globals.css
