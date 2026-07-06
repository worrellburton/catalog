# Catalog — Strategy Memo

*Prepared for the founder · 2026-07-06 · Direct, no-hedge assessment*

## Bottom line up front

Catalog is not fundable today as a traction round, but it is fundable as a **technical-founder capability bet** — and if you pitch it that way, honestly, you can raise. The engineering is genuinely impressive and the two hard assets are real: a working selfie-to-video try-on pipeline and a self-healing occasion-enriched catalog engine. But the business does not exist yet: 17 lifetime event-firing users (all founder/dev/QA), 35 lifetime clickouts with zero in the last 7 days, no orders table, no retention curve possible, and your headline "self-growth" engine is switched **off** in production. The one USP to bet on is **"AI stylist + your-own-selfie try-on video for occasion-based shopping"** — not "shoppable-video feed," which is a graveyard. The single biggest thing blocking a raise is that **your in-app deck narrative outruns your database by three orders of magnitude**, and any competent investor surfaces that in five minutes of diligence — which reads as either not knowing your numbers or hiding them. Fix that gap (real users → one retention curve → one owned intent funnel) before you send a deck, and reframe the story to match what's actually de-risked: the infra, not the flywheel.

## What Catalog actually is

Strip the pitch and here is the ground truth, code-verified against the live DB (project `vtarjrnqvcqbhoclvcur`, queried 2026-07-06):

**What's real and load-bearing:**
- A polished consumer lookbook shipping on two surfaces — Remix SPA (catalog.shop) and a mature Flutter iOS/Android native shell. Feed, look/product/creator/brand overlays, comments, follows, bookmarks, in-app checkout iframe, a real HLS playback director.
- **Try-on video ("see it on me")** — the genuinely hard, novel capability. `generate-look` (842 lines): selfie + picks → owned-bucket image re-host → Fal Seedance-2 reference-to-video → `fal-webhook` writes `video_url` back. Server pg_net trigger, idempotent, Veo fallback coded. **123 generations, 110 done, 12 distinct users.** Not a mock.
- **AI stylist "Style Up"** (`style-up-chat`, 427 lines) on `/style` — occasion-aware retrieval over the live catalog via BM25, grounds only to real catalog rows (no hallucinated products), Claude Sonnet with heuristic fallback.
- **Daily Feed personalization** (`personalize-feed`, 787 lines) — deterministic re-rank over `user_events` + Claude Opus re-rank, cached per (user, day). Live (`auto_editor_enabled=true`), 89 rows across 14 users.
- **Self-healing catalog engine** — crawl → scrape → 3× Claude enrich → embed → activate, on pg_cron. 174 products came in fully enriched via the `brand_url` path with zero human touch.
- Brand/Shopify OAuth + sync, Dots creator-payout rails, AI-persona creation — all wired to real Supabase tables.

**What's built but inert or unproven:**
- **The seeding engine is OFF** (`seeding_enabled='false'`). The "it grows itself" loop has never run in production; 127 approved + 37 pending `seed_targets` sit idle.
- **No demand.** 73 profiles / 77 auth users, 4 new in the last 7 days, 5 weekly-active, 17 lifetime event-firers. 39,265 of ~39k events come from those 17. No retention cohort is computable (72 of 73 accounts <90 days old).
- **No GMV.** No orders table exists. Only conversion proxy: 35 lifetime clickouts, most recent June 26, **zero in the last 7 days.**
- **No real supply.** The "184 brands" are product-attribution strings. The actual `brands` table has **4 rows**; `brand_members` has **5**. All 28 Shopify products are inactive due to a structural sync bug.
- **Thin, young catalog.** 504 products / 434 active, nearly all <2 months old, machine-seeded. Only 281/434 active (**65%**) have occasion text — so ~35% of live inventory is invisible to the very stylist that's supposed to be your differentiator.
- **Heavy founder tooling.** 9 in-app investor decks (DeckView V1–V9), an equity/opex/projections modeler, kaizen and equity-advisor edge functions. Real as tools, zero user value as product.

Net: **strong "built," essentially zero "proven."** The moat is capability-based, not traction-based, and currently un-proven on the demand side.

## The market & where the whitespace is

The field splits into two proven models, one gorilla, and a graveyard. Catalog's job is to route around all of them into the one gap nobody owns.

**Creator-affiliate infrastructure (proven, well-funded, but discovery-broken):**
- **LTK** — ~$5–6B annual retail sales, 300K creators, 8K+ brands, 40M shoppers, ~$2B valuation (SoftBank). A curator directory, not a discovery engine. Its own April 2025 app reviews complain products are impossible to find, thumbnails are too small, and taps dump you into an external browser. It's now bolting on a Products Tab + AI search to fix exactly this.
- **ShopMy** — fastest riser: **$1.5B valuation (Oct 2025)**, >$1B GMV, 185K curators, revenue $27M→$80M (+196%), profitable since 2024. Just launched a consumer app (Circles) on the thesis "curated by the obsessed, not the algorithm" — the deliberate *opposite* of your AI-native position.

Both leaders are racing into consumer discovery because they admit browse is unsolved. Both also depend on external-redirect affiliate tracking, which is structurally collapsing: ~1/3 of sales miss attribution in Q4 2025, link-in-bio adds 30–50% drop-off, and AI chatbots increasingly answer the recommendation query so the affiliate click never happens.

**Platform-native & social/live shopping (the gorilla and the graveyard):**
- **TikTok Shop** — $15.1B US GMV 2025 (+68% YoY), ~18% of US social commerce. Critically, **50% of that GMV is short-form video, only 14% is live** — so "shoppable video" is where the money is, but it's a saturation race-to-the-bottom (803K US stores, over half with zero sales). The Jan 2026 US divestiture also removed the ban tailwind that made a TikTok-independent app attractive. Route *around* it — it owns entertainment-impulse, not considered occasion purchases.
- **The graveyard is your clearest warning.** **Flip** — the closest structural analog (standalone social-shopping app, one-click checkout) — raised $236M to a $1.1B valuation, hit 7.8M downloads and 250K new users/day, and **shut down Aug 2025** because it bought GMV with referral bribes and giveaways it couldn't retain. **Amazon Inspire** (TikTok-style feed) was **killed Feb 2025** after 14 months — starved for content ($25/video) and intent-mismatched. **Meta** killed FB + IG Live Shopping (2022–23), removed the Shop tab, is retiring native checkout entirely, and only re-entered creator affiliate in 2026 — even with 2B users it couldn't make in-feed shopping stick. **The Yes** (AI fashion app by an ex-Stitch Fix exec) became a Pinterest feature; **NTWRK** acqui-sold to Herschel.

The lesson: standalone shopping apps without a defensible *supply network* become features of acquirers, and incentive-bought GMV is a mirage.

**AI try-on (validated but commoditizing fast):**
- **Google Doppl** (Dec 2025) is the scariest and most direct threat — AI try-on + AI-generated shoppable video discovery feed + style profile. Essentially your stack at Google scale. But it's **"entirely AI-generated"** content, which sits squarely in the consumer-distrust zone. **Amazon, Walmart, ASOS+AIUTA, Shopify+Genlook, Meta** all shipped generative try-on in 2025. CNBC (Apr 2026) flags try-on startups as margin "silent killers" — the compute is expensive.

**The trust data cuts both ways and dictates your positioning:** only 7% trust a brand *more* for visible AI-generated content, 58% trust it *less*, 91% want AI use disclosed. But 56% of Gen Z and 55% of millennials trust AI shopping *assistants*. **Lead with "AI stylist," be transparent about AI-generated try-on.**

**The whitespace Catalog can own:** *intent-first, occasion-based discovery answered by an AI stylist + a try-on video on the user's OWN body.* Affiliate players are organized around creators you already follow (great for fandom, useless for "I need an outfit for a beach wedding"). Feed players are organized around entertainment (great for impulse, useless for considered purchases). **Nobody serves "I have an occasion, style me" well.** Your defensible seam vs. Doppl specifically: real try-on on the user's actual selfie, not a synthetic avatar. And owning the full discover→try→checkout loop in-app sidesteps the collapsing affiliate attribution model — a genuinely stronger, measurable pitch to brands.

The existential caveat, which aligns with your own internal memory: **the entire thesis is retrieval/coverage-bound.** An occasion stylist is only as good as the catalog it draws from. You have ~184 attribution strings and 65% occasion coverage; LTK has 8K brands, TikTok Shop has millions of SKUs. Catalog depth is the #1 competitive priority *before* any growth-marketing push — because Flip proved buying users ahead of product value just burns cash.

## What you're missing to attract investors

Ordered. The first four are **must-fix before you send a deck.** The rest strengthen the raise.

### MUST-FIX (before you send a deck)

**1. A real, de-contaminated user base.** Every metric is poisoned until team traffic is separated out — 39,265 events from 17 people is founder + dev + QA, not a market. Tag internal accounts (`is_team` / email allowlist) and exclude them from everything you report. Then run one tight acquisition push to a single ICP — early signal across LTK/ShopMy is young women 18–34 — via a creator or niche community, not a broad blast. **Target: 50–200 real, non-team users.** Report the honest number ("142 real users, week 1") — a real 142 beats an implied 10,000, and does NOT get you caught in diligence. Do **not** buy users with incentives; that is precisely the Flip failure mode.

**2. One retention curve.** "Do people come back?" is the first question every seed investor asks, and today it is literally unanswerable. You already log timestamped `user_events` — you're not building tracking, you're building the cohort query. Define one activation event (first try-on completed, or first clickout), compute a weekly-cohort return curve, and call out **D1 return on the Daily Feed hook specifically** — your whole once-per-day thesis lives or dies there. Even a jagged curve on 100 users is fundable. **Benchmark to aspire to (not to claim yet): Whatnot runs >80% month-over-month retention — that's what "retention works" looks like in this category. For a seed fashion-discovery app, a defensible early signal is D30 in the 20–30%+ range on your activated cohort.**

**3. An owned discover→try→clickout intent funnel.** You have no GMV and legacy affiliate attribution is collapsing anyway — so don't chase GMV, chase a clean intent funnel you own in-app. Log the full funnel as discrete events: `feed_view → look_open → product_view → try_on_generated → clickout → checkout_started` (you own the in-app browser iframe, so capture checkout-start signals competitors can't). Report the conversion rate at each step. **The headline number to establish: try-on-completion → clickout rate.** That ratio is your leading indicator of monetizable intent and it's unique to your product. **GMV signal target for a seed conversation: even a few hundred dollars of attributed, closed-loop transacted intent from non-team users is worth more than a projection — one real dollar beats a modeled million.**

**4. Try-on unit economics.** Your moat is also a known margin killer. An investor will ask "what does one generation cost and how often is it good?" — have it on a slide. Log per-generation cost (Fal/Seedance vs. Veo-fallback), latency, and a **real** quality outcome — because your Veo fallback silently marks `status='done'` while animating the selfie's *original* clothes and dropping all picks. "Done" is not "good." Report **cost-per-successful-generation** and **success rate** (currently ~10% hard-fail, plus the silent-wrong-outfit cases). An unmeasured 10%+ failure with a silent-success fallback is a due-diligence landmine.

### LATER (moves you from capability bet toward traction round)

**5. Turn the seeding engine ON and show catalog depth as a live growth curve.** It's your main scale story and it has never run in prod. Turn it on in a controlled window, show a products-per-week chart with occasion-coverage % climbing, and **close the occasion-coverage gap from 65% to ~90%+** before you demo the stylist — stylist quality is capped by coverage, not intelligence.

**6. Onboard 1–3 real brand partners** (not attribution strings). Fix the Shopify sync so at least one brand's products publish live end-to-end, and show one metric of value delivered (clickouts routed to them). Durable independents (Whatnot, LTK, ShopMy) all won on a supply network, not a consumer surface — this is the difference between pre-seed and seed.

**7. Positioning reframe (free, do immediately).** Reframe the deck from "AI-native shoppable-video feed" to "AI stylist + your-own-selfie try-on for occasion-based shopping." This costs nothing and changes how thin metrics are read — it turns "5 weekly actives" into "early users of a genuinely novel capability" instead of "a failed feed."

**8. Hygiene: stop building fundraising tooling.** Freeze DeckView V1–V9, the equity/opex modeler, and the advisor edge functions. Nine deck iterations against 5 weekly-active users signals a founder optimizing the pitch instead of the product. Redirect that effort to items 1–4.

## Your USP

**Recommended positioning (the AI-native angle, with the skeptic's corrections applied — narrower and honest):**

> **One-liner:** *Catalog turns "what do I wear for X" into a shoppable outfit on your own body — you tell an AI stylist the occasion, it assembles a look from a live catalog, and renders it on you as a try-on video, in one app.*

**Category:** An AI-native **"intent-to-outfit" shopping engine** — a personal stylist + real-selfie try-on layer over commerce. Distinct from creator directories (LTK/ShopMy) and entertainment feeds (TikTok Shop). The differentiation is in the *combination*, not any single feature.

**Why it's defensible (the honest, narrower claim):**
- **vs. Google Doppl / Amazon / Walmart:** Not the try-on tech itself — that's commoditizing. The edge is try-on on the user's *actual body from their own footage*, not a synthetic avatar. Consumers say they trust that more (58% trust brands *less* for fully AI-generated content — that's Doppl's exposed flank, and its "entirely AI-generated" feed sits in it).
- **vs. LTK / ShopMy:** They're creator directories with admittedly broken browse and collapsing affiliate attribution. You own the full discover→try→checkout loop in-app, making conversion deterministic and attributable — a stronger pitch to brands.
- **vs. TikTok Shop:** It owns entertainment-impulse and cheap goods; it does not serve intent-driven, occasion-based, styled purchases. Different shopper mode.
- **vs. ChatGPT / general AI agents:** Your stylist grounds only to real catalog rows with a compounding occasion-enriched retrieval space that both the stylist and the personalized feed rank over. A general agent hallucinates products and has no owned try-on or checkout loop.

The defensible thing is the **assembled loop owned end-to-end** — any single layer is copyable; the stack of (real-selfie try-on video) + (occasion-enriched retrieval both engines rank over) + (in-app closed-loop conversion) is the wedge. **But state plainly: that's a thesis until you earn usage.** A moat is defensible *use*, and there is none yet.

**The 3-sentence VC pitch:**

> Catalog is the AI-native way to shop fashion for an occasion: you tell an AI stylist "style me for a beach wedding," it assembles a look from a live, occasion-enriched catalog and renders it on your own body as a try-on video — the whole discover-try-buy loop in one app, which no affiliate directory or entertainment feed does. The defensible layer is two hard, already-live assets: a real selfie-based reference-to-video try-on pipeline (on your body, not a synthetic model — the exact thing Google Doppl can't do and consumers trust more) and a self-healing catalog engine that crawls, Claude-enriches, and embeds products into a queryable occasion space that both the stylist and the feed rank over, so relevance compounds with catalog spend. This is a technical-founder capability round, not a traction round — the hard AI infra is proven in code; the money buys catalog depth and the first retained cohort.

**Runner-up angles (keep as supporting narrative, not the lead):**
- **Supply flywheel** ("manufactures its own supply at compute cost, not the headcount cost LTK/ShopMy pay"). Genuinely differentiated *architecturally* and a great answer to "how do you get to 8K brands" — but the skeptic is right: the engine is OFF, two of its three struts (real brands, the demand-pull loop) don't yet back the pitch, so this is a **runtime-proof-it-first** story, not a lead claim. Turn it on (item 5), then promote it.
- **Closed-loop attribution for brands** — strong *B2B* pitch and a real structural edge over collapsing affiliate tracking, but only credible once you have brand partners (item 6). Lead with it in brand conversations, not the fundraise.

## The investor narrative

Tell it in this order — and tell it as a capability bet, because the honest framing *is* the winning framing here (the DB contradicts any traction claim within minutes of diligence).

- **Problem:** Shopping for a specific occasion is broken. Creator directories (LTK, ShopMy) organize around creators you follow — useless when you don't know what to wear. Entertainment feeds (TikTok Shop) optimize for impulse, not considered purchases. Nobody serves "I have an occasion, style me."
- **Why now:** Generative selfie try-on video just crossed viability and got category-validated by Google, Amazon, and Walmart in 2025. Gen Z now trusts AI shopping assistants (56%) while distrusting synthetic feeds — favoring an "AI stylist" over a Doppl-style all-synthetic feed. And the standalone-feed graveyard (Flip shut Aug 2025, Inspire killed Feb 2025, Meta retreating to link-in-bio) has cleared the field of the wrong model — right as LLM economics make hands-off per-product catalog enrichment affordable.
- **Wedge:** Occasion-based discovery answered by an AI stylist + your-own-selfie try-on video, owning the full loop in one app.
- **Moat (stated as compounding, not as done):** A real selfie ref-to-video pipeline plus a self-healing occasion-enriched catalog that both the stylist and the personalized feed rank over — so relevance compounds with every dollar of catalog spend. Owning the loop also makes conversion attributable, sidestepping the affiliate attribution collapse.
- **What's de-risked vs. what the money buys (say this explicitly — it's the credibility move):** De-risked = the engineering (working try-on pipeline, grounded stylist, crawl→enrich→embed engine, all live in code, shipped by a fast technical founder). The money buys the three unproven things: catalog depth, a first retained cohort, and turning the seeding loop on in production.
- **The ask / milestones:** Fund catalog depth + activation + the first cohort. Concrete 6-month proof points a next round can underwrite: occasion coverage 65%→95%; seeding loop live in prod growing the catalog hands-off; try-on garment-fidelity ≥95% (no silent wrong-outfit "done"); and the only number that matters — a real D7/D30 curve and first clickout→purchase signal from non-team users.

**Say what you're NOT claiming, before diligence says it for you:** no proven demand yet; catalog is thin and machine-seeded and is the real near-term ceiling; the self-growth loop is built but hasn't run in prod; try-on fidelity is imperfect and is your #1 quality fix; supply-side is greenfield. Naming these first converts your biggest liability (a contradicting DB) into a credibility asset (a founder who knows their numbers cold).

## Do-this-next — 60–90 day punch list

Sequenced. Do not send a deck or take a partner meeting until items 1–6 are done.

**Days 0–15 — instrument and de-contaminate (cheapest, highest leverage):**
1. Add an `is_team` flag / email allowlist; exclude team from every reported metric. *(The events already flow — this is a query and a flag, not a build.)*
2. Ship the discover→try→clickout funnel as discrete logged events end-to-end (`feed_view → look_open → product_view → try_on_generated → clickout → checkout_started`).
3. Add per-generation cost + latency + a **real** success flag on try-on (detect and mark the Veo-fallback-wrong-clothes case as failed, not "done").
4. Build the weekly-cohort retention query over existing `user_events`, with D1 Daily-Feed return isolated.

**Days 15–45 — get real users and close the coverage gap:**
5. Turn the seeding engine on in a controlled window; drive occasion coverage 65%→90%+ on active inventory. *(Stylist quality is capped here — do this before any stylist demo.)*
6. Fix the try-on fidelity floor: eliminate the silent Veo-fallback wrong-outfit path (fail loudly and retry, don't ship the wrong clothes marked done). Target ≥95% garment fidelity.
7. Run ONE focused acquisition push to 50–200 real women 18–34 via a creator or niche community. No paid incentives (the Flip trap).

**Days 45–90 — prove the story and prep the raise:**
8. Compute the first retention curve on the real cohort (target: a legible D7/D30 you can defend, even if jagged).
9. Establish the try-on-completion → clickout headline conversion rate, and capture the first real, attributed clickout→purchase dollars.
10. Onboard 1–3 design-partner brands with the Shopify publish loop actually working end-to-end; show clickouts routed to at least one.
11. Rewrite the deck around "AI stylist + your-own-selfie try-on for occasion-based shopping," lead with the four real numbers (real WAU, D7/D30, try-on→clickout rate, cost-per-successful-generation), and explicitly frame it as a capability round.
12. Freeze all founder tooling (DeckView V1–V9, equity/opex modeler, advisor functions) until the above ships. Every hour there is an hour not spent on the four must-fix metrics.

**The one-sentence discipline:** real users → retention → owned intent funnel → try-on unit economics are must-fix-before-raising; catalog-growth demo, brand partners, and the reframe strengthen it. Do not spend another hour on the 9-version deck or the equity modeler until those four exist.

---

Files referenced are all in the research provided; the memo above is the complete deliverable. Key load-bearing numbers to keep straight when you cite them live: **73 profiles / 17 lifetime active / 5 WAU / 35 lifetime clickouts (0 in 7d) / no orders table / 504 products / 65% occasion coverage / seeding OFF / brands table = 4 rows / 123 try-on generations.**