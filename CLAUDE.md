# catalog

A visual lookbook webapp for browsing fashion "looks" — short video clips paired with product information. The interface is a draggable, zoomable grid of video cards on a dark background.

## Live Site

https://rwb8771.github.io/catalogwebapp/

## Deployment

- **Workflow**: `.github/workflows/deploy.yml` deploys to GitHub Pages
- **Triggers**: Pushes to `main` or any `claude/**` branch
- **Method**: Static site — the workflow uploads the entire repo root as a GitHub Pages artifact (no build step)
- **Environment**: The GitHub Pages environment must have `claude/**` and `main` listed as allowed deployment branches (configured in repo Settings > Environments > github-pages)

## Git / Branch Permissions

Claude Code sessions can only push to their own session branch (`claude/<description>-<sessionId>`). Pushing to `main` or another session's branch will return a 403. This is by design, not a bug. To get changes onto `main`, merge via PR.

## Key Files

| File | Purpose |
|---|---|
| `index.html` | Single-page app shell. Contains the header (logo), grid viewport, bottom scale slider, and the look detail overlay markup. |
| `styles.css` | All styling. Dark theme (`--bg: #000`), card layout, overlay, creator catalog page, bottom slider pill, responsive breakpoints. |
| `app.js` | All application logic: look data, grid rendering, drag-to-pan, scale slider, video hover playback, look detail overlay, creator catalog pages. |
| `girl.mp4` | Video asset used for odd-numbered looks. |
| `guy.mp4` | Video asset used for even-numbered looks. |
| `.github/workflows/deploy.yml` | GitHub Actions workflow for deploying to GitHub Pages on push. |

## Navigation / Page Structure

This is a single-page app with no router — all views are DOM overlays:

1. **Main Grid** — The default view. A CSS grid of look cards (3:1 aspect ratio) that can be panned by click-dragging and resized via the bottom slider.
2. **Look Detail Overlay** — Opens when you click a card. Shows the video on the left and product info (name, price) on the right. Close with the × button, Escape key, or clicking outside.
3. **Creator Catalog Page** — Opens when you click a creator name (e.g. `@sophia`) on a card. Shows all looks by that creator in a scrollable grid. Has a back button to return to the main grid.

## Architecture Decisions

- **No build tools / no framework** — Plain HTML, CSS, and vanilla JavaScript. No bundler, no transpiler, no npm. Files are served as-is.
- **No client-side router** — Views are managed by adding/removing DOM elements and toggling CSS classes (`hidden`).
- **Look data is inline** — The `looks` array in `app.js` contains all look metadata (title, video file, creator, description, products). There is no API or database.
- **Videos play on hover** — Cards show a static first frame by default (`preload="metadata"`). Video plays on `mouseenter` and resets on `mouseleave`. The detail view autoplays.
- **Drag-to-pan** — The grid container is absolutely positioned and translated via `transform`. Mouse and touch events track deltas to update the pan offset. A `hasDragged` flag prevents click events from firing after a drag.
