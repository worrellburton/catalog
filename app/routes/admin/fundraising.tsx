import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from '@remix-run/react';

type Section = 'pitch';
type PitchLength = '30' | '60';

interface Cheatsheet {
  // The literal sentence to open the phase with — read it close to
  // verbatim. Beats riffing every time when you're nervous.
  openWith: string;
  hitThese: string[];
  // Concrete things to show on screen during this phase. Empty list is
  // fine for phases where it's purely conversation.
  showInApp?: string[];
  // Numbers to actually have memorized. Bracketed where the founder
  // needs to fill in the live value before the meeting.
  numbersToKnow?: string[];
  // Investor questions that almost always come up — and the one-line
  // crisp answer to use.
  ifAsked?: { q: string; a: string }[];
  // Pitfalls. Things that have killed past pitches at this stage.
  watchOutFor?: string[];
}

interface Phase {
  title: string;
  description: string;
  // Minutes allotted for this phase. Total of all 10 must equal the
  // pitch length (30 or 60).
  minutes: number;
  cheatsheet: Cheatsheet;
}

const AGENDA_30: Phase[] = [
  {
    title: 'Welcome & the one idea',
    description:
      'State the thesis upfront in one sentence. Catalog is the AI for searching retail. The fundraise starts a flywheel that grows the company on its own.',
    minutes: 1,
    cheatsheet: {
      openWith:
        '"Thanks for making time. The one idea I want to leave you with: Catalog is the AI for searching retail. We\'re replacing the keyword search bar with a fluid discovery experience that\'s built on a flywheel — and the entire ask of this round is to START that flywheel. Once it spins, the company grows on its own. Everything else in the next 25 minutes is evidence for that one sentence."',
      hitThese: [
        'Lock in the positioning in the first 30 seconds: "AI for searching retail" — the same way Google was the AI for documents and Perplexity is the AI for answers, Catalog is the AI for finding what to buy.',
        'Frame the ask as activation, not maintenance. Investors fund flywheels they can light, not treadmills they have to keep pushing.',
        'Confirm who else is on the call and their role.',
        'Set the agenda: problem (search is broken) → demo (fluid discovery) → traction (flywheel starting) → ask (capital that lights it). 7 min for Q&A.',
      ],
      watchOutFor: [
        'Don\'t small-talk past 60 seconds. The one-line thesis is the thing they\'ll repeat to their partner — say it cleanly.',
        'Don\'t hedge "AI for searching" with disclaimers. State it. Defend it for the rest of the meeting.',
      ],
    },
  },
  {
    title: 'The problem: search is broken, no one has a flywheel',
    description:
      'Retail search is 1995 tech. Discovery is friction. No retail platform has a real flywheel — every shopper costs the same to acquire as the last one.',
    minutes: 2,
    cheatsheet: {
      openWith:
        '"Two facts. One: retail search hasn\'t meaningfully changed since 1995 — keywords, lists, filters. Two: no retail platform has a real flywheel. Amazon, Shopify, TikTok Shop, LTK — every one of them pays linear CAC for every new shopper. Catalog fixes both at once: AI replaces the search bar, and that AI experience IS the flywheel input."',
      hitThese: [
        'Search is broken: shoppers describe what they want in their head ("a black tank that drapes"), then translate it into clumsy keywords ("black sleeveless top"), then sort through results that ignore body, context, and taste. The translation step is where every shopper fails or bounces.',
        'No flywheel: Amazon = linear funnel, no compounding. Shopify = stores in isolation. TikTok Shop = rented algorithm distribution. LTK = creator content scales linearly with creator hours. Every existing model pays for the next shopper out-of-pocket.',
        'The unlock: AI generation lets shoppers SEE themselves in the product before they buy — search becomes generation. And every generation is shareable, so each shopper produces content that brings the next shopper in. Search and growth become the same motion.',
        'Why now: AI video at <$0.50/generation only landed in 2025. The flywheel\'s primitive — cheap personalized try-on — was structurally impossible 18 months ago.',
      ],
      ifAsked: [
        {
          q: 'Isn\'t Amazon\'s Rufus this?',
          a: 'Rufus is a chatbot bolted onto Amazon\'s 1995 funnel. It still ends in a list of products you scroll. We replace the result page entirely — the answer to "what should I wear" isn\'t a list, it\'s a 30-second video of you wearing it.',
        },
        {
          q: 'Why hasn\'t Google or Perplexity built this?',
          a: 'They\'re horizontal. Retail discovery requires a structured product catalog, brand integrations, creator revshare, and a generation pipeline tuned to clothes and bodies. None of those are general-purpose problems. We\'re vertical-deep on purpose.',
        },
      ],
      watchOutFor: [
        'Don\'t pitch as a fashion company. The wedge is fashion; the surface is "AI for searching retail" — investors fund category-defining outcomes, not vertical SaaS.',
      ],
    },
  },
  {
    title: 'Demo: extremely fluid discovery',
    description:
      'Show search-as-generation. Land on the feed, do a try-on, share the result, watch a return shopper arrive. Four moves; the flywheel turning live.',
    minutes: 5,
    cheatsheet: {
      openWith:
        '"Let me show you what fluid discovery actually feels like. Four moves — discovery, try-on, share, return shopper — about a minute each."',
      hitThese: [
        'MOVE 1 (discovery, ~60s) — open catalog.shop. No search bar in the user\'s face. Cross-brand mix loads instantly (rag & bone, ALO, Levi\'s). Tap a card → morph into the look detail → tap a product → retailer drawer opens with Bloomingdale\'s, Amazon, Nordstrom side-by-side, "Lowest" badge automatic.',
        'MOVE 2 (try-on, ~3 min — THE DEFINING MOMENT) — open /generate. Upload a face photo. Pick 2 products. Submit. ~30 seconds later: an AI video of THE INVESTOR wearing the products. This is what "AI for searching" looks like in practice — they didn\'t type a keyword, they SAW the answer.',
        'MOVE 3 (share, ~60s) — share sheet on the generated look. Watermark + deep link to catalog.shop/l/<slug>. Native share to TikTok / IG / X. Say: "Every share is a shopper acquisition we paid zero CAC for. K-factor today is [X] and rising."',
        'MOVE 4 (return shopper, ~60s) — paste a share-link in a private browser. Same shoppable experience, no login wall, retailer drawer + cross-brand "More like this". The new shopper enters the loop.',
        'Pause after move 4: "That was one full turn of the flywheel — search replaced by generation, distribution replaced by sharing, CAC replaced by content. We didn\'t pay for anything in that loop."',
      ],
      showInApp: [
        'catalog.shop feed (cross-brand mix front and center)',
        '/generate end-to-end — let the investor watch the AI video render live',
        'Share sheet on the generated look (watermark + deep link visible)',
        'Cold-open of a share-link in a private browser to prove the loop closes',
      ],
      ifAsked: [
        {
          q: 'How is the AI video generated?',
          a: 'Bytedance Seedance via Fal queue. Lite for fast (~30s, <$0.50), Pro for premium (~90s). Prompt assembled from style preset + product role-tags + height + age band. Cost is falling every quarter.',
        },
        {
          q: 'What\'s the share rate today?',
          a: '[X%] of generated try-ons get shared externally. Each share drives [Y] new sessions. K-factor: [X% × Y]. Trending up week-over-week.',
        },
        {
          q: 'Why no search bar?',
          a: 'There IS one for power users. But the default discovery surface is generative, not query-based — because typing keywords is the friction we\'re removing. The search bar becomes a fallback, not the front door.',
        },
      ],
      watchOutFor: [
        'Lead with /generate. The feed is table stakes. The try-on is the moment they remember.',
        'If the demo breaks: "let me send you a 90-second video — runs in <30s normally". Never apologize.',
      ],
    },
  },
  {
    title: 'Market opportunity: AI for searching retail',
    description:
      'Retail e-commerce is $1.1T US. Whoever owns AI-native discovery owns the top of the funnel — the same way Google owned the top of the web.',
    minutes: 2,
    cheatsheet: {
      openWith:
        '"US retail e-commerce is $1.1T. Amazon owns ~38% of it on a 30-year-old search UX. The AI-search layer for the rest of retail is the next $100B+ company — same trajectory as Google for the open web."',
      hitThese: [
        'TAM: global retail e-commerce — $6T+. US: $1.1T, growing 8% YoY.',
        'SAM: AI-native discoverable retail in US/EN — apparel, beauty, home, gear. ~$400B.',
        'SOM 3 years out: 0.5–1% of SAM with the fashion wedge plus category expansion.',
        'Wedge → expansion: fashion (now, cleanest AI generation economics) → beauty (face try-on, year 2) → home (place-in-room, year 2-3) → gear (lifestyle context, year 3+). Same flywheel, same pipeline.',
        'Comparables: Amazon at IPO ($438M), Pinterest at IPO ($13B), Shopify at IPO ($1.3B), Google at IPO ($23B). Every category-defining company looked obvious in hindsight.',
      ],
      numbersToKnow: [
        '[Live MAU on catalog.shop]',
        '[GMV trailing 30 days]',
        '[# active brands integrated]',
        '[# creators with published catalogs]',
      ],
      watchOutFor: [
        'Don\'t pitch only fashion. Lead with "AI for searching retail"; explain fashion as the wedge.',
        'Don\'t use bottom-up TAM and top-down TAM in the same breath. Pick one.',
      ],
    },
  },
  {
    title: 'Traction: the flywheel starting to spin',
    description:
      'Six metrics, each one a face of the flywheel. The signal is they all move together — and K-factor is the line that matters.',
    minutes: 4,
    cheatsheet: {
      openWith:
        '"Six metrics. The signal isn\'t any single number — it\'s that they all move together, because they\'re sides of the same loop. K-factor is the line that matters: when it crosses 1, growth becomes self-sustaining and we don\'t need to pay for shoppers anymore."',
      hitThese: [
        '1. WAU shoppers — current + W/W growth + source split (organic / share-driven / paid). Show share-driven as a growing % of total.',
        '2. Try-ons generated per week — and the per-WAU rate. THIS is the engagement signal that tells you AI-search is the right surface.',
        '3. Share rate — % of generated try-ons that get shared externally. The single most important number on this slide.',
        '4. K-factor — new sessions per share. Show the trend; mark the date if you\'ve crossed K=1. THIS is when the flywheel becomes self-sustaining.',
        '5. Retention W4 / W8 / W12 — generation-flow users retain at 2-3x baseline (they have a personalized artifact + the share loop pulls them back).',
        '6. Brand + creator pull — # new Shopify integrations and # new creators per month. They come AFTER share traffic crosses [Y%] — proof the flywheel pulls supply, not the other way around.',
      ],
      numbersToKnow: [
        '[WAU last 4 weeks, W/W %]',
        '[% of WAU from share-driven traffic]',
        '[Try-ons / week per WAU]',
        '[Share rate %]',
        '[K-factor (current + 4-week trend)]',
        '[W4/W8/W12 retention — generation-flow vs baseline]',
        '[New brand integrations + creators / month]',
      ],
      ifAsked: [
        {
          q: 'What\'s your CAC?',
          a: 'Blended [$X] today — paid CAC to seed the loop. Marginal CAC on share-driven shoppers is approaching zero. When K crosses 1 sustainably, blended CAC follows it down to near-zero.',
        },
        {
          q: 'How do you know the flywheel is real, not vanity?',
          a: 'Three signals: (1) K-factor trending up week-over-week, (2) organic share traffic is now [Y%] of WAU, (3) brand-integration rate accelerated AFTER share traffic crossed [Z%] — they\'re pulling us in, not us chasing them.',
        },
      ],
      watchOutFor: [
        'Don\'t cherry-pick the best week. Show the full trend.',
        'If K is below 1 today, own it: "we\'re seeding the loop. Crosses 1 at [X] WAU per our model. Here\'s how we get there."',
      ],
    },
  },
  {
    title: 'Business model: monetizes at every flywheel input',
    description:
      'Three revenue streams, each layered on a different face of the flywheel. As the loop spins, every stream compounds.',
    minutes: 2,
    cheatsheet: {
      openWith:
        '"Three revenue streams, each riding on a different face of the flywheel. As the loop spins faster, every stream compounds — without any new product work."',
      hitThese: [
        'Affiliate (live): [X%] take rate via FlexOffers / Skimlinks. Each share-driven clickout pays.',
        'Brand subscription (live): tiered SaaS for connected Shopify partners. Brands pay because the flywheel creates organic clickouts they can\'t buy elsewhere.',
        'In-feed product ads (2026): boosted product_creative slots. Pricing scales with WAU; WAU scales with the flywheel.',
        'Per-try-on contribution: cost ~$0.50 (Seedance Lite). Output: [N] product views, [M] clickouts, $[X] affiliate revenue, plus the share-driven shopper acquisition. Each try-on is contribution-positive on day one.',
      ],
      numbersToKnow: [
        '[Current blended take rate]',
        '[# paying brand partners + MRR]',
        '[Avg revenue per try-on shared]',
      ],
      ifAsked: [
        {
          q: 'Why not own checkout?',
          a: 'Owning checkout breaks the flywheel\'s brand-pull side. Brands integrate BECAUSE we send them traffic. The day we own checkout is the day brands churn.',
        },
      ],
      watchOutFor: [
        'Don\'t describe the business as "we\'ll figure out monetization later". The flywheel monetizes at every input.',
      ],
    },
  },
  {
    title: 'Competitive: who\'s structurally locked out',
    description:
      'Amazon, Shopify, TikTok Shop, and creator-commerce stacks each can\'t build this flywheel — for structural reasons specific to their P&L.',
    minutes: 2,
    cheatsheet: {
      openWith:
        '"Four incumbents on the map. Each is structurally locked out of AI-for-searching cross-brand discovery — for reasons specific to their business model, not for lack of capability."',
      hitThese: [
        'Amazon — P&L depends on shoppers staying inside Amazon. Will not generate cross-brand content that links out to Shopify stores. Innovator\'s dilemma in its purest form.',
        'Shopify — value-prop is "your store, your customer". A discovery layer that pools shoppers across competing stores breaks that promise. Brands integrate with us BECAUSE Shopify won\'t.',
        'TikTok Shop — entertainment-first, algorithmic firehose. Can\'t organize a structured catalog around personal taste.',
        'LTK / ShopMy — link-in-bio for the top 1% of influencers. Don\'t generate; locked into fashion + beauty; no AI tooling.',
        'Our moat: the only stack that combines AI generation (Seedance via Fal) + creator-curated catalogs + cross-brand similarity (Marengo embeddings + pgvector) + Shopify partner integrations. ~6 months of engineering per piece. The glue is the moat.',
      ],
      ifAsked: [
        {
          q: 'What stops Amazon from shipping AI search?',
          a: 'They\'ll ship it for Amazon products only — strengthening their walled garden. Our shoppers come BECAUSE they want cross-brand. Different product, different intent. Amazon can\'t ship cross-brand without breaking their P&L.',
        },
      ],
    },
  },
  {
    title: 'Team',
    description:
      'Founders + key hires. Ten seconds per person — the bio is in the deck appendix.',
    minutes: 2,
    cheatsheet: {
      openWith:
        '"Two co-founders. [Name] previously [shipped X at Y]. I previously [shipped X at Y]. Both technical, both have shipped consumer-scale products before."',
      hitThese: [
        'Founder #1: domain edge — the unfair advantage they bring to one face of the flywheel.',
        'Founder #2: complementary skill — the wedge they cover.',
        'Key hire #1 (if any): why this person joined.',
        'Advisors: only name-drop ones who would actually take an investor reference call.',
      ],
      watchOutFor: [
        'Don\'t list every hire. Investors care that the founders can recruit, not the org chart.',
      ],
    },
  },
  {
    title: 'The ask: capital to start the flywheel',
    description:
      'We\'re not raising to grow the company. We\'re raising to start the flywheel. Once it spins, growth is self-sustaining.',
    minutes: 3,
    cheatsheet: {
      openWith:
        '"Raising $[X] on a [valuation] cap. [$Y] already committed. Be clear on what we\'re raising for: we\'re NOT funding ongoing growth. We\'re funding ACTIVATION. Get K above 1 and the company grows on its own — every shopper brings the next one in. This round is the spark; the flywheel is the engine."',
      hitThese: [
        'Round size + valuation + structure.',
        'Existing commitments — names if permitted.',
        'Use of funds, mapped to flywheel inputs:',
        '  — [X%] paid acquisition seed → fuel for the share loop',
        '  — [Y%] AI compute scale (Seedance / Fal) → drives cost-per-try-on down',
        '  — [Z%] brand-partnerships team → closes the brand-pull face',
        '  — [W%] creator acquisition + payouts',
        '  — [V%] engineering on share UX (directly raises K)',
        '  — [U%] runway buffer',
        'Headline milestone for the next raise: K > 1 sustained for [N] consecutive weeks. Once that\'s true, the next round is fundamentally different — we\'re raising to scale a self-spinning flywheel, not to push it.',
      ],
      numbersToKnow: [
        '[Current burn / month]',
        '[Runway pre-round / post-round]',
        '[Current K-factor + target K-factor]',
        '[Cost per generation today vs target]',
      ],
      watchOutFor: [
        'The framing matters: "starting the flywheel" not "growing the company". Investors fund spark moments, not treadmills.',
        'Map every spend bucket to a flywheel input. No "engineering and growth" hand-waves.',
      ],
    },
  },
  {
    title: 'Q&A: every answer ladders to the flywheel',
    description:
      'Open the floor. Capture every question. Every answer ties back to: AI for searching → flywheel input → self-sustaining growth.',
    minutes: 7,
    cheatsheet: {
      openWith:
        '"Open to questions. What\'s on your mind?"',
      hitThese: [
        'Write down every question. Even ones you answer well — they\'re tells about the firm\'s thesis.',
        'Every answer should connect to one of three things: AI for searching, the flywheel, or the self-sustaining growth thesis. If you can\'t connect a question, it\'s a signal you\'re losing the room.',
        'Ask THEM questions: "What would you need to see to move forward?" "Who else at the firm should I meet?"',
        'Close with a concrete next step. Data room link, follow-up call on date, partner intro.',
      ],
      ifAsked: [
        {
          q: 'How does this become a $10B+ outcome?',
          a: 'AI-native discovery + a self-spinning flywheel = the next Amazon. Amazon\'s flywheel didn\'t even include user-generated distribution; ours does. Comparables at IPO: Amazon ($438M), Pinterest ($13B), Shopify ($1.3B). All flywheel businesses. All underestimated at IPO.',
        },
        {
          q: 'What\'s the single biggest risk?',
          a: 'Share rate. If users don\'t share their try-ons, K stays below 1 and we\'re another paid-acquisition company. Mitigation: [N] tested share-UX variants, current share rate [X%], roadmap to push it to [Y%] via [specific lever].',
        },
        {
          q: 'What if AI generation gets commoditized?',
          a: 'Hope so — every cost reduction makes the flywheel cheaper to spin. The moat isn\'t the model; it\'s the loop the model enables.',
        },
      ],
      watchOutFor: [
        'Don\'t end without a concrete next step. "We\'ll be in touch" = dead.',
        'Send the recap email within 4 hours.',
        'If a question doesn\'t map to AI-for-searching / flywheel / self-sustaining-growth, you\'re drifting. Bring it back.',
      ],
    },
  },
];

const AGENDA_60: Phase[] = [
  {
    title: 'Welcome & the one idea',
    description:
      'Lock in the thesis in the first 60 seconds: Catalog is the AI for searching retail. The fundraise starts a flywheel that grows the company on its own.',
    minutes: 3,
    cheatsheet: {
      openWith:
        '"Great to meet. The single sentence I want you walking out of this room repeating to your partner: Catalog is the AI for searching retail, and this round starts a flywheel that grows the company on its own. The next hour is evidence for that one sentence."',
      hitThese: [
        'State the one-line thesis in the first 30 seconds. Don\'t bury it in the deck.',
        'Three threads run through the whole hour: (1) AI for searching — search becomes generation. (2) Extremely fluid discovery — the UX leap. (3) Self-sustaining flywheel — what the round funds.',
        'Reference one specific investment or post the partner has put out.',
        'Confirm everyone on the call. Note titles + who looks engaged.',
        'Set the arc: "Founder story → why retail search is broken → demo (fluid discovery + flywheel turning) → traction (flywheel starting to spin) → ask (capital that lights it). 12 min for Q&A."',
      ],
      watchOutFor: [
        'Don\'t reference a portfolio investment generically. Have one specific point ready.',
        'Don\'t over-prepare rapport. 3 minutes max — the one-sentence thesis is what gets you funded.',
      ],
    },
  },
  {
    title: 'Founder story: why we can activate this flywheel',
    description:
      'The unfair advantage that lets US in particular spin the flywheel — and why the 18-month window is real.',
    minutes: 5,
    cheatsheet: {
      openWith:
        '"Two threads converged. [Co-founder] spent [X years] doing [thing]. I spent [Y years] doing [thing]. The wedge between those is the only place this flywheel actually activates — the rare combination of consumer growth instincts + AI-content engineering + brand relationships."',
      hitThese: [
        'The personal moment: when you saw the flywheel\'s missing primitive (AI try-on at <$1) become possible.',
        'Unfair advantage: why YOU can spin each side. Consumer growth chops for the share-loop side. Engineering for the AI generation side. Brand-network side from prior work.',
        'Why now: AI video at <$0.50/generation only landed in 2025. The flywheel\'s share-side input was structurally impossible 18 months ago.',
        'Why not earlier: Polyvore, Wanelo, ShopStyle all lacked the AI generation primitive. They had the catalog idea but no flywheel input — every piece of content was hand-made.',
        'Why not later: 18 months before incumbents (Amazon AI shopping, TikTok Shop, Pinterest AI) try to spin their own flywheels — and most will fail because their P&L blocks them.',
      ],
      ifAsked: [
        {
          q: 'How long have you been working on this?',
          a: '[N months]. We\'ve been building the flywheel infrastructure deliberately — every system (try-on pipeline, share UX, brand integrations, creator payouts) is one face of the loop.',
        },
        {
          q: 'What did you learn from prior failed attempts in this space?',
          a: 'They tried to build a curated catalog WITHOUT a flywheel input. Without AI generation, every piece of content cost human time — that doesn\'t compound. We waited for the primitive to land, then built the loop on top.',
        },
      ],
      watchOutFor: [
        'Don\'t make the founder story long. Investors want one signal: would you bet years of your life on this? Show conviction in the flywheel thesis.',
      ],
    },
  },
  {
    title: 'The problem: search is broken, no one has a flywheel',
    description:
      'Two facts: retail search is 1995 tech, and no retail platform has a real flywheel. Catalog fixes both with the same primitive: AI generation as the search interface.',
    minutes: 5,
    cheatsheet: {
      openWith:
        '"Two facts that nobody is naming together. Fact one: retail search hasn\'t meaningfully changed since 1995 — keywords, lists, filters. Fact two: no retail platform has a flywheel — Amazon, Shopify, TikTok Shop, LTK all pay linear CAC for every new shopper. Catalog fixes both at once: AI generation replaces the search bar, AND that AI experience IS the flywheel input. Search and growth become the same motion."',
      hitThese: [
        'Search is broken. Shoppers describe what they want in their head ("a black tank that drapes"), translate it into clumsy keywords ("black sleeveless top"), then sift results that ignore body, context, and taste. The translation step is the friction. Most shoppers fail or bounce.',
        'No flywheel — survey the field:',
        '  • Amazon — linear funnel: keyword → list → reviews → buy. Every shopper costs the same as the last.',
        '  • Shopify — sells stores; no shared discovery surface.',
        '  • TikTok Shop — distribution rented from a third-party algorithm. Stop spending, stop growing.',
        '  • LTK / ShopMy — creator content scales linearly with creator labor.',
        '  • Pinterest — closest thing ever shipped, but no AI generation, no shoppable closure. Stalled at $13B.',
        'Our unlock: AI generation lets shoppers SEE themselves wearing the product before buying — search becomes generation. And every generation is shareable, so each shopper produces content that brings the next shopper in. Discovery and growth become the same motion.',
        'The missing primitive (AI try-on at <$0.50) became possible in 2025. The window before incumbents notice: ~24 months. The fundraise is to start the flywheel inside that window.',
      ],
      ifAsked: [
        {
          q: 'Who exactly is the customer?',
          a: 'Two-sided. Shoppers are consumer-facing (free, ad/affiliate monetized). Brands are paying (subscription + ads). Creators are supply-side (revshare). Same shape as YouTube — except the flywheel ALSO uses shoppers as content producers.',
        },
        {
          q: 'Isn\'t Amazon\'s Rufus this?',
          a: 'Rufus is a chatbot bolted onto Amazon\'s 1995 funnel. The result is still a list of products you scroll. We replace the result page entirely — the answer to "what should I wear" isn\'t a list, it\'s a 30-second video of you wearing it.',
        },
        {
          q: 'Why hasn\'t Google or Perplexity built this?',
          a: 'Horizontal AI search can\'t crack vertical retail without: a structured product catalog, brand integrations, a creator revshare model, and a generation pipeline tuned to bodies and clothes. None of those are general problems. We\'re vertical-deep on purpose.',
        },
        {
          q: 'Why fashion first?',
          a: 'Cleanest AI generation economics today. Highest content-to-revenue ratio. The flywheel mechanics port unchanged to beauty, home, and gear.',
        },
      ],
    },
  },
  {
    title: 'Live demo: extremely fluid discovery',
    description:
      'Show what AI-for-searching feels like — and watch the flywheel turn live. Four moves: discover, try-on, share, return shopper.',
    minutes: 10,
    cheatsheet: {
      openWith:
        '"I\'m going to show you what fluid discovery feels like — and the flywheel turning live in the same demo. Four moves. Then I\'ll hand you the keyboard."',
      hitThese: [
        'MOVE 1 (discovery, ~90s) — feed on catalog.shop. Cross-brand mix (rag & bone, ALO, Levi\'s, etc). Tap a look → morph into LookOverlay → tap a product → retailer drawer with Bloomingdale\'s, Amazon, Nordstrom comparison + "Lowest" badge. Hit back → look restores.',
        'MOVE 2 (try-on, ~3 min — THE WOW MOMENT) — open /generate. Upload a face photo (use a generic one, not the investor\'s). Pick 2 products. Submit. While it renders (~30s on Lite), narrate the pipeline: prompt assembly → Fal queue → webhook callback → published look. Show the result. The investor watches a personalized try-on materialize live.',
        'MOVE 3 (share, ~90s) — open the share sheet on the generated look. Show: watermark, deep link to catalog.shop/l/<slug>, native share to TikTok / IG / X. Say: "Every share is a free shopper acquisition. K-factor is [X] today."',
        'MOVE 4 (return shopper, ~90s) — paste a share-link in a fresh browser. Show: same shoppable experience, no login wall, retailer drawer + cross-brand "More like this" feed. The new shopper is now in the loop.',
        'MOVE 5 (admin, only if technical partner) — admin/content → Unpublished → click Model on a row → pipeline node diagram. Shows the engineering depth.',
        'Pause and say: "That was one full flywheel turn — and we paid zero CAC for the new shopper. This is what we\'re activating."',
      ],
      showInApp: [
        'catalog.shop feed (cross-brand mix)',
        'Look detail morph + product page with retailer drawer',
        '/generate end-to-end (face photo → 2 products → live render — let them watch the AI work)',
        'Share sheet on the generated look (watermark + deep link visible)',
        'Cold-open of a share-link in a private browser to prove the loop closes',
        'admin/content Unpublished pipeline panel (only for technical investor)',
      ],
      ifAsked: [
        {
          q: 'How is the AI video so good?',
          a: 'Bytedance Seedance Pro / Lite via Fal. Prompts assembled from style preset + role-tagged products + height + age band. ~30s on Lite, ~90s on Pro. Cost: <$0.50/generation, falling.',
        },
        {
          q: 'What\'s the share rate today?',
          a: '[X%] of generated try-ons get shared externally. New sessions per share: [Y]. K-factor: [X% × Y]. Trending up week-over-week.',
        },
        {
          q: 'IP / consent / model rights?',
          a: 'Generated content is owned by us under Fal\'s commercial license. Face photos are user-uploaded with explicit consent flow. No third-party celebrity faces, ever. Product imagery: crawled with attribution, takedown-respecting; paid Shopify partners license via the partner agreement.',
        },
        {
          q: 'How do you handle copyright on product images?',
          a: 'Same as above for crawled content. For Shopify partners, the brand licenses imagery as part of the integration.',
        },
      ],
      watchOutFor: [
        'Lead with the /generate flow. Investors have seen 100 catalog feeds. Nobody\'s seen their face land in a try-on video on a stranger\'s laptop in 30 seconds.',
        'Run the full flow on the call device 30 min before the meeting. Have a 90-second video as Plan B.',
      ],
    },
  },
  {
    title: 'Market: AI for searching $1T+ of retail',
    description:
      'Whoever owns AI-native search for retail owns the top of the funnel — same trajectory as Google for the open web. Two sizings converge on the same number.',
    minutes: 5,
    cheatsheet: {
      openWith:
        '"US retail e-commerce is $1.1T. Amazon owns 38% on a 30-year-old search UX. The AI-search layer for the rest of retail is the next $100B+ company — same trajectory Google ran for the open web. Two sizings — bottom-up from our funnel, top-down from category benchmarks — converge on the same wedge."',
      hitThese: [
        'TAM: $6T global retail e-commerce. $1.1T US. Growing 8% YoY post-pandemic.',
        'SAM (3 years out): AI-native discoverable retail in US/EN — apparel, beauty, home, gear, accessories. ~$400B addressable.',
        'Bottom-up: [N] target shoppers × [X sessions/yr] × [$Y AOV] × [Z% take rate] = $[A] revenue at saturation.',
        'Top-down: $400B SAM × 1% capture = $4B GMV through-flow → $400M ARR at our take rate. Pinterest IPO\'d at $13B on less.',
        'Wedge → expansion: fashion (now) → beauty (year 2) → home (year 2-3) → gear (year 3+). Same AI pipeline, same creator + brand network.',
        'Comparables: Amazon at IPO ($438M), Pinterest at IPO ($13B), Shopify at IPO ($1.3B). LTK at $2B GMV is a good unit-economics benchmark for the fashion wedge alone.',
      ],
      numbersToKnow: [
        '[Live MAU]',
        '[Sessions per WAU]',
        '[GMV last 30 days, % growth M/M]',
        '[Average order value via Catalog]',
        '[Affiliate take rate by network]',
      ],
      watchOutFor: [
        'Top-down sizing alone gets you laughed out. Always cross-check bottom-up.',
        'Lead with retail, defend with fashion as the wedge. Don\'t flip the order — investors hear "fashion company" and price down.',
      ],
    },
  },
  {
    title: 'Traction: every face of the flywheel turning',
    description:
      'Eight metrics — one per flywheel input/output. Show how they reinforce each other; call out the K-factor inflection.',
    minutes: 8,
    cheatsheet: {
      openWith:
        '"I\'m going to walk you through eight metrics. Each one is one face of the flywheel. The signal isn\'t any single number — it\'s how they move TOGETHER."',
      hitThese: [
        '1. WAU shoppers — current + W/W growth + source split (organic / share-driven / paid). Show share-driven as a growing % of total.',
        '2. Try-ons generated per week — the flywheel input metric. Per-WAU rate is the engagement signal.',
        '3. Share rate — % of generated try-ons that get shared externally. THE single most important number on this slide.',
        '4. K-factor — new sessions per shared try-on. Show the trend; mark the date if you\'ve crossed K=1.',
        '5. Cohort retention W4 / W8 / W12 — call out: generation-flow users retain at 2-3x baseline because they have a personalized artifact.',
        '6. Brand pull — new Shopify integrations / month. Note the acceleration curve (brands come AFTER share traffic crosses [Y%]).',
        '7. Creator pull — new curators publishing / month. They come for the distribution the share loop creates.',
        '8. GMV + MRR — conversion of all the above into revenue. Should compound at the same rate as the loop spins.',
        'Inflection slide: "We shipped [the share UX revamp] in week [X]. K went from [Y] to [Z]. Brand-integration rate doubled the next month. That\'s the flywheel waking up."',
      ],
      numbersToKnow: [
        '[WAU last 4 weeks, W/W %]',
        '[% of WAU from share-driven traffic]',
        '[Try-ons generated / week per WAU]',
        '[Share rate %]',
        '[K-factor (current + 4-week trend)]',
        '[W4/W8/W12 retention — generation-flow vs baseline]',
        '[New brand integrations + creators / month]',
        '[Confirmed GMV + brand MRR]',
        '[Cost per generation today vs 6 months ago]',
      ],
      ifAsked: [
        {
          q: 'What does week-1 to week-4 retention look like?',
          a: '[X%] / [Y%] for generation-flow users — 2–3x baseline. They have a personalized artifact, the share loop pulls them back, and the bookmarks compound across sessions.',
        },
        {
          q: 'When does K cross 1 sustainably?',
          a: 'Per our model: [X WAU] + [Y%] share rate. We\'re at [current values] today. The round closes the gap.',
        },
        {
          q: 'How do you know brand integrations are pulled, not pushed?',
          a: '[N%] of last quarter\'s new brand signups came inbound — they reached out after seeing share-driven clickout volume. We track inbound vs outbound explicitly.',
        },
      ],
      watchOutFor: [
        'Don\'t hide failed cohorts. If a Q3 cohort retained badly, explain why and what changed.',
        'Do NOT present this as 8 isolated metrics. The story is "they all move together because they\'re sides of the same loop".',
      ],
    },
  },
  {
    title: 'Business model: the flywheel monetizes at every input',
    description:
      'Three revenue streams, each layered on a different face of the flywheel. As the loop spins, every stream compounds.',
    minutes: 5,
    cheatsheet: {
      openWith:
        '"Three revenue streams. Each one rides on a different face of the flywheel — so they all grow as the loop spins."',
      hitThese: [
        'AFFILIATE (rides on share-driven traffic): [X%] take rate via FlexOffers / Skimlinks. Each share-loop clickout pays. Live today.',
        'BRAND SUBSCRIPTION (rides on the brand-pull side): tiered SaaS — $[X] starter / $[Y] pro / $[Z] enterprise. Brands pay because the flywheel creates organic clickouts they can\'t buy elsewhere. Live.',
        'IN-FEED ADS (rides on WAU growth): boosted product_creative inventory, capped at ~10% of feed. Pricing scales with WAU; WAU scales with the flywheel. 2026 unlock.',
        'Unit walk-through: shopper opens app → does a try-on (cost: $0.50) → shares it → 1.[X] new shoppers come in → they generate clickouts at $[Y] each. Per-try-on contribution is [$Z]. Compounds.',
        'Long-run unit economics: AS K-factor rises, blended CAC trends to zero. LTV rises with retention. The unit-economic curve is exponential, not linear.',
        'CAC: blended $[X] today (paid to seed the loop). Marginal CAC on share-driven shoppers: ~$0. Payback: [N] months and shrinking each quarter.',
      ],
      numbersToKnow: [
        '[Blended CAC]',
        '[Marginal CAC on share-driven shoppers]',
        '[Avg LTV per shopper]',
        '[Payback period in months]',
        '[Contribution margin per try-on]',
        '[Cost per generation today vs targeted at scale]',
      ],
      ifAsked: [
        {
          q: 'Why is the creator share so [low/high]?',
          a: 'Industry standard for affiliate networks is 0–10%. We pay [X%]. Higher per-clickout than LTK on absolute dollars when you account for the AI generation tooling we provide — they don\'t need to produce content.',
        },
        {
          q: 'When do you become marketplace?',
          a: 'Never. Marketplace = we own checkout = brands churn = brand-pull face of the flywheel breaks. The economic geometry of the loop depends on us NOT owning checkout.',
        },
        {
          q: 'What\'s the contribution margin on a single generated try-on?',
          a: 'Cost: $0.50. Output: [N] product views, [M] clickouts, $[X] affiliate revenue, plus the share-driven shopper acquisition value. Net contribution per try-on is [$Y] — and that ignores the brand-side and ad-side monetization.',
        },
      ],
    },
  },
  {
    title: 'Competitive moat',
    description:
      'Data flywheel, creator network, brand integrations, AI tooling. Why each compounds. Address obvious threats head-on.',
    minutes: 4,
    cheatsheet: {
      openWith:
        '"Four moats, each compounding on the others. The structural one is bigger than any of them: every incumbent in retail is locked out of the wedge by their own business model."',
      hitThese: [
        '1. Generation pipeline. Seedance prompts + role-tagged products + Marengo embeddings + pgvector + Fal queue + webhook orchestration. Proprietary glue, ~6 months of engineering to replicate.',
        '2. Brand network. Shopify partner integration with [N] live brands across [M] categories. Each new brand gives shoppers more cross-brand inventory; each shopper gives brands more clickouts.',
        '3. Creator network. [N] active curators with published catalogs, revshare baked into our payouts pipeline. Defensible because creators don\'t want to maintain catalogs in N places — once we\'re the home, switching cost is high.',
        '4. Data flywheel. Every clickout, save, and generation feeds Marengo + pgvector embeddings → better recommendations → more clickouts. Compounds quarterly.',
        'Structural moat: Amazon won\'t cannibalize their P&L by sending shoppers to Shopify stores. Shopify won\'t cannibalize merchants by pooling shoppers across stores. Meta retired Instagram Shop. The lane is structurally open and the incumbents can\'t close it without breaking their core business.',
      ],
      ifAsked: [
        {
          q: 'What if Amazon ships an AI shopping experience?',
          a: 'They\'ll ship it for Amazon products only — strengthening their walled garden, not opening it to Shopify stores. Our shoppers come to us BECAUSE they want cross-brand. Different product, different intent.',
        },
        {
          q: 'What if Shopify acquires Doji or builds AI try-on?',
          a: 'For individual stores. We\'re the layer ABOVE — cross-brand discovery and curation. Their solution makes individual product pages better; ours owns the top of the funnel before the shopper picks a brand.',
        },
        {
          q: 'What if Meta brings shopping back?',
          a: 'They\'ve tried twice and failed. Even if they restart, they won\'t out-curate a creator-led catalog tied to identity. The trust + revshare + AI generation flywheel is hard to clone with ad money.',
        },
      ],
    },
  },
  {
    title: 'Team & advisors',
    description:
      'Founders + leadership + advisors. The hires we already have signed and the next two we plan to make with the round.',
    minutes: 3,
    cheatsheet: {
      openWith:
        '"Two founders, [N] full-time, [M] advisors with the round."',
      hitThese: [
        'Co-founder #1: [domain edge, e.g. shipped consumer products at scale].',
        'Co-founder #2: [complementary edge, e.g. brand relationships in fashion].',
        'Engineering hires already signed: [N] — name only the senior ones.',
        'Next two hires post-round: [Head of Brand Partnerships, Sr. AI/ML Engineer, etc.] — be specific.',
        'Advisors: only mention ones who would take an investor reference call.',
      ],
      watchOutFor: [
        'Don\'t recite LinkedIn bios. The investor cares about: would these people walk through a wall for this company?',
      ],
    },
  },
  {
    title: 'Ask: capital to start the flywheel',
    description:
      'We\'re not raising to grow the company. We\'re raising to start the flywheel. Once it spins, growth is self-sustaining and the next round funds something fundamentally different.',
    minutes: 12,
    cheatsheet: {
      openWith:
        '"Raising $[X] on a [valuation] cap. [$Y] already committed. The framing matters: we are NOT raising to fund growth. We\'re raising to START the flywheel. Get K above 1 and the company grows on its own — every shopper brings the next one in. After that, capital scales the spin instead of pushing it. This round is the spark; the flywheel is the engine."',
      hitThese: [
        'Round size + valuation + structure (priced / SAFE / convertible).',
        'Existing commitments — names if permitted, otherwise the dollar amount.',
        'Use of funds, mapped face-by-face:',
        '  — [X%] paid acquisition seed → fuels the share-loop input',
        '  — [Y%] AI compute scale (Seedance / Fal) → drives cost-per-try-on down so we can subsidize more',
        '  — [Z%] brand-partnerships team → closes the brand-pull face',
        '  — [W%] creator acquisition + payouts → closes the creator-pull face',
        '  — [V%] engineering on share UX + viral mechanics → directly raises K-factor',
        '  — [U%] runway buffer',
        'Headline milestones for the next raise:',
        '  1. K-factor sustained > 1 for [N] consecutive weeks',
        '  2. [WAU target]',
        '  3. [N] paying brand partners + $[Z]K MRR',
        '  4. Cost per generation < $[Y]',
        '  5. [Revenue runrate]',
        '  6. Beauty vertical launched — flywheel ports to next category',
      ],
      numbersToKnow: [
        '[Current burn / month]',
        '[Runway pre-round / post-round]',
        '[Current K-factor + target K-factor]',
        '[Cost per generation today vs target]',
        '[WAU + share rate today vs target]',
      ],
      ifAsked: [
        {
          q: 'What would you do with 2x more money?',
          a: 'Push paid acquisition harder to seed K=1 faster, and launch the beauty vertical 6 months earlier. AI compute scale comes for free as Fal / Seedance prices drop. NOT engineering hires — engineering is solved with the team we have.',
        },
        {
          q: 'What does the next round look like?',
          a: 'Series A in [N] months at $[X]M raise. The trigger isn\'t revenue — it\'s K > 1 sustained. Once the flywheel is self-spinning, every additional dollar buys exponentially more.',
        },
        {
          q: 'How do you become a $10B+ company?',
          a: 'Self-spinning flywheel + AI-native discovery for $1T+ retail. Amazon\'s flywheel didn\'t even include user-generated distribution; ours does. Comparables: Amazon at IPO ($438M), Pinterest at IPO ($13B), Shopify at IPO ($1.3B). All flywheel businesses, all underestimated at IPO.',
        },
        {
          q: 'What\'s the single biggest risk to the flywheel?',
          a: 'Share rate. If users don\'t share, K stays below 1 and we\'re another paid-acquisition company. Mitigation: [N] tested share-UX variants, current share rate is [X%], roadmap to push it to [Y%] via [specific lever — incentivized shares, watermark optimization, native-first share format, etc.].',
        },
        {
          q: 'What if AI generation gets commoditized?',
          a: 'Hope so — every cost reduction makes the flywheel cheaper to spin. The moat isn\'t the model; it\'s the loop the model enables.',
        },
        {
          q: 'What keeps you up at night?',
          a: 'Pick ONE real risk. Be specific about how you\'re mitigating. Never deflect.',
        },
      ],
      watchOutFor: [
        'Never end without a concrete next step. "We\'ll be in touch" = dead. Push for: data room, partner intro, follow-up scheduled before you hang up.',
        'Send the recap email within 4 hours: questions, answers, asks, decided next steps. This single discipline closes more rounds than any deck slide.',
        'Every Q&A answer should ladder back to the flywheel. If you can\'t connect a question to the loop, you\'re losing the room.',
      ],
    },
  },
];

function formatClock(totalSeconds: number): string {
  const sign = totalSeconds < 0 ? '-' : '';
  const s = Math.abs(totalSeconds);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${sign}${m}:${String(sec).padStart(2, '0')}`;
}

function CheatsheetPanel({ sheet }: { sheet: Cheatsheet }) {
  return (
    <div className="fr-cheat-inner">
      <div className="fr-cheat-section fr-cheat-open-with">
        <div className="fr-cheat-label">Open with</div>
        <div className="fr-cheat-quote">{sheet.openWith}</div>
      </div>

      <div className="fr-cheat-section">
        <div className="fr-cheat-label">Hit these points</div>
        <ul className="fr-cheat-list">
          {sheet.hitThese.map((b, i) => <li key={i}>{b}</li>)}
        </ul>
      </div>

      {sheet.showInApp && sheet.showInApp.length > 0 && (
        <div className="fr-cheat-section">
          <div className="fr-cheat-label">Show in the app</div>
          <ul className="fr-cheat-list fr-cheat-list--mono">
            {sheet.showInApp.map((b, i) => <li key={i}>{b}</li>)}
          </ul>
        </div>
      )}

      {sheet.numbersToKnow && sheet.numbersToKnow.length > 0 && (
        <div className="fr-cheat-section">
          <div className="fr-cheat-label">Numbers to have memorized</div>
          <ul className="fr-cheat-list fr-cheat-list--num">
            {sheet.numbersToKnow.map((b, i) => <li key={i}>{b}</li>)}
          </ul>
        </div>
      )}

      {sheet.ifAsked && sheet.ifAsked.length > 0 && (
        <div className="fr-cheat-section">
          <div className="fr-cheat-label">If asked</div>
          <dl className="fr-cheat-qa">
            {sheet.ifAsked.map((qa, i) => (
              <div key={i} className="fr-cheat-qa-pair">
                <dt>{qa.q}</dt>
                <dd>{qa.a}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {sheet.watchOutFor && sheet.watchOutFor.length > 0 && (
        <div className="fr-cheat-section fr-cheat-warn">
          <div className="fr-cheat-label">Watch out for</div>
          <ul className="fr-cheat-list">
            {sheet.watchOutFor.map((b, i) => <li key={i}>{b}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

interface PhaseTrackerProps {
  agenda: Phase[];
  storageKey: string;
}

// Phase tracker: drives a 10-phase pitch in real time. One phase is
// "active" at a time. When its timer hits 0, it auto-completes and the
// next phase becomes active. State persists per agenda (30 vs 60) in
// localStorage so a refresh doesn't lose the run.
function PhaseTracker({ agenda, storageKey }: PhaseTrackerProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [running, setRunning] = useState(false);
  // Seconds remaining in the active phase. Goes negative if the user
  // lets it run over (so over-runs are visible, not clamped).
  const [secondsLeft, setSecondsLeft] = useState(agenda[0].minutes * 60);
  const [completed, setCompleted] = useState<boolean[]>(() => agenda.map(() => false));

  // Hydrate from localStorage so a refresh / tab switch doesn't restart
  // the run. We deliberately don't restore `running` — the user has to
  // resume explicitly to avoid surprise time-burn after a refresh.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return;
      const saved = JSON.parse(raw) as {
        activeIndex: number;
        secondsLeft: number;
        completed: boolean[];
      };
      if (typeof saved.activeIndex === 'number' && saved.activeIndex < agenda.length) {
        setActiveIndex(saved.activeIndex);
      }
      if (typeof saved.secondsLeft === 'number') {
        setSecondsLeft(saved.secondsLeft);
      }
      if (Array.isArray(saved.completed) && saved.completed.length === agenda.length) {
        setCompleted(saved.completed);
      }
    } catch { /* corrupted state — start fresh */ }
  }, [storageKey, agenda.length]);

  // Persist on every change so refresh recovers the in-flight run.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(
        storageKey,
        JSON.stringify({ activeIndex, secondsLeft, completed }),
      );
    } catch { /* quota — skip */ }
  }, [storageKey, activeIndex, secondsLeft, completed]);

  // Tick the active phase every second. We use Date.now() deltas so a
  // throttled tab (browser background timer slowdown) doesn't drift the
  // clock — when the tab wakes back up the elapsed time is correct.
  const lastTickRef = useRef<number | null>(null);
  useEffect(() => {
    if (!running) {
      lastTickRef.current = null;
      return;
    }
    lastTickRef.current = Date.now();
    const id = window.setInterval(() => {
      const now = Date.now();
      const last = lastTickRef.current ?? now;
      const elapsed = Math.round((now - last) / 1000);
      if (elapsed <= 0) return;
      lastTickRef.current = now;
      setSecondsLeft(prev => prev - elapsed);
    }, 500);
    return () => window.clearInterval(id);
  }, [running]);

  const advanceTo = useCallback((nextIndex: number) => {
    if (nextIndex >= agenda.length) {
      setRunning(false);
      setActiveIndex(agenda.length - 1);
      return;
    }
    setActiveIndex(nextIndex);
    setSecondsLeft(agenda[nextIndex].minutes * 60);
  }, [agenda]);

  // Auto-advance when the timer crosses zero — but only by one phase
  // per tick, so back-to-back zero seconds don't skip phases.
  const advancedForRef = useRef<number | null>(null);
  useEffect(() => {
    if (!running) return;
    if (secondsLeft > 0) return;
    if (advancedForRef.current === activeIndex) return;
    advancedForRef.current = activeIndex;
    setCompleted(prev => prev.map((v, i) => (i === activeIndex ? true : v)));
    advanceTo(activeIndex + 1);
  }, [running, secondsLeft, activeIndex, advanceTo]);

  const totalMinutes = useMemo(() => agenda.reduce((s, p) => s + p.minutes, 0), [agenda]);
  const completedCount = completed.filter(Boolean).length;
  const allDone = completedCount === agenda.length;

  const handleStart = () => {
    if (allDone) return;
    setRunning(true);
  };
  const handlePause = () => setRunning(false);
  const handleSkip = () => {
    setCompleted(prev => prev.map((v, i) => (i === activeIndex ? true : v)));
    advanceTo(activeIndex + 1);
    advancedForRef.current = activeIndex + 1;
  };
  const handleReset = () => {
    setRunning(false);
    setActiveIndex(0);
    setSecondsLeft(agenda[0].minutes * 60);
    setCompleted(agenda.map(() => false));
    advancedForRef.current = null;
  };

  // Per-phase cheatsheet expand state. Multi-open allowed so the
  // pitcher can pre-read the next phase while the current one is
  // running.
  const [openCheats, setOpenCheats] = useState<Set<number>>(new Set());
  const toggleCheat = (i: number) => {
    setOpenCheats(prev => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  return (
    <div className="fr-tracker">
      <div className="fr-tracker-bar">
        <div className="fr-tracker-progress">
          <div className="fr-tracker-progress-label">
            Phase {activeIndex + 1} of {agenda.length}
            <span className="fr-tracker-progress-meta">
              · {completedCount}/{agenda.length} done · {totalMinutes} min total
            </span>
          </div>
          <div className="fr-tracker-bar-track">
            <div
              className="fr-tracker-bar-fill"
              style={{ width: `${(completedCount / agenda.length) * 100}%` }}
            />
          </div>
        </div>
        <div className="fr-tracker-clock">
          <span className={`fr-tracker-time ${secondsLeft < 0 ? 'over' : ''}`}>
            {formatClock(secondsLeft)}
          </span>
          <div className="fr-tracker-controls">
            {!running && !allDone && (
              <button className="admin-btn admin-btn-primary" onClick={handleStart}>
                {completedCount === 0 && activeIndex === 0 ? 'Start' : 'Resume'}
              </button>
            )}
            {running && (
              <button className="admin-btn admin-btn-secondary" onClick={handlePause}>Pause</button>
            )}
            <button
              className="admin-btn admin-btn-secondary"
              onClick={handleSkip}
              disabled={allDone}
              title="Mark this phase complete and advance"
            >
              Next phase
            </button>
            <button
              className="admin-btn admin-btn-secondary"
              onClick={handleReset}
              title="Clear all progress"
            >
              Reset
            </button>
          </div>
        </div>
      </div>

      <ol className="fr-phase-list">
        {agenda.map((phase, i) => {
          const isActive = i === activeIndex && !allDone;
          const isDone = completed[i];
          const stateClass = isActive ? 'is-active' : isDone ? 'is-done' : 'is-upcoming';
          const cheatOpen = openCheats.has(i);
          return (
            <li key={i} className={`fr-phase ${stateClass} ${cheatOpen ? 'is-cheat-open' : ''}`}>
              <button
                type="button"
                className="fr-phase-row"
                onClick={() => toggleCheat(i)}
                aria-expanded={cheatOpen}
                aria-controls={`fr-cheat-${i}`}
              >
                <div className="fr-phase-marker">
                  <span className="fr-phase-num">{isDone ? '✓' : i + 1}</span>
                </div>
                <div className="fr-phase-body">
                  <div className="fr-phase-head">
                    <h3 className="fr-phase-title">{phase.title}</h3>
                    <span className="fr-phase-minutes">{phase.minutes} min</span>
                  </div>
                  <p className="fr-phase-desc">{phase.description}</p>
                  {isActive && (
                    <div className="fr-phase-active-meta">
                      <span className={`fr-phase-time ${secondsLeft < 0 ? 'over' : ''}`}>
                        {formatClock(secondsLeft)} {secondsLeft < 0 ? 'over' : 'remaining'}
                      </span>
                    </div>
                  )}
                </div>
                <span className="fr-phase-chevron" aria-hidden="true">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </span>
              </button>
              {cheatOpen && (
                <div className="fr-cheat" id={`fr-cheat-${i}`}>
                  <CheatsheetPanel sheet={phase.cheatsheet} />
                </div>
              )}
            </li>
          );
        })}
      </ol>

      {allDone && (
        <div className="fr-tracker-done">
          All ten phases complete. Pitch wrapped — capture follow-ups while it&apos;s fresh.
        </div>
      )}
    </div>
  );
}

export default function AdminFundraising() {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlSection = (searchParams.get('section') as Section | null) || 'pitch';
  const section: Section = urlSection === 'pitch' ? 'pitch' : 'pitch';
  const urlPitch = (searchParams.get('pitch') as PitchLength | null) || '30';
  const pitchLength: PitchLength = urlPitch === '60' ? '60' : '30';

  const setSection = useCallback((next: Section) => {
    setSearchParams(prev => {
      const p = new URLSearchParams(prev);
      if (next === 'pitch') p.delete('section');
      else p.set('section', next);
      return p;
    }, { replace: false });
  }, [setSearchParams]);

  const setPitchLength = useCallback((next: PitchLength) => {
    setSearchParams(prev => {
      const p = new URLSearchParams(prev);
      if (next === '30') p.delete('pitch');
      else p.set('pitch', next);
      return p;
    }, { replace: false });
  }, [setSearchParams]);

  const agenda = pitchLength === '30' ? AGENDA_30 : AGENDA_60;

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <h1>Fundraising</h1>
        <p className="admin-page-subtitle">Central hub for fundraising operations — pitch agendas, materials, and progress.</p>
      </div>

      <div className="admin-tabs" style={{ marginBottom: 16 }}>
        <button
          className={`admin-tab ${section === 'pitch' ? 'active' : ''}`}
          onClick={() => setSection('pitch')}
        >
          Pitch
        </button>
      </div>

      {section === 'pitch' && (
        <>
          <div className="admin-tabs" style={{ marginBottom: 20 }}>
            <button
              className={`admin-tab ${pitchLength === '30' ? 'active' : ''}`}
              onClick={() => setPitchLength('30')}
              title="Tight 30-minute investor meeting"
            >
              30 min pitch
            </button>
            <button
              className={`admin-tab ${pitchLength === '60' ? 'active' : ''}`}
              onClick={() => setPitchLength('60')}
              title="Full 60-minute partner meeting"
            >
              60 min pitch
            </button>
          </div>

          <PhaseTracker
            key={pitchLength}
            agenda={agenda}
            storageKey={`admin:fundraising:pitch:${pitchLength}`}
          />
        </>
      )}
    </div>
  );
}
