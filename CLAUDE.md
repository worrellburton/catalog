# catalog — AI Context & Guidelines

> This file is the single source of truth for all AI tools (Claude Code, GitHub Copilot, etc.) working in this repo.
> It is split into self-contained sections. Jump to the section relevant to your current task.

## Table of Contents

1. [Consumer App (Catalog)](#section-1--consumer-app-catalog)
2. [Admin Panel — Frontend](#section-2--admin-panel-frontend)
3. [Partners / Brands Portal — Frontend](#section-3--partners--brands-portal-frontend)
4. [Admin Backend](#section-4--admin-backend)
5. [Brands Backend](#section-5--brands-backend)
6. [Development Guidelines](#section-6--development-guidelines)

---

# SECTION 1 — Consumer App (Catalog)

A visual lookbook webapp for browsing fashion "looks" — short video clips paired with product information. The interface is a grid of video cards on a dark background.

## Live Site

https://rwb8771.github.io/catalogwebapp/

## Tech Stack

- **Remix v2** with Vite in SPA mode and TypeScript
- **React 19** with functional components and hooks
- **Static SPA export** — `remix vite:build` outputs to `build/client/` for GitHub Pages deployment
- **No external UI libraries** — all styling via vanilla CSS (`globals.css`)

## Deployment

- **Workflow**: `.github/workflows/deploy.yml` deploys to GitHub Pages
- **Triggers**: Pushes to `main`, `dev`, or `staging` branches
- **Method**: `npm ci` → `npm run build` → uploads `build/client/` directory as GitHub Pages artifact
- **Base path**: `/catalogwebapp/` (configured in `vite.config.ts` via `base` and Remix `basename`)
- **SPA fallback**: `index.html` is copied to `404.html` at build time so GitHub Pages serves the SPA for all routes
- **Environment**: The GitHub Pages environment must have `dev`, `staging`, and `main` listed as allowed deployment branches (configured in repo Settings > Environments > github-pages)

## Git / Branch Strategy

This project uses **three long-lived branches**. All AI tools (Claude Code, GitHub Copilot, etc.) and developers MUST commit directly to the appropriate branch — do **not** create new session or feature branches.

| Branch | Purpose | Maps to |
|---|---|---|
| `dev` | Active development, all new work goes here first | Dev environment |
| `staging` | Pre-release testing and QA | Staging environment |
| `main` | Production-ready code only | Production / GitHub Pages |

### Rules

- **Always work on `dev`** unless explicitly told otherwise
- Merge `dev` → `staging` for QA, then `staging` → `main` for production
- Never push directly to `main` without going through `staging` first
- Never create new `claude/**`, `feature/**`, or session branches — commit to `dev` instead
- Small, focused commits with clear prefixes (`feat:`, `fix:`, `refactor:`, `perf:`)

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

---

# SECTION 2 — Admin Panel (Frontend)

## Overview

The admin panel is a Remix-based internal dashboard for managing the catalog platform — creators, looks, products, brands, campaigns, moderation, and platform settings.

- Route prefix: `app/routes/admin.*`
- Layout shell: `app/routes/admin.tsx`
- Auth: password-gated (access code `admin` — update this section when auth is implemented)

## Key Routes

| Route | Purpose |
|---|---|
| `admin._index.tsx` | Admin dashboard home |
| `admin.looks.tsx` | Manage all looks |
| `admin.incoming-looks.tsx` | Review & approve incoming looks |
| `admin.creators.tsx` | List all creators |
| `admin.creators.$name.tsx` | Individual creator profile & management |
| `admin.brands.tsx` | Brand management |
| `admin.products.tsx` | Product catalog management |
| `admin.campaigns.tsx` | Campaign management |
| `admin.categories.tsx` | Category & tag management |
| `admin.users.tsx` | User management |
| `admin.user.$name.tsx` | Individual user detail |
| `admin.shoppers.tsx` | Shopper accounts list |
| `admin.shoppers.$name.tsx` | Individual shopper profile |
| `admin.shoppers-waitlist.tsx` | Shopper waitlist |
| `admin.incoming-creators.tsx` | Creator applications / onboarding queue |
| `admin.moderation.tsx` | Content moderation queue |
| `admin.reports.tsx` | Reported content |
| `admin.advertisements.tsx` | Ad management |
| `admin.audiences.tsx` | Audience segmentation |
| `admin.revenue.tsx` | Revenue overview |
| `admin.earnings.tsx` | Creator earnings |
| `admin.clickouts.tsx` | Clickout tracking & analytics |
| `admin.activities.tsx` | Activity / audit log |
| `admin.links.tsx` | Link management |
| `admin.musics.tsx` | Music / audio management |
| `admin.places.tsx` | Location / place tags |
| `admin.signup-links.tsx` | Invite / signup link management |
| `admin.search.tsx` | Admin search |
| `admin.appearance.tsx` | Platform appearance settings |
| `admin.settings.tsx` | General platform settings |
| `admin.content.tsx` | Content management |
| `admin.administrators.tsx` | Admin user management |

## Key Patterns

- Shared layout (`admin.tsx`) wraps all admin routes with nav sidebar
- Tables use `SortableTable.tsx` component for sortable columns
- `UserMenu.tsx` for admin profile/logout actions
- Keep heavy data-fetching logic in loaders, not component bodies
- All admin routes are client-side only (SPA mode — no server loaders)

---

# SECTION 3 — Partners / Brands Portal (Frontend)

## Overview

The partners portal is a self-service dashboard for brand partners to manage their storefront, products, campaigns, and analytics. It replaces the previous standalone React app at `/Users/samirmaikap/Sites/catalog-campaign` — use that codebase as the reference implementation for behaviour and API integration patterns.

- Route prefix: `app/routes/partners.*`
- Layout shell: `app/routes/partners.tsx`
- Audience: external brand/partner users
- Server: `/Users/samirmaikap/Sites/catalog-server` (Express + Sequelize + MySQL)
- Previous partners app (reference): `/Users/samirmaikap/Sites/catalog-campaign` (React + Vite + Zustand + TailwindCSS)

## Key Routes

| Route | Purpose |
|---|---|
| `partners._index.tsx` | Partners dashboard home (orders summary, analytics overview) |
| `partners.store.tsx` | Brand storefront management (logo, background, Shopify connection) |
| `partners.products.tsx` | Product listing & management (synced from Shopify) |
| `partners.collections.tsx` | Collection / curated sets management |
| `partners.campaigns.tsx` | Campaign creation & tracking |
| `partners.orders.tsx` | Order management (Shopify orders) |
| `partners.audience.tsx` | Audience insights |
| `partners.growth.tsx` | Growth metrics & analytics (sales, impressions, clickouts, followers) |
| `partners.creative.tsx` | Creative assets & look collaboration |
| `partners.appearance.tsx` | Storefront appearance customisation |

## API Integration

All partners API calls go through the catalog-server under the `/api/campaigns` prefix.

### Base URL by Environment

| Environment | Base URL |
|---|---|
| Local | `VITE_APP_API_URL` env var |
| Dev | `https://api-dev.shopcatalog.app/api/campaigns` |
| Staging | `https://api-staging.shopcatalog.app/api/campaigns` |
| Production | `https://api.shopcatalog.app/api/campaigns` |

### Auth Endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/auth/login` | Email/password login |
| POST | `/auth/login/apple` | Apple Sign-in |
| POST | `/auth/login/google` | Google Sign-in |
| POST | `/auth/request-access` | Brand signup / request access |
| POST | `/auth/forgot-password` | Password reset request |
| POST | `/auth/validate-reset-token` | Validate reset token |
| POST | `/auth/reset-password` | Reset password |
| GET | `/auth/me` | Get current brand user profile |

### Shopify Connection Endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/shopify/auth/:brandId` | Get Shopify OAuth URL |
| GET | `/shopify/redirect-uri` | OAuth callback handler |
| GET | `/shopify/is-connected/:brandId` | Check connection status |
| GET | `/shopify/subscription/:brandId` | Get subscription info |
| POST | `/shopify/subscription/usage` | Create usage record |

### Shopify Product Endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/shopify/item/item-sync/:brandId` | Sync/import products from Shopify |
| GET | `/shopify/item/:brandId` | List all synced products |
| GET | `/shopify/item/:brandId/:productId` | Get single product |
| PATCH | `/shopify/item/:brandId/:productId` | Update product |
| POST | `/shopify/item/:brandId/hideItem/:id` | Hide product |
| POST | `/shopify/item-media/:productId` | Add product media |
| PATCH | `/shopify/item-media/:productId/:orderIndex` | Update media |
| DELETE | `/shopify/item-media/:productId/:orderIndex` | Delete media |
| PATCH | `/shopify/item-variant/:productId/:variantId` | Update variant |

### Shopify Collection Endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/shopify/collection/:brandId` | List collections |
| GET | `/shopify/collection/:brandId/:collectionId` | Get collection |
| POST | `/shopify/collection/:brandId` | Create collection |
| PATCH | `/shopify/collection/:brandId/:collectionId` | Update collection |
| DELETE | `/shopify/collection/:brandId/:collectionId` | Delete collection |
| PUT | `/shopify/collection/:brandId/:collectionId` | Update collection name |
| PUT | `/shopify/collection/products/order` | Reorder products in collection |

### Shopify Orders & Checkout Endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/shopify/orders/:brandId` | Create order |
| PATCH | `/shopify/orders/:brandId` | Update order |
| POST | `/shopify/orders-report/:brandId` | Fetch order reports |
| POST | `/shopify/checkout/:brandId/:itemId` | Create checkout |
| POST | `/shopify/checkout-from-item/:brandId/:itemId` | Create checkout from item |

### Brand Analytics Endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/brands/:brandId/sales` | Sales chart data |
| GET | `/brands/:brandId/followers` | Followers by date |
| GET | `/brands/:brandId/impressions` | Impressions by date |
| GET | `/brands/:brandId/clickouts` | Clickouts by date |
| GET | `/brands/:brandId/activities` | Brand activities |
| GET | `/brands/:brandId/activities/today` | Today's activities |

### Campaign & Ads Endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/ad-campaigns/:brandId` | List campaigns |
| GET | `/ads/:brandId` | List advertisements |
| GET | `/advertisements/:brandId` | List ads (with search/filter/sort) |
| GET | `/audiences/:brandId` | Fetch audiences |

### Billing & Finance Endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/finance/billing` | Get Stripe customer details |
| GET | `/finance/connect` | Create Stripe checkout session |
| GET | `/finance/update` | Update subscription plan |
| GET | `/finance/manage` | Manage Stripe subscription |

### Brand Management Endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/brands/:brandId/media` | Update brand logo / background |
| GET | `/brands?all=true` | Fetch all brands (uses root `/api` URL, not `/api/campaigns`) |

## Shopify Integration Flow

The partners portal integrates with Shopify for product import and sync. This is the core commerce feature.

### Connection Flow

1. Brand user clicks **Connect Shopify** on the Store page
2. Frontend calls `GET /shopify/auth/:brandId` → receives Shopify OAuth URL
3. User redirects to Shopify consent screen and authorises the app
4. Shopify redirects back to `/shopify/redirect-uri?code=...&shop=...&hmac=...`
5. Server validates HMAC, exchanges code for access token, saves session
6. Server registers webhooks for product/order updates
7. Frontend calls `GET /shopify/is-connected/:brandId` to confirm connection

### Product Sync

1. Frontend calls `GET /shopify/item/item-sync/:brandId` to trigger sync
2. Server fetches products from Shopify GraphQL Admin API (paginated)
3. Products stored in `Item` table with `isShopify=true` and `shopifyProductId`
4. Related records created: `ShopifyProductImage`, `ShopifyProductOption`, `ShopifyProductVariant`
5. UTM tracking links generated automatically
6. Server uses multi-threaded processing for large catalogs
7. Frontend polls or re-fetches product list after sync completes

### Product Data Structure

Synced products include: `id`, `title`, `price`, `description`, `featuredMedia`, `images`, `options`, `variants`, `brandLogo`, `isHidden`, `impressions_count`, `clickouts_count`, `owners_count`, `orders_count`

### Environment Variables (Partners Frontend)

```
VITE_APP_ENV=local|dev|staging|prod
VITE_APP_API_URL=http://localhost:8000/api/campaigns
VITE_SHOPIFY_APP_HANDLE=<shopify-app-handle>
VITE_GOOGLE_CLIENT_ID=<google-oauth-client-id>
VITE_APPLE_CLIENT_ID=<apple-signin-client-id>
```

## Key Patterns

- Shared layout (`partners.tsx`) wraps all partner routes with nav sidebar
- Partner-specific data is scoped — never mix admin and partner data layers
- Keep UI style consistent with the admin panel but visually distinct (partners = brand-facing)
- Auth: JWT token stored client-side, sent as `Authorization: Bearer <token>` on all requests
- Roles: `ADMIN`, `FINANCE`, `CREATIVE` (brand-level roles, not platform admin)
- Reference `catalog-campaign` for existing behaviour — replicate, don't reinvent

---

# SECTION 4 — Admin Backend

## Overview

The admin backend is part of the unified catalog-server at `/Users/samirmaikap/Sites/catalog-server`. It is an Express.js app with Sequelize ORM on MySQL.

## API Base URL

| Environment | Base URL |
|---|---|
| Local | `http://localhost:8000/api` |
| Dev | `https://api-dev.shopcatalog.app/api` |
| Staging | `https://api-staging.shopcatalog.app/api` |
| Production | `https://api.shopcatalog.app/api` |

Health check: `GET /ping` → `{ message: 'pong' }`

## Auth Strategy

- **JWT (Bearer Token)**: Primary auth — `Authorization: Bearer <token>` header
- **Secret**: `JWT_SECRET` env var
- **Social login**: Auth0 integration (Apple, Google)

### Authorization Middleware Chain

| Middleware | Purpose |
|---|---|
| `authorizeRequest` | Verify JWT token exists and is valid |
| `authorizeSameUserRequest` | Same user or admin |
| `authorizeAdminRequest` | Admin+ role required |
| `authorizeSuperAdminOrBrandAdminRequest` | Super admin or brand admin |

### User Roles

| Role | Access Level |
|---|---|
| Super Admin | Full platform access |
| Admin | Brand/content admin |
| Data Manager | Data curation |
| Creator | Content creators |
| Brand User | Brand partner users |
| Shopper | Regular app users |
| Viewer | View-only |

## Key Admin Endpoints

All routes prefixed with `/api`.

| Route Group | Base Path | Purpose |
|---|---|---|
| Users | `/users` | Authentication, profiles, roles |
| Brands | `/brands` | Brand management |
| Looks | `/looks` | Look/video content |
| Products | `/products` | Product catalog |
| Items | `/items` | Product details |
| Tags | `/tags` | Content tagging |
| Categories | `/categories` | Content organisation |
| Keywords | `/keywords` | Search/filtering keywords |
| Campaigns | `/campaigns` | Advertising campaigns |
| Explore | `/explore` | Content discovery |
| Home Config | `/home-configurations` | Homepage settings |
| Earnings | `/earnings` | Creator payouts |
| Settings | `/settings` | Platform settings |
| Notifications | `/notifications` | Push/email notifications |
| Collections | `/collections` | Product collections |
| Moderation | `/moderation` | Content moderation |
| Reactions | `/reactions` | Likes/engagement |

### Internal API (Serverless)

Prefix: `/api/internal` — bearer token auth for service-to-service calls.

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/internal/health` | Health check |
| GET | `/internal/shopify/sessions/by-brand/:brandId` | Get Shopify session |
| GET | `/internal/shopify/variants/by-variant-id/:id` | Get variant |
| POST | `/internal/shopify/orders/upsert` | Create/update order |
| GET | `/internal/shopify/orders/:orderId/line-items` | Get order line items |
| POST | `/internal/shopify/orders/line-items` | Create line item |
| PATCH | `/internal/shopify/orders/line-items/:id` | Update line item |
| GET | `/internal/brands/with-orders` | Brands with orders |
| GET | `/internal/brands/:id` | Get brand |
| GET | `/internal/orders/:id` | Get order |
| POST | `/internal/orders` | Create order |
| GET | `/internal/users/:id` | Get user |

## Database

- **Type**: MySQL via Sequelize ORM v5
- **Config**: `DB_HOST`, `DB_PORT=3306`, `DB_NAME=catalog`, `DB_USER`, `DB_PASSWORD`

### Key Models (70+)

| Category | Models |
|---|---|
| Users & Auth | User, UserRole, Role, VerificationCode, Invitation |
| Brands & Commerce | Brand, BrandUser, BrandPaymentsHistory, BrandRevenueHistory |
| Content | Look, LookPhoto, LookVideo, LookMessage, LookMusic, LookLocation |
| Products | Item, ItemLink, ItemStyle, ItemKeyword, ItemLog |
| Shopify | SessionShopify, AccountShopify, ShopifyProductVariant, ShopifyProductOption, ShopifyProductOptionValue, ShopifyProductImage, ShopifyOrderTracking, ShopifyOrderTrackingLineItem |
| Campaigns & Ads | Campaign, Advertisement, Audience, AudienceCreator, AdDiscovery |
| Engagement | Reaction, Tag, KeywordLook, FavoriteCreator, FavoriteBrand, ViewedLook, Discovers |
| Organisation | Category, Section, Keyword, Location, Music, Collection, CollectionProduct |
| Earnings & Payments | Earning, EarningsLedger, EarningsPayoutTask, DailyPayout, PayoutTransfer, WithdrawHistory, Wallet |
| Tracking | SearchLog, UserLogs, MixPanelEvent, ItemLog, UserActivity |
| Other | Settings, SettingsAffiliateLink, Config, HomeConfiguration, SignupLink, Featured, BecomeCreatorRequest |

## Server Project Structure

```
catalog-server/src/
├── index.ts                          # Entry point
├── server/
│   ├── index.ts                      # Express app setup
│   ├── auth.ts                       # Auth strategies & middleware
│   ├── controllers/                  # Route handlers (45+ controllers)
│   ├── models/sequelize/             # Database models (70+ entities)
│   ├── routes/                       # API route definitions
│   ├── services/                     # Business logic (Shopify, Stripe, AWS, etc.)
│   ├── helpers/                      # Utilities & helpers
│   ├── middlewares/                  # Express middleware
│   └── jobs/                         # Cron jobs
└── config/                           # Configuration
```

## Third-Party Integrations

| Service | Purpose |
|---|---|
| Stripe | Payment processing |
| AWS (Lambda, S3, SNS, SQS) | Compute, storage, messaging |
| Cloudinary | Image hosting / optimisation |
| Redis | Caching |
| Auth0 | Social auth (Apple, Google) |
| OpenAI | AI-generated descriptions |
| Mixpanel | Analytics |
| Dots | Creator payout processing |
| Klaviyo | Email marketing |
| Spotify / Apple Music | Music data |

---

# SECTION 5 — Brands Backend

## Overview

Brands/partners API routes live on the same catalog-server under the `/api/campaigns` prefix. The partners frontend at `app/routes/partners.*` calls these endpoints exclusively.

- Server codebase: `/Users/samirmaikap/Sites/catalog-server`
- Previous partners frontend (reference): `/Users/samirmaikap/Sites/catalog-campaign`

## API Base URL

| Environment | Base URL |
|---|---|
| Local | `http://localhost:8000/api/campaigns` |
| Dev | `https://api-dev.shopcatalog.app/api/campaigns` |
| Staging | `https://api-staging.shopcatalog.app/api/campaigns` |
| Production | `https://api.shopcatalog.app/api/campaigns` |

## Auth Strategy

- **JWT (Bearer Token)** — same as admin backend
- Brand user login via `/auth/login` returns JWT
- Token sent as `Authorization: Bearer <token>` on every request
- Middleware: `authorizeBrandUserRequest` for brand-scoped access
- Social login: Apple & Google via Auth0

## Key Endpoints

All relative to `/api/campaigns`.

### Auth

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/auth/login` | Email/password login |
| POST | `/auth/login/apple` | Apple Sign-in |
| POST | `/auth/login/google` | Google Sign-in |
| POST | `/auth/request-access` | Brand signup |
| POST | `/auth/forgot-password` | Password reset request |
| POST | `/auth/validate-reset-token` | Validate reset token |
| POST | `/auth/reset-password` | Reset password |
| GET | `/auth/me` | Get current brand user profile |

### Shopify Connection

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/shopify/auth/:brandId` | Get Shopify OAuth URL |
| GET | `/shopify/redirect-uri` | OAuth callback (code, shop, hmac) |
| GET | `/shopify/is-connected/:brandId` | Check connection status |
| GET | `/shopify/subscription/:brandId` | Get subscription info |
| POST | `/shopify/subscription/usage` | Create usage record |

### Shopify Products

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/shopify/item/item-sync/:brandId` | Trigger product sync from Shopify |
| GET | `/shopify/item/:brandId` | List all synced products |
| GET | `/shopify/item/:brandId/:productId` | Get single product |
| PATCH | `/shopify/item/:brandId/:productId` | Update product |
| POST | `/shopify/item/:brandId/hideItem/:id` | Hide product |
| POST | `/shopify/item-media/:productId` | Add product media |
| PATCH | `/shopify/item-media/:productId/:orderIndex` | Update media |
| DELETE | `/shopify/item-media/:productId/:orderIndex` | Delete media |
| PATCH | `/shopify/item-variant/:productId/:variantId` | Update variant |

### Shopify Collections

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/shopify/collection/:brandId` | List collections |
| GET | `/shopify/collection/:brandId/:collectionId` | Get collection |
| POST | `/shopify/collection/:brandId` | Create collection |
| PATCH | `/shopify/collection/:brandId/:collectionId` | Update collection |
| DELETE | `/shopify/collection/:brandId/:collectionId` | Delete collection |
| PUT | `/shopify/collection/:brandId/:collectionId` | Update collection name |
| PUT | `/shopify/collection/products/order` | Reorder products |

### Shopify Orders & Checkout

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/shopify/orders/:brandId` | Create order |
| PATCH | `/shopify/orders/:brandId` | Update order |
| POST | `/shopify/orders-report/:brandId` | Fetch order reports |
| POST | `/shopify/checkout/:brandId/:itemId` | Create checkout |
| POST | `/shopify/checkout-from-item/:brandId/:itemId` | Create checkout from item |

### Analytics

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/brands/:brandId/sales` | Sales chart data |
| GET | `/brands/:brandId/followers` | Followers by date |
| GET | `/brands/:brandId/impressions` | Impressions by date |
| GET | `/brands/:brandId/clickouts` | Clickouts by date |
| GET | `/brands/:brandId/activities` | Brand activities |
| GET | `/brands/:brandId/activities/today` | Today's activities |

### Campaigns & Ads

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/ad-campaigns/:brandId` | List campaigns |
| GET | `/ads/:brandId` | List advertisements |
| GET | `/advertisements/:brandId` | List ads (search/filter/sort) |
| GET | `/audiences/:brandId` | Fetch audiences |

### Billing & Finance

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/finance/billing` | Get Stripe customer details |
| GET | `/finance/connect` | Create Stripe checkout session |
| GET | `/finance/update` | Update subscription plan |
| GET | `/finance/manage` | Manage Stripe subscription |

### Brand

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/brands/:brandId/media` | Update brand logo / background |

## Shopify Integration (Server-Side)

### Key Server Files

| File | Purpose |
|---|---|
| `src/server/controllers/shopifyAuthController.ts` | OAuth flow, HMAC verification, session management |
| `src/server/services/shopifyDataSync.ts` | Product/variant/collection sync (multi-threaded) |
| `src/server/services/shopify.ts` | Shopify API wrapper for orders |
| `src/server/helpers/shopifyClient.ts` | GraphQL client for Shopify Admin API |
| `src/server/helpers/shopifyProductQuery.ts` | Product/media/variant GraphQL queries |
| `src/server/helpers/shopifyCollectionQuery.ts` | Collection GraphQL queries |
| `src/server/helpers/shopifySubscriptionQuery.ts` | Subscription & usage GraphQL queries |
| `src/server/models/sequelize/shopifySession.ts` | OAuth session storage |
| `src/server/models/sequelize/accountShopify.ts` | Shopify store account details |

### Shopify API Version

- Admin API: `2024-01`
- GraphQL endpoint: `https://{store}.myshopify.com/admin/api/2024-01/graphql.json`

### OAuth Flow (Server-Side)

1. `GET /shopify/auth/:brandId` → generate OAuth URL with scopes
2. User authorises on Shopify
3. `GET /shopify/redirect-uri?code=...&shop=...&hmac=...` → HMAC validation (SHA-256), exchange code for access token, create storefront access token, save session in `SessionShopify` table, register webhooks

### Product Sync (Server-Side)

1. Fetch products via Shopify GraphQL (paginated)
2. Store in `Item` table with `isShopify=true`, `shopifyProductId`
3. Create `ShopifyProductImage`, `ShopifyProductOption`, `ShopifyProductVariant` records
4. Generate UTM tracking links
5. Multi-threaded pool processing for large catalogs

### Shopify Data Models

| Model | Purpose |
|---|---|
| `SessionShopify` | OAuth session (access token, shop domain) |
| `AccountShopify` | Shopify store account details |
| `ShopifyProductVariant` | Product variants (size, colour, etc.) |
| `ShopifyProductOption` | Product options |
| `ShopifyProductOptionValue` | Option values |
| `ShopifyProductImage` | Product images |
| `ShopifyOrderTracking` | Order tracking |
| `ShopifyOrderTrackingLineItem` | Order line items |

### Shopify Env Vars (Server)

```
SHOPIFY_CLIENT_ID=<oauth-app-client-id>
SHOPIFY_CLIENT_SECRET=<oauth-app-secret>
SHOPIFY_SCOPES=read_products write_products ...
SHOPIFY_REDIRECT_URI=<oauth-callback-url>
SHOPIFY_APP_URL=<shopify-app-url>
```

---

# SECTION 6 — Development Guidelines

## Universal AI-Assisted Development Guidelines (Claude + Copilot + Others)

Create a **tool-agnostic development standard** that works seamlessly across:

* Claude Code
* GitHub Copilot
* VS Code AI extensions
* Any future AI coding assistants

The goal is to ensure **consistent, scalable, and high-quality code**, regardless of which AI tool a developer uses.

---

## 1. Core Principles (Tool-Agnostic)

These rules apply **regardless of AI tool**:

* Follow **modular architecture**
* Maintain **clear separation of concerns**
* Prefer **readability over cleverness**
* Always design for **scalability**
* Avoid duplication at all costs

---

## 2. Standard Project Structure

All developers and AI tools must follow this structure:

```
/ui            → frontend components
/services      → business logic & APIs
/models        → types, schemas, entities
/utils         → reusable helpers
/config        → environment & setup
/hooks         → reusable hooks (if frontend)
/constants     → static values
```

Rules:

* No cross-layer mixing (e.g., UI calling DB directly)
* Services act as the **single source of truth for logic**

---

## 3. File Creation Contract (CRITICAL)

Whenever ANY AI tool creates a new feature, it MUST follow this contract:

### 3.1 Before Creating Code

* Search for existing implementation
* Reuse or extend if possible
* Identify correct layer (ui / service / model)

### 3.2 Required File Set Per Feature

When adding functionality, ALWAYS consider:

* Model (types/schema)
* Service (logic)
* API/Controller (if backend)
* UI (if needed)

No partial implementations.

---

## 4. AI Sub-Agent Thinking (Universal Pattern)

Even if the tool doesn't support sub-agents explicitly (like Copilot), developers MUST think in this structure:

### UI Role

* Components
* Layout
* UX
* No heavy logic

### Backend Role

* API routes
* Validation
* Request handling

### Service Role

* Core business logic
* Reusable workflows

### Data Role

* Models
* DB queries
* Schema design

### Architecture Role

* Folder structure
* Code organization
* Refactoring

### Performance Role

* Optimization
* Efficient API usage
* Rendering improvements

---

## 5. Code Generation Rules (Applies to All AI Tools)

When generating code:

* Always include **types/interfaces**
* Avoid `any`
* Keep files **< 300 lines**
* One responsibility per file

### Standard File Template

```ts
// imports

// types/interfaces

// constants (if any)

// main logic

// helpers

// exports
```

---

## 6. Naming Conventions

* Components → PascalCase
* Functions → camelCase
* Variables → camelCase
* Constants → UPPER_CASE
* Files → kebab-case or PascalCase (consistent per project)

---

## 7. API Standards

* RESTful structure
* Consistent response:

```json
{
  "success": true,
  "data": {},
  "error": null
}
```

* Always validate inputs
* Never expose raw errors

---

## 8. Reusability First

Before writing code:

* Search existing utils/services
* Extend instead of duplicate
* Extract shared logic early

---

## 9. Environment Rules

* Use `.env` for all secrets
* Never hardcode credentials
* Maintain separate configs:

  * dev
  * staging
  * production

---

## 10. Git & Collaboration

### Branch Strategy

Use **three long-lived branches only** — do NOT create feature branches, session branches, or any other temporary branches:

| Branch | Purpose |
|---|---|
| `dev` | All active development — default target for all AI-generated changes |
| `staging` | Pre-release QA and testing |
| `main` | Production only — merged from `staging` after QA |

### Commit Rules

* Always commit to `dev` unless explicitly instructed otherwise
* Small, focused commits — one logical change per commit
* Use prefixes:

  * `feat:` — new feature
  * `fix:` — bug fix
  * `refactor:` — code restructure, no behaviour change
  * `perf:` — performance improvement

* Never push directly to `main`
* Merge flow: `dev` → `staging` → `main`

---

## 11. Testing Expectations

* Write testable logic
* Keep business logic isolated
* Prefer unit tests for services

---

## 12. AI Usage Rules (IMPORTANT)

### For Claude Users

* Follow sub-agent delegation strictly
* Generate structured, modular code

### For Copilot / VS Code Users

* Do NOT blindly accept suggestions
* Ensure generated code:

  * Matches architecture
  * Uses correct layer
  * Avoids duplication

### Universal Rule

AI is an **assistant, not the architect**.

---

## 13. Feature Development Workflow

For every new feature:

1. Decide structure (Architecture thinking)
2. Define models
3. Implement services
4. Build API layer
5. Build UI
6. Optimize

---

## 14. Code Review Checklist (MANDATORY)

Before merging:

* Is logic in correct layer?
* Any duplication?
* Types defined properly?
* Scalable?
* Readable?
* Reusable?

---

## 15. Anti-Patterns (STRICTLY AVOID)

* Fat components (UI + logic mixed)
* Business logic inside controllers
* Duplicated utilities
* Hardcoded values
* Large unstructured files

---

## 16. Enforcement

If any developer or AI-generated code violates rules:

* Refactor immediately
* Do not merge inconsistent code

---

## 17. Goal

Build a system that:

* Works with ANY AI tool
* Scales across teams
* Stays maintainable long-term

---

**End of Guidelines**
