import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from '@remix-run/react';

type Section = 'pitch';
type PitchLength = '30' | '60';

interface Cheatsheet {
  // The literal sentence to open the phase with - read it close to
  // verbatim. Beats riffing every time when you're nervous.
  openWith: string;
  hitThese: string[];
  // Concrete things to show on screen during this phase. Empty list is
  // fine for phases where it's purely conversation.
  showInApp?: string[];
  // Numbers to actually have memorized. Bracketed where the founder
  // needs to fill in the live value before the meeting.
  numbersToKnow?: string[];
  // Investor questions that almost always come up - and the one-line
  // crisp answer to use.
  ifAsked?: { q: string; a: string }[];
  // Pitfalls. Things that have killed past pitches at this stage.
  watchOutFor?: string[];
}

interface Phase {
  title: string;
  description: string;
  // Minutes allotted for this phase. Total of all 5 must equal the
  // pitch length (30 or 60).
  minutes: number;
  cheatsheet: Cheatsheet;
}

const AGENDA_30: Phase[] = [
  {
    title: 'Welcome',
    description:
      'State the thesis upfront in one sentence. Catalog is the AI for searching retail.',
    minutes: 2,
    cheatsheet: {
      openWith:
        '"Thanks for making time. The one idea I want to leave you with: Catalog is the AI for searching retail. We replace the keyword search bar with a fluid generative discovery experience - shoppers see themselves wearing the product before they buy. Everything else in the next 25 minutes is evidence for that one sentence."',
      hitThese: [
        'Lock in positioning in the first 30 seconds: "AI for searching retail" - the same way Google was the AI for documents and Perplexity is the AI for answers, Catalog is the AI for finding what to buy.',
        'Confirm who else is on the call and their role.',
        'Set the agenda: deck → demo → ask → discussion. Tell them the demo is the centerpiece.',
      ],
      watchOutFor: [
        'Don\'t small-talk past 60 seconds. The one-line thesis is what they\'ll repeat to their partner - say it cleanly.',
        'Don\'t hedge "AI for searching" with disclaimers. State it. Defend it for the rest of the meeting.',
      ],
    },
  },
  {
    title: 'Show deck',
    description:
      'Walk the deck: problem (1995 retail search) → market ($1.1T US) → traction → business model → competitive lockout → team. Every slide is evidence for the one-line thesis.',
    minutes: 8,
    cheatsheet: {
      openWith:
        '"Let me walk you through the deck. The first half is why retail search is broken and how big this is. The second half is what\'s working today and who\'s structurally locked out of shipping it."',
      hitThese: [
        'PROBLEM (~90s) - Retail search hasn\'t changed since 1995: keywords, lists, filters. Shoppers translate intent (\'a black tank that drapes\') into clumsy keywords (\'black sleeveless top\'), then sift results that ignore body, context, and taste. PDP photos are aspirational and decontextualized - fashion-DTC return rates of 30-40% are the cost of that guesswork. AI generation replaces search → list → guess with: pick a product, see yourself wearing it, decide.',
        'MARKET (~60s) - US retail e-commerce is $1.1T. Amazon owns ~38% on a 30-year-old search UX. SAM: ~$400B AI-native discoverable retail (apparel, beauty, home, gear). Wedge → expansion: fashion (now) → beauty (year 2) → home (year 2-3) → gear (year 3+). Comparables at IPO: Amazon ($438M), Pinterest ($13B), Shopify ($1.3B), Google ($23B).',
        'TRACTION (~2 min) - Five numbers that move together. (1) WAU + W/W growth + source split. (2) Try-ons generated per week per WAU - the engagement signal. (3) Cohort retention W4/W8/W12: generation-flow users retain at 2-3x baseline. (4) Clickout → confirmed-order conversion %. (5) Supply: connected brands, creators publishing/month, brand MRR. Call out the inflection: "we shipped [feature] in week [X]; retention jumped [Y] to [Z]".',
        'BUSINESS MODEL (~90s) - Three streams layered chronologically: affiliate (live, [X%] take rate), brand subscription (live, tiered SaaS for Shopify partners), in-feed ads (2026, ~10% inventory cap). Per-try-on contribution: ~$0.50 cost vs [N] views + [M] clickouts + $[X] affiliate revenue. Positive on day one.',
        'COMPETITIVE (~90s) - Four incumbents structurally locked out by their own P&L: Amazon (won\'t link out to Shopify), Shopify (can\'t pool across stores without breaking the merchant promise), TikTok Shop (entertainment firehose, no structured catalog), LTK / ShopMy (top 1% influencer link-in-bio, no AI tooling). Meta retired Instagram Shop in 2023 - that\'s the vacuum we\'re filling.',
        'TEAM (~30s) - Two co-founders, complementary edges. Ten seconds per person. Bios in the appendix.',
        'Pause and tell them: "Now I\'m going to show you what AI for searching actually feels like. The demo is the pitch."',
      ],
      numbersToKnow: [
        '[Live MAU on catalog.shop]',
        '[GMV trailing 30 days]',
        '[WAU last 4 weeks, W/W %]',
        '[W4/W8/W12 retention - generation-flow vs baseline]',
        '[# active brands integrated, # creators publishing/month]',
        '[Brand MRR + blended affiliate take rate]',
      ],
      ifAsked: [
        {
          q: 'Isn\'t Amazon\'s Rufus this?',
          a: 'Rufus is a chatbot bolted onto Amazon\'s 1995 funnel - still ends in a list of products you scroll. We replace the result page entirely. The answer to "what should I wear" isn\'t a list; it\'s a 30-second video of you wearing it.',
        },
        {
          q: 'Why hasn\'t Google or Perplexity built this?',
          a: 'They\'re horizontal. Retail discovery requires a structured product catalog, brand integrations, creator revshare, and a generation pipeline tuned to bodies and clothes. None of those are general-purpose problems. We\'re vertical-deep on purpose.',
        },
        {
          q: 'What stops Amazon from shipping AI search?',
          a: 'They\'ll ship it for Amazon products only - strengthening their walled garden. Our shoppers come BECAUSE they want cross-brand. Amazon can\'t ship cross-brand without breaking their P&L.',
        },
        {
          q: 'Why not own checkout?',
          a: 'Brands integrate BECAUSE we send them traffic - they own CRM, fulfillment, returns. The day we own checkout is the day brands churn.',
        },
      ],
      watchOutFor: [
        'Don\'t pitch as a fashion company. The wedge is fashion; the surface is "AI for searching retail" - investors fund category-defining outcomes, not vertical SaaS.',
        'Don\'t cherry-pick the best traction week. Show the full trend - any metric that\'s down, address head-on with cause and fix.',
        'Don\'t use bottom-up TAM and top-down TAM in the same breath. Pick one.',
      ],
    },
  },
  {
    title: 'Show demo',
    description:
      'Land on the feed, do a try-on live, watch the AI render the result. Search-as-generation. This moment is the entire pitch.',
    minutes: 10,
    cheatsheet: {
      openWith:
        '"Now let me show you what fluid discovery actually feels like. Three moves - then I\'ll hand you the keyboard."',
      hitThese: [
        'MOVE 1 (~2 min) - discovery without a search bar. Open catalog.shop. Cross-brand mix loads instantly (rag & bone, ALO, Levi\'s). Tap a card → morph into the look detail → tap a product → retailer drawer with Bloomingdale\'s, Amazon, Nordstrom side-by-side, "Lowest" badge automatic. Note out loud: no keyword box in their face. Discovery IS the feed.',
        'MOVE 2 (~6 min - THE DEFINING MOMENT) - open /generate. Upload a face photo. Pick 2 products. Submit. ~30 seconds later: an AI video of THE INVESTOR wearing the products. They didn\'t type a keyword, they SAW the answer. While it renders, narrate the pipeline: prompt assembly → Fal queue → webhook callback → published look. This is what "AI for searching" looks like in practice.',
        'MOVE 3 (~2 min) - share sheet on the generated look. Watermark + deep link to catalog.shop/l/<slug>. Native share to TikTok / IG / X. Mention briefly: every share is content that pulls in another shopper at zero CAC. Don\'t belabor it - that\'s the Ask payoff.',
      ],
      showInApp: [
        'catalog.shop feed (cross-brand mix front and center)',
        '/generate end-to-end - let the investor watch the AI video render live',
        'Share sheet on the generated look (watermark + deep link visible)',
      ],
      ifAsked: [
        {
          q: 'How is the AI video generated?',
          a: 'Bytedance Seedance via Fal queue. Lite for fast (~30s, <$0.50), Pro for premium (~90s). Prompt assembled from style preset + product role-tags + height + age band. Cost is falling every quarter.',
        },
        {
          q: 'Why no search bar by default?',
          a: 'There IS one for power users. But the default discovery surface is generative, not query-based - typing keywords is the friction we\'re removing. The search bar becomes a fallback, not the front door.',
        },
        {
          q: 'Where does the product data come from?',
          a: 'Three pipelines: Shopify partner integration for connected brands, Modal-hosted crawlers for direct imports, admin curation for editorial.',
        },
        {
          q: 'IP / consent / model rights?',
          a: 'Generated content owned by us under Fal\'s commercial license. Face photos are user-uploaded with explicit consent. No third-party celebrity faces. Product imagery: crawled with attribution, takedown-respecting; Shopify partners license via the partner agreement.',
        },
      ],
      watchOutFor: [
        'Lead with /generate. The feed is table stakes. The try-on is the moment they remember.',
        'Run the full flow on the call device 30 min before the meeting. Have a 90-second pre-recorded video as Plan B.',
        'If the demo breaks: "let me send you a 90-second video - runs in <30s normally". Never apologize.',
      ],
    },
  },
  {
    title: 'Show ask',
    description:
      'The framing changes. The product is built. The objective of this round is ONE thing - start the flywheel that grows the company on its own.',
    minutes: 3,
    cheatsheet: {
      openWith:
        '"Raising $[X] on a [valuation] cap. [$Y] already committed. Here\'s the framing that matters - and it\'s the first time I\'m saying this word on purpose: the entire objective of this round is to START THE FLYWHEEL. Every try-on we generate is shareable content. Every share brings in a new shopper at zero CAC. Right now we\'re paying CAC to seed the loop. Once the share-loop K-factor crosses 1, the company grows on its own - every shopper brings in the next one. This round is the spark; after that, the company is fundamentally different."',
      hitThese: [
        'This is the ONLY phase where flywheel is the headline. Build to it; don\'t bury the framing.',
        'The mechanism in one breath: AI try-on creates content → share creates acquisition → new shopper enters → does their own try-on → loop. Each turn lowers the marginal cost of the next.',
        'Round size + valuation + structure.',
        'Existing commitments - names if permitted.',
        'Use of funds, mapped to flywheel activation:',
        '  - [X%] paid acquisition seed → fuel for the share loop',
        '  - [Y%] AI compute scale (Seedance / Fal) → drives cost-per-try-on down so we can subsidize more',
        '  - [Z%] brand-partnerships team → closes the brand-pull side',
        '  - [W%] creator acquisition + payouts',
        '  - [V%] engineering on share UX (directly raises K)',
        '  - [U%] runway buffer',
        'Headline milestone for the next raise: K > 1 sustained for [N] consecutive weeks. After that, we\'re raising to SCALE a self-spinning flywheel - fundamentally different ask.',
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
    title: 'Discussion',
    description:
      'Open the floor. Capture every question. End with a concrete ask: data room, follow-up call, or partner intro.',
    minutes: 7,
    cheatsheet: {
      openWith:
        '"Open to questions. What\'s on your mind?"',
      hitThese: [
        'Write down every question. Even ones you answer well - they\'re tells about the firm\'s thesis.',
        'If a question is hard, say "great question, here\'s how we think about it" - never "I don\'t know" without a follow-up.',
        'Ask THEM questions: "What would you need to see to move forward?" "Who else at the firm should I meet?"',
        'Close with a concrete next step. Data room link, follow-up call on date, partner intro.',
      ],
      ifAsked: [
        {
          q: 'How does this become a $10B+ outcome?',
          a: 'AI-native discovery owns the top of the funnel for $1T+ of retail - same trajectory Google ran for the open web. Once the share-loop activates, growth is self-sustaining at near-zero marginal CAC. Comparables at IPO: Amazon ($438M), Pinterest ($13B), Shopify ($1.3B).',
        },
        {
          q: 'What\'s the single biggest risk?',
          a: 'Share rate on generated try-ons. If users don\'t share, the flywheel doesn\'t activate and we\'re another paid-acquisition company. Mitigation: [N] tested share-UX variants, current share rate [X%], roadmap to push it to [Y%] via [specific lever].',
        },
        {
          q: 'What if AI generation gets commoditized?',
          a: 'Hope so - every cost reduction makes our economics better. The moat isn\'t the model; it\'s the catalog + creator + brand stack the model plugs into.',
        },
        {
          q: 'What keeps you up at night?',
          a: 'Pick ONE real risk and how you\'re mitigating it. Don\'t deflect.',
        },
      ],
      watchOutFor: [
        'Don\'t end without a concrete next step. "We\'ll be in touch" = dead.',
        'Send the recap email within 4 hours - questions, answers, asks, next steps.',
      ],
    },
  },
];

const AGENDA_60: Phase[] = [
  {
    title: 'Welcome',
    description:
      'Lock in the thesis in the first 60 seconds: Catalog is the AI for searching retail.',
    minutes: 3,
    cheatsheet: {
      openWith:
        '"Great to meet. The single sentence I want you walking out of this room repeating to your partner: Catalog is the AI for searching retail. The next hour is evidence for that one sentence - and at the end I\'ll tell you exactly what this round funds."',
      hitThese: [
        'State the one-line positioning in the first 30 seconds. Don\'t bury it in the deck.',
        'Two threads run through the whole hour: (1) AI for searching - search becomes generation. (2) Extremely fluid discovery - the UX leap.',
        '(The third thread - the flywheel and what the round funds - is the Ask payoff. Don\'t name it yet.)',
        'Reference one specific investment or post the partner has put out.',
        'Confirm everyone on the call. Note titles + who looks engaged.',
        'Set the arc: "Founder story → why retail search is broken → demo (fluid discovery) → traction → ask. 12 min for Q&A."',
      ],
      watchOutFor: [
        'Don\'t reference a portfolio investment generically. Have one specific point ready.',
        'Don\'t over-prepare rapport. 3 minutes max - the one-sentence thesis is what gets you funded.',
      ],
    },
  },
  {
    title: 'Show deck',
    description:
      'Walk the deck end-to-end: founder story → problem → market → traction → business model → competitive → team. Every slide is evidence for the one-line thesis.',
    minutes: 18,
    cheatsheet: {
      openWith:
        '"Let me walk you through the deck. The arc is: why us, why retail search is broken, how big this is, what\'s working today, the unit economics, and who\'s structurally locked out of shipping it."',
      hitThese: [
        'FOUNDER STORY & WHY NOW (~3 min) - Two threads converged. [Co-founder] spent [X years] on [thing]. I spent [Y years] on [thing]. The personal moment: when cheap AI try-on landed and the search-bar UX started looking obsolete. Why now: AI video at <$0.50/generation only landed in 2025 - structurally absent 18 months ago. Why not earlier: Polyvore, Wanelo, ShopStyle all tried curated catalogs without an AI generation primitive - content didn\'t compound. Why not later: 18-month window before Amazon AI shopping, TikTok Shop, Pinterest AI try (most will fail because their P&L blocks them).',
        'PROBLEM (~3 min) - Retail search is 1995 tech across Amazon, Shopify stores, Walmart, Target. Shoppers translate intent (\'a black tank that drapes\') into clumsy keywords (\'black sleeveless top\'), then sift results that ignore body, context, and taste. PDP photos are aspirational, sizing-blind, decontextualized - fashion-DTC return rates of 30-40% are the cost of that guesswork. AI generation replaces search → list → guess with: pick a product, see yourself wearing it in 30 seconds, decide. Three-sided benefit: shoppers see themselves before buying, brands get top-of-funnel intent traffic, creators monetize curation without grinding content.',
        'MARKET (~3 min) - $6T global retail e-commerce. $1.1T US, growing 8% YoY. SAM (3 years out): ~$400B AI-native discoverable retail (apparel, beauty, home, gear). Two sizings - bottom-up from our funnel + top-down from category benchmarks - converge on the same wedge. Bottom-up: [N] target shoppers × [X sessions/yr] × [$Y AOV] × [Z% take rate] = $[A] revenue at saturation. Top-down: $400B SAM × 1% capture = $4B GMV → $400M ARR. Pinterest IPO\'d at $13B on less. Wedge → expansion: fashion → beauty (year 2) → home (year 2-3) → gear (year 3+).',
        'TRACTION (~4 min) - Eight metrics that move together: (1) WAU + W/W growth + source split (organic / share-driven / paid). (2) Try-ons generated per week per WAU - the engagement signal. (3) Share rate - % of generated try-ons shared externally - THE single most important number. (4) K-factor - new sessions per share. (5) W4/W8/W12 retention: generation-flow retains 2-3x baseline. (6) Brand pull - new Shopify integrations/month. (7) Creator pull - new curators publishing/month. (8) GMV + brand MRR. The story is "they all move together because they\'re sides of the same loop". Inflection slide: "We shipped [share UX revamp] in week [X]; share rate went [Y%] → [Z%]; brand integrations doubled the next month".',
        'BUSINESS MODEL & UNIT ECONOMICS (~3 min) - Three streams chronologically: AFFILIATE (live, [X%] take rate via FlexOffers / Skimlinks), BRAND SUBSCRIPTION (live, tiered SaaS for Shopify partners - $[X] starter / $[Y] pro / $[Z] enterprise), IN-FEED ADS (2026, ~10% inventory cap). Unit walk: shopper opens app → try-on (cost $0.50) → shares it → 1.[X] new shoppers come in → they generate clickouts at $[Y] each. Per-try-on contribution: [$Z]. As K rises, blended CAC trends to zero; LTV rises with retention; the unit-economic curve is exponential, not linear.',
        'COMPETITIVE MOAT (~2 min) - Four moats compounding: (1) Generation pipeline - Seedance prompts + role-tagged products + Marengo embeddings + pgvector + Fal queue + webhook orchestration. ~6 months to replicate. (2) Brand network - Shopify partners across [M] categories. (3) Creator network - [N] curators with revshare baked in; high switching cost. (4) Data moat - every clickout / save / generation feeds embeddings → better recommendations → more clickouts. Plus the structural moat: Amazon won\'t link out to Shopify; Shopify can\'t pool across stores; Meta retired Instagram Shop. Lane is structurally open.',
        'TEAM (~30s) - Two co-founders, [N] full-time, [M] advisors. Co-founder edges, next two hires post-round, only name advisors who would take an investor reference call. Bios in the appendix.',
        'Pause and tell them: "Now I\'m going to show you what AI for searching actually feels like. The demo is the pitch."',
      ],
      numbersToKnow: [
        '[Live MAU + sessions per WAU]',
        '[GMV last 30 days, M/M %]',
        '[WAU last 4 weeks, W/W %]',
        '[% of WAU from share-driven traffic]',
        '[Share rate %, K-factor (current + 4-week trend)]',
        '[W4/W8/W12 retention - generation-flow vs baseline]',
        '[# brand integrations + creators / month]',
        '[Brand MRR + blended affiliate take rate]',
        '[Cost per generation today vs 6 months ago]',
      ],
      ifAsked: [
        {
          q: 'How long have you been working on this?',
          a: '[N months]. Building infrastructure deliberately - try-on pipeline, share UX, brand integrations, creator payouts. Every piece is a building block for the round\'s objective.',
        },
        {
          q: 'Who exactly is the customer?',
          a: 'Two-sided. Shoppers consumer-facing (free, ad/affiliate monetized). Brands paying (subscription + ads). Creators supply-side (revshare). Same shape as YouTube.',
        },
        {
          q: 'Isn\'t Amazon\'s Rufus this?',
          a: 'Rufus is a chatbot bolted onto Amazon\'s 1995 funnel - still ends in a list of products. We replace the result page entirely.',
        },
        {
          q: 'Why hasn\'t Google or Perplexity built this?',
          a: 'Horizontal AI search can\'t crack vertical retail without a structured catalog, brand integrations, creator revshare, and a generation pipeline tuned to bodies and clothes. We\'re vertical-deep on purpose.',
        },
        {
          q: 'When does K cross 1 sustainably?',
          a: 'Per our model: [X WAU] + [Y%] share rate. We\'re at [current values] today. The round closes the gap.',
        },
        {
          q: 'How do you know brand integrations are pulled, not pushed?',
          a: '[N%] of last quarter\'s new brand signups came inbound after seeing share-driven clickout volume. We track inbound vs outbound explicitly.',
        },
        {
          q: 'What if Amazon ships AI shopping?',
          a: 'For Amazon products only - strengthens their walled garden. Our shoppers come BECAUSE they want cross-brand. Different product, different intent.',
        },
        {
          q: 'When do you become marketplace?',
          a: 'Never. Marketplace = own checkout = brands churn. Brands integrate BECAUSE we send them traffic.',
        },
      ],
      watchOutFor: [
        'Don\'t pitch only fashion. Lead with "AI for searching retail"; explain fashion as the wedge.',
        'Don\'t make the founder story long. Investors want one signal: would you bet years of your life on this? Show conviction.',
        'Don\'t hide failed cohorts. If a Q3 cohort retained badly, explain why and what changed.',
        'Do NOT present traction as 8 isolated metrics. The story is "they all move together because they\'re sides of the same loop".',
      ],
    },
  },
  {
    title: 'Show demo',
    description:
      'Show what AI-for-searching feels like end-to-end. Four moves: discover, try-on, share, return shopper. Let the AI generation render live.',
    minutes: 15,
    cheatsheet: {
      openWith:
        '"I\'m going to show you what fluid discovery feels like, end to end. Four moves. Then I\'ll hand you the keyboard."',
      hitThese: [
        'MOVE 1 (discovery, ~90s) - feed on catalog.shop. Cross-brand mix (rag & bone, ALO, Levi\'s, etc). Tap a look → morph into LookOverlay → tap a product → retailer drawer with Bloomingdale\'s, Amazon, Nordstrom comparison + "Lowest" badge. Hit back → look restores.',
        'MOVE 2 (try-on, ~3 min - THE WOW MOMENT) - open /generate. Upload a face photo (use a generic one, not the investor\'s). Pick 2 products. Submit. While it renders (~30s on Lite), narrate the pipeline: prompt assembly → Fal queue → webhook callback → published look. Show the result. The investor watches a personalized try-on materialize live.',
        'MOVE 3 (share, ~90s) - open the share sheet on the generated look. Show: watermark, deep link to catalog.shop/l/<slug>, native share to TikTok / IG / X. Say: "Every share is a free shopper acquisition. K-factor is [X] today."',
        'MOVE 4 (return shopper, ~90s) - paste a share-link in a fresh browser. Show: same shoppable experience, no login wall, retailer drawer + cross-brand "More like this" feed. The new shopper is now in the loop.',
        'MOVE 5 (admin, only if technical partner) - admin/content → Unpublished → click Model on a row → pipeline node diagram. Shows the engineering depth.',
        'Pause and say: "Discovery, try-on, share, return shopper - and we paid zero CAC for that last user. Hold onto that. I\'ll come back to what this means at the Ask."',
      ],
      showInApp: [
        'catalog.shop feed (cross-brand mix)',
        'Look detail morph + product page with retailer drawer',
        '/generate end-to-end (face photo → 2 products → live render - let them watch the AI work)',
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
    title: 'Show ask',
    description:
      'Now the framing changes. The product is built. The objective of this round is ONE thing - start the flywheel that grows the company on its own.',
    minutes: 12,
    cheatsheet: {
      openWith:
        '"Raising $[X] on a [valuation] cap. [$Y] already committed. Here\'s the framing that matters - and it\'s the first time I\'m using this word in the meeting on purpose. The entire objective of this round is to START THE FLYWHEEL. Every AI try-on we generate is a shareable artifact. Every share brings in a new shopper at zero CAC. Right now we\'re paying CAC to seed the loop. Once the share-loop K-factor crosses 1, the company grows on its own - every shopper brings in the next one. This round is the spark. After that, the company is fundamentally different - we\'re scaling a self-spinning engine, not pushing one."',
      hitThese: [
        'Round size + valuation + structure (priced / SAFE / convertible).',
        'Existing commitments - names if permitted, otherwise the dollar amount.',
        'Use of funds, mapped face-by-face:',
        '  - [X%] paid acquisition seed → fuels the share-loop input',
        '  - [Y%] AI compute scale (Seedance / Fal) → drives cost-per-try-on down so we can subsidize more',
        '  - [Z%] brand-partnerships team → closes the brand-pull face',
        '  - [W%] creator acquisition + payouts → closes the creator-pull face',
        '  - [V%] engineering on share UX + viral mechanics → directly raises K-factor',
        '  - [U%] runway buffer',
        'Headline milestones for the next raise:',
        '  1. K-factor sustained > 1 for [N] consecutive weeks',
        '  2. [WAU target]',
        '  3. [N] paying brand partners + $[Z]K MRR',
        '  4. Cost per generation < $[Y]',
        '  5. [Revenue runrate]',
        '  6. Beauty vertical launched - same generation pipeline, next category',
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
          a: 'Push paid acquisition harder to seed K=1 faster, and launch the beauty vertical 6 months earlier. AI compute scale comes for free as Fal / Seedance prices drop. NOT engineering hires - engineering is solved with the team we have.',
        },
        {
          q: 'What does the next round look like?',
          a: 'Series A in [N] months at $[X]M raise. The trigger isn\'t revenue - it\'s K > 1 sustained. Once the loop is self-spinning, every additional dollar buys exponentially more.',
        },
        {
          q: 'How do you become a $10B+ company?',
          a: 'AI-native discovery owns the top of the funnel for $1T+ of retail - same trajectory Google ran for the open web. Once the share-loop activates, growth is self-sustaining at near-zero marginal CAC. Comparables at IPO: Amazon ($438M), Pinterest ($13B), Shopify ($1.3B), Google ($23B). All underestimated at IPO.',
        },
        {
          q: 'What\'s the single biggest risk?',
          a: 'Share rate. If users don\'t share, K stays below 1 and we\'re another paid-acquisition company. Mitigation: [N] tested share-UX variants, current share rate is [X%], roadmap to push it to [Y%] via [specific lever - incentivized shares, watermark optimization, native-first share format, etc.].',
        },
        {
          q: 'What if AI generation gets commoditized?',
          a: 'Hope so - every cost reduction makes our economics better. The moat isn\'t the model; it\'s the catalog + creator + brand stack the model plugs into.',
        },
        {
          q: 'What keeps you up at night?',
          a: 'Pick ONE real risk. Be specific about how you\'re mitigating. Never deflect.',
        },
      ],
      watchOutFor: [
        'Never end without a concrete next step. "We\'ll be in touch" = dead. Push for: data room, partner intro, follow-up scheduled before you hang up.',
        'Send the recap email within 4 hours: questions, answers, asks, decided next steps. This single discipline closes more rounds than any deck slide.',
        'For Q&A on this phase, the framing is settled - flywheel = the round\'s objective, AI for searching = the product. Don\'t over-thread either.',
      ],
    },
  },
  {
    title: 'Discussion',
    description:
      'Open the floor. Capture every question. End with a concrete ask: data room, follow-up call, or partner intro.',
    minutes: 12,
    cheatsheet: {
      openWith:
        '"Open to questions. What\'s on your mind?"',
      hitThese: [
        'Write down every question. Even ones you answer well - they\'re tells about the firm\'s thesis.',
        'If a question is hard, say "great question, here\'s how we think about it" - never "I don\'t know" without a follow-up.',
        'Ask THEM questions: "What would you need to see to move forward?" "Who else at the firm should I meet?" "What\'s your typical first-check process from here?"',
        'Close with a concrete next step. Data room link, follow-up call on date, partner intro, reference call with an existing investor.',
      ],
      ifAsked: [
        {
          q: 'How does this become a $10B+ outcome?',
          a: 'AI-native discovery owns the top of the funnel for $1T+ of retail - same trajectory Google ran for the open web. Once the share-loop activates, growth is self-sustaining at near-zero marginal CAC. Comparables at IPO: Amazon ($438M), Pinterest ($13B), Shopify ($1.3B), Google ($23B).',
        },
        {
          q: 'What\'s the single biggest risk?',
          a: 'Share rate. If users don\'t share, K stays below 1 and we\'re another paid-acquisition company. Mitigation: [N] tested share-UX variants, current share rate [X%], roadmap to push it to [Y%] via [specific lever - incentivized shares, watermark optimization, native-first share format].',
        },
        {
          q: 'What if AI generation gets commoditized?',
          a: 'Hope so - every cost reduction makes our economics better. The moat isn\'t the model; it\'s the catalog + creator + brand stack the model plugs into.',
        },
        {
          q: 'What does the next round look like?',
          a: 'Series A in [N] months at $[X]M raise. The trigger isn\'t revenue - it\'s K > 1 sustained. Once the loop is self-spinning, every additional dollar buys exponentially more.',
        },
        {
          q: 'What keeps you up at night?',
          a: 'Pick ONE real risk. Be specific about how you\'re mitigating. Never deflect.',
        },
      ],
      watchOutFor: [
        'Don\'t end without a concrete next step. "We\'ll be in touch" = dead.',
        'Send the recap email within 4 hours - questions, answers, asks, next steps.',
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

// Phase tracker: drives a 5-phase pitch (welcome / show deck / show
// demo / show ask / discussion) in real time. One phase is "active" at
// a time. When its timer hits 0, it auto-completes and the next phase
// becomes active. State persists per agenda (30 vs 60) in localStorage
// so a refresh doesn't lose the run.
function PhaseTracker({ agenda, storageKey }: PhaseTrackerProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [running, setRunning] = useState(false);
  // Seconds remaining in the active phase. Goes negative if the user
  // lets it run over (so over-runs are visible, not clamped).
  const [secondsLeft, setSecondsLeft] = useState(agenda[0].minutes * 60);
  const [completed, setCompleted] = useState<boolean[]>(() => agenda.map(() => false));

  // Hydrate from localStorage so a refresh / tab switch doesn't restart
  // the run. We deliberately don't restore `running` - the user has to
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
    } catch { /* corrupted state - start fresh */ }
  }, [storageKey, agenda.length]);

  // Persist on every change so refresh recovers the in-flight run.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(
        storageKey,
        JSON.stringify({ activeIndex, secondsLeft, completed }),
      );
    } catch { /* quota - skip */ }
  }, [storageKey, activeIndex, secondsLeft, completed]);

  // Tick the active phase every second. We use Date.now() deltas so a
  // throttled tab (browser background timer slowdown) doesn't drift the
  // clock - when the tab wakes back up the elapsed time is correct.
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

  // Auto-advance when the timer crosses zero - but only by one phase
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
          All five phases complete. Pitch wrapped - capture follow-ups while it&apos;s fresh.
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
        <p className="admin-page-subtitle">Central hub for fundraising operations - pitch agendas, materials, and progress.</p>
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
            storageKey={`admin:fundraising:pitch:v2:${pitchLength}`}
          />
        </>
      )}
    </div>
  );
}
