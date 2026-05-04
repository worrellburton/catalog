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
  // Minutes allotted for this phase. Total of all 10 must equal the
  // pitch length (30 or 60).
  minutes: number;
  cheatsheet: Cheatsheet;
}

const AGENDA_30: Phase[] = [
  {
    title: 'Welcome & the one idea',
    description:
      'State the thesis upfront in one sentence. Catalog is the AI for searching retail.',
    minutes: 1,
    cheatsheet: {
      openWith:
        '"Thanks for making time. The one idea I want to leave you with: Catalog is the AI for searching retail. We replace the keyword search bar with a fluid generative discovery experience - shoppers see themselves wearing the product before they buy. Everything else in the next 25 minutes is evidence for that one sentence."',
      hitThese: [
        'Lock in the positioning in the first 30 seconds: "AI for searching retail" - the same way Google was the AI for documents and Perplexity is the AI for answers, Catalog is the AI for finding what to buy.',
        'Confirm who else is on the call and their role.',
        'Set the agenda: problem (search is broken) → demo (fluid discovery) → traction → ask. 7 min for Q&A.',
      ],
      watchOutFor: [
        'Don\'t small-talk past 60 seconds. The one-line thesis is the thing they\'ll repeat to their partner - say it cleanly.',
        'Don\'t hedge "AI for searching" with disclaimers. State it. Defend it for the rest of the meeting.',
      ],
    },
  },
  {
    title: 'The problem: retail search is broken',
    description:
      'Retail search is 1995 tech. Shoppers describe what they want in their head, fail to translate it into keywords, and bounce.',
    minutes: 2,
    cheatsheet: {
      openWith:
        '"Retail search hasn\'t meaningfully changed since 1995 - keywords, lists, filters. Shoppers describe what they want in their head (\'a black tank that drapes\'), translate it into clumsy keywords (\'black sleeveless top\'), then sift results that ignore body, context, and taste. The translation step is where most shoppers fail or bounce."',
      hitThese: [
        'The keyword-to-product translation step loses 40-60% of shopping intent before checkout. Filters and reviews are lipstick on a 30-year-old UX.',
        'PDP photos are aspirational, sizing-blind, decontextualized. Shoppers have to imagine themselves wearing the product - the cost of that guesswork is fashion-DTC return rates of 30-40%.',
        'AI generation replaces search → list → guess with: pick a product, see yourself wearing it in 30 seconds, decide. The generation IS the search result.',
        'Why now: AI video at <$0.50/generation only landed in 2025. The primitive that makes this possible was structurally absent 18 months ago.',
      ],
      ifAsked: [
        {
          q: 'Isn\'t Amazon\'s Rufus this?',
          a: 'Rufus is a chatbot bolted onto Amazon\'s 1995 funnel. It still ends in a list of products you scroll. We replace the result page entirely - the answer to "what should I wear" isn\'t a list, it\'s a 30-second video of you wearing it.',
        },
        {
          q: 'Why hasn\'t Google or Perplexity built this?',
          a: 'They\'re horizontal. Retail discovery requires a structured product catalog, brand integrations, creator revshare, and a generation pipeline tuned to clothes and bodies. None of those are general-purpose problems. We\'re vertical-deep on purpose.',
        },
      ],
      watchOutFor: [
        'Don\'t pitch as a fashion company. The wedge is fashion; the surface is "AI for searching retail" - investors fund category-defining outcomes, not vertical SaaS.',
      ],
    },
  },
  {
    title: 'Demo: extremely fluid discovery',
    description:
      'Show search-as-generation. Land on the feed, do a try-on live, watch the AI render the result. That moment is the entire pitch.',
    minutes: 5,
    cheatsheet: {
      openWith:
        '"Let me show you what fluid discovery actually feels like. Three moves - about 90 seconds each."',
      hitThese: [
        'MOVE 1 (~90s) - discovery without a search bar. Open catalog.shop. Cross-brand mix loads instantly (rag & bone, ALO, Levi\'s). Tap a card → morph into the look detail → tap a product → retailer drawer with Bloomingdale\'s, Amazon, Nordstrom side-by-side, "Lowest" badge automatic. Note: no keyword box in their face. Discovery is the feed itself.',
        'MOVE 2 (~3 min - THE DEFINING MOMENT) - open /generate. Upload a face photo. Pick 2 products. Submit. ~30 seconds later: an AI video of THE INVESTOR wearing the products. They didn\'t type a keyword, they SAW the answer. This is what "AI for searching" looks like in practice.',
        'MOVE 3 (~60s) - show the share sheet. Watermark + deep link to catalog.shop/l/<slug>. Native share to TikTok / IG / X. Mention briefly that every share is content that pulls in another shopper at zero CAC - but don\'t belabor it; that\'s for the Ask later.',
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
      ],
      watchOutFor: [
        'Lead with /generate. The feed is table stakes. The try-on is the moment they remember.',
        'If the demo breaks: "let me send you a 90-second video - runs in <30s normally". Never apologize.',
      ],
    },
  },
  {
    title: 'Market opportunity: AI for searching retail',
    description:
      'Retail e-commerce is $1.1T US. Whoever owns AI-native discovery owns the top of the funnel - the same way Google owned the top of the web.',
    minutes: 2,
    cheatsheet: {
      openWith:
        '"US retail e-commerce is $1.1T. Amazon owns ~38% of it on a 30-year-old search UX. The AI-search layer for the rest of retail is the next $100B+ company - same trajectory as Google for the open web."',
      hitThese: [
        'TAM: global retail e-commerce - $6T+. US: $1.1T, growing 8% YoY.',
        'SAM: AI-native discoverable retail in US/EN - apparel, beauty, home, gear. ~$400B.',
        'SOM 3 years out: 0.5–1% of SAM with the fashion wedge plus category expansion.',
        'Wedge → expansion: fashion (now, cleanest AI generation economics) → beauty (face try-on, year 2) → home (place-in-room, year 2-3) → gear (lifestyle context, year 3+).',
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
    title: 'Traction: the product is working',
    description:
      'WAU, retention, GMV through-flow, brand pull. Five numbers that show generation-as-search is the right surface.',
    minutes: 4,
    cheatsheet: {
      openWith:
        '"Five numbers - engagement, retention, supply, demand, revenue. The trend is what matters, not any single value."',
      hitThese: [
        '1. WAU shoppers - current value, W/W growth, source split (organic / referral / paid).',
        '2. Try-ons generated per week + per-WAU rate. The engagement signal that tells you AI-search is the right surface.',
        '3. Cohort retention W4 / W8 / W12 - generation-flow users retain at 2-3x baseline because each session creates a personal artifact.',
        '4. Clickout volume → confirmed orders (where Shopify webhook is wired). Conversion %.',
        '5. Supply: # connected brands, # creators publishing per month, brand MRR.',
        'Highlight any inflection: "we shipped [feature] in week [X], retention jumped from [Y] to [Z]" - that\'s the slide investors remember.',
      ],
      numbersToKnow: [
        '[WAU last 4 weeks, W/W %]',
        '[Try-ons / week per WAU]',
        '[W4/W8/W12 retention - generation-flow vs baseline]',
        '[Confirmed Shopify-attributed GMV]',
        '[New brand integrations + creators / month]',
        '[Brand MRR]',
      ],
      ifAsked: [
        {
          q: 'What\'s your CAC?',
          a: 'Blended [$X] today. We\'re paying paid CAC to seed the user base while organic share traffic ramps - that\'s the structural unlock the round funds.',
        },
        {
          q: 'How sticky is week-1 retention?',
          a: '[X%] for generation-flow users - 2-3x baseline. They have a personalized artifact + the try-on UX makes coming back trivial.',
        },
      ],
      watchOutFor: [
        'Don\'t cherry-pick the best week. Show the full trend.',
        'If a metric is down, address it head-on with the cause and the fix.',
      ],
    },
  },
  {
    title: 'Business model',
    description:
      'Three revenue streams - affiliate today, brand subscription this year, ad inventory next.',
    minutes: 2,
    cheatsheet: {
      openWith:
        '"Three revenue streams, layered chronologically. Affiliate is live today. Brand subscription went live in [month]. In-feed ads are the 2026 unlock."',
      hitThese: [
        'Affiliate (live): [X%] take rate via FlexOffers / Skimlinks. Pure margin after creator payout.',
        'Brand subscription (live): tiered SaaS for connected Shopify partners. $[X] starter / $[Y] pro / $[Z] enterprise.',
        'In-feed product ads (2026): boosted product_creative slots, capped at ~10% of feed inventory.',
        'Walk a $100 checkout through: $[X] to brand, $[Y] to Catalog (affiliate), $[Z] to creator. Per-try-on contribution: cost ~$0.50, output [N] product views + [M] clickouts + $[X] affiliate revenue. Contribution-positive on day one.',
      ],
      numbersToKnow: [
        '[Current blended take rate]',
        '[# paying brand partners + MRR]',
        '[Avg revenue per try-on]',
        '[Creator payout share]',
      ],
      ifAsked: [
        {
          q: 'Why not own checkout?',
          a: 'Brands integrate BECAUSE we send them traffic - they own CRM, fulfillment, returns. The day we own checkout is the day brands churn.',
        },
        {
          q: 'What\'s the contribution margin per try-on?',
          a: 'Cost ~$0.50 (Seedance Lite). Output: [N] product views, [M] clickouts, $[X] affiliate revenue. Positive on day one.',
        },
      ],
    },
  },
  {
    title: 'Competitive: who\'s structurally locked out',
    description:
      'Amazon, Shopify, TikTok Shop, LTK each can\'t ship this - for structural reasons specific to their P&L, not lack of capability.',
    minutes: 2,
    cheatsheet: {
      openWith:
        '"Four incumbents on the map. Each is structurally locked out of cross-brand AI-native discovery - for reasons specific to their business model, not lack of capability."',
      hitThese: [
        'Amazon - P&L depends on shoppers staying inside Amazon. Will not generate cross-brand content that links out to Shopify stores. Innovator\'s dilemma in its purest form.',
        'Shopify - value-prop is "your store, your customer". A discovery layer that pools shoppers across competing stores breaks that promise. Brands integrate with us BECAUSE Shopify won\'t.',
        'TikTok Shop - entertainment-first, algorithmic firehose. Can\'t organize a structured catalog around personal taste.',
        'LTK / ShopMy - link-in-bio for the top 1% of influencers. Don\'t generate; locked into fashion + beauty; no AI tooling.',
        'Our moat: AI generation (Seedance via Fal) + creator-curated catalogs + cross-brand similarity (Marengo embeddings + pgvector) + Shopify partner integrations. ~6 months of engineering per piece - the glue is the moat.',
      ],
      ifAsked: [
        {
          q: 'What stops Amazon from shipping AI search?',
          a: 'They\'ll ship it for Amazon products only - strengthening their walled garden. Our shoppers come BECAUSE they want cross-brand. Amazon can\'t ship cross-brand without breaking their P&L.',
        },
        {
          q: 'What about Meta / Instagram?',
          a: 'Meta retired Instagram Shop in 2023. The vacuum is what created our window - a top-of-funnel for retail that isn\'t locked into Amazon\'s walled garden or Meta\'s ad model.',
        },
      ],
    },
  },
  {
    title: 'Team',
    description:
      'Founders + key hires. Ten seconds per person - the bio is in the deck appendix.',
    minutes: 2,
    cheatsheet: {
      openWith:
        '"Two co-founders. [Name] previously [shipped X at Y]. I previously [shipped X at Y]. Both technical, both have shipped consumer-scale products before."',
      hitThese: [
        'Founder #1: domain edge - the unfair advantage they bring.',
        'Founder #2: complementary skill - the wedge they cover.',
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
      'Now the framing changes. The product is built. The objective of this round is ONE thing - start the flywheel that grows the company on its own.',
    minutes: 3,
    cheatsheet: {
      openWith:
        '"Raising $[X] on a [valuation] cap. [$Y] already committed. Here\'s the framing that matters - and it\'s the first time I\'m saying this word in the meeting on purpose: the entire objective of this round is to START THE FLYWHEEL. Every try-on we generate is shareable content. Every share brings in a new shopper at zero CAC. Right now we\'re paying CAC to seed the loop. Once the share-loop K-factor crosses 1, the company grows on its own - every shopper brings in the next one. This round is the spark; after that, the company is fundamentally different."',
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
    title: 'Q&A and next steps',
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
    title: 'Welcome & the one idea',
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
    title: 'Founder story & why now',
    description:
      'The unfair advantage that lets US ship this - and why the 18-month window is real.',
    minutes: 5,
    cheatsheet: {
      openWith:
        '"Two threads converged. [Co-founder] spent [X years] doing [thing]. I spent [Y years] doing [thing]. The wedge between those is the rare combination this product needs - consumer growth instincts + AI-content engineering + brand relationships."',
      hitThese: [
        'The personal moment: when you saw cheap AI try-on become real and realized the search-bar UX was about to die.',
        'Unfair advantage: why YOU specifically. Consumer growth chops, engineering depth on AI generation, brand-network from prior work.',
        'Why now: AI video at <$0.50/generation only landed in 2025. The primitive that makes generation-as-search possible was structurally absent 18 months ago.',
        'Why not earlier: Polyvore, Wanelo, ShopStyle all tried curated catalogs without an AI generation primitive - every piece of content cost human time, didn\'t compound.',
        'Why not later: 18-month window before Amazon AI shopping, TikTok Shop, Pinterest AI try (and mostly fail because their P&L blocks them).',
      ],
      ifAsked: [
        {
          q: 'How long have you been working on this?',
          a: '[N months]. We\'ve been building the infrastructure deliberately - try-on pipeline, share UX, brand integrations, creator payouts. Every piece is a building block for the round\'s objective.',
        },
        {
          q: 'What did you learn from prior failed attempts in this space?',
          a: 'They tried curated catalogs without AI generation - content production didn\'t scale. We waited for the primitive to land, then built on top.',
        },
      ],
      watchOutFor: [
        'Don\'t make the founder story long. Investors want one signal: would you bet years of your life on this? Show conviction.',
      ],
    },
  },
  {
    title: 'The problem: retail search is broken',
    description:
      'Retail search is 1995 tech. The keyword-to-product translation step is where most shoppers fail or bounce. AI generation makes that step disappear.',
    minutes: 5,
    cheatsheet: {
      openWith:
        '"Retail search hasn\'t meaningfully changed since 1995 - keywords, lists, filters, reviews. Shoppers describe what they want in their head (\'a black tank that drapes\'), translate it into clumsy keywords (\'black sleeveless top\'), then sift results that ignore body, context, and taste. The translation step is the friction - and where most shoppers bounce."',
      hitThese: [
        'The search-bar UX has barely evolved in 30 years across every retail platform - Amazon, Shopify stores, Walmart, Target.',
        'PDP photos are aspirational, sizing-blind, decontextualized. Shoppers have to imagine themselves wearing the product. Fashion-DTC return rates of 30-40% are the cost of that guesswork.',
        'AI generation replaces search → list → guess with: pick a product, see yourself wearing it in 30 seconds, decide. Generation IS the search result.',
        'Shopper, brand, and creator all benefit:',
        '  • Shoppers see themselves in the product before buying.',
        '  • Brands stop renting attention from Meta and Amazon ads - they get top-of-funnel traffic from shoppers who arrive with intent.',
        '  • Creators with taste - across all retail verticals - finally have a way to monetize curation without grinding out content full-time.',
        'Why now: AI video at <$0.50/generation only landed in 2025. Structurally absent 18 months ago. Window before incumbents react: ~24 months.',
      ],
      ifAsked: [
        {
          q: 'Who exactly is the customer?',
          a: 'Two-sided. Shoppers are consumer-facing (free, ad/affiliate monetized). Brands are paying (subscription + ads). Creators are supply-side (revshare). Same shape as YouTube.',
        },
        {
          q: 'Isn\'t Amazon\'s Rufus this?',
          a: 'Rufus is a chatbot bolted onto Amazon\'s 1995 funnel - the result is still a list of products you scroll. We replace the result page entirely. The answer to "what should I wear" isn\'t a list, it\'s a 30-second video of you wearing it.',
        },
        {
          q: 'Why hasn\'t Google or Perplexity built this?',
          a: 'Horizontal AI search can\'t crack vertical retail without: a structured product catalog, brand integrations, a creator revshare model, and a generation pipeline tuned to bodies and clothes. None of those are general problems. We\'re vertical-deep on purpose.',
        },
        {
          q: 'Why fashion first?',
          a: 'Cleanest AI generation economics today. Highest content-to-revenue ratio. The same pipeline ports unchanged to beauty, home, and gear.',
        },
      ],
    },
  },
  {
    title: 'Live demo: extremely fluid discovery',
    description:
      'Show what AI-for-searching feels like end-to-end. Four moves: discover, try-on, share, return shopper. Let the AI generation render live.',
    minutes: 10,
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
    title: 'Market: AI for searching $1T+ of retail',
    description:
      'Whoever owns AI-native search for retail owns the top of the funnel - same trajectory as Google for the open web. Two sizings converge on the same number.',
    minutes: 5,
    cheatsheet: {
      openWith:
        '"US retail e-commerce is $1.1T. Amazon owns 38% on a 30-year-old search UX. The AI-search layer for the rest of retail is the next $100B+ company - same trajectory Google ran for the open web. Two sizings - bottom-up from our funnel, top-down from category benchmarks - converge on the same wedge."',
      hitThese: [
        'TAM: $6T global retail e-commerce. $1.1T US. Growing 8% YoY post-pandemic.',
        'SAM (3 years out): AI-native discoverable retail in US/EN - apparel, beauty, home, gear, accessories. ~$400B addressable.',
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
        'Lead with retail, defend with fashion as the wedge. Don\'t flip the order - investors hear "fashion company" and price down.',
      ],
    },
  },
  {
    title: 'Traction: the product is working',
    description:
      'Eight metrics. Engagement, retention, supply, demand, revenue. The signal is how they reinforce each other; call out the share-rate inflection.',
    minutes: 8,
    cheatsheet: {
      openWith:
        '"I\'m going to walk you through eight metrics. The signal isn\'t any single number - it\'s how they reinforce each other. The most important line on the page is share rate; that\'s the one I want you to remember."',
      hitThese: [
        '1. WAU shoppers - current + W/W growth + source split (organic / share-driven / paid). Show share-driven as a growing % of total.',
        '2. Try-ons generated per week - the engagement signal that says AI-search is the right surface. Per-WAU rate.',
        '3. Share rate - % of generated try-ons that get shared externally. THE single most important number on this slide.',
        '4. K-factor - new sessions per shared try-on. Show the trend; mark the date if you\'ve crossed K=1.',
        '5. Cohort retention W4 / W8 / W12 - call out: generation-flow users retain at 2-3x baseline because they have a personalized artifact.',
        '6. Brand pull - new Shopify integrations / month. Note the acceleration curve (brands come AFTER share traffic crosses [Y%]).',
        '7. Creator pull - new curators publishing / month. They come for the distribution the share loop creates.',
        '8. GMV + MRR - conversion of all the above into revenue. Should compound at the same rate as the loop spins.',
        'Inflection slide: "We shipped [the share UX revamp] in week [X]. Share rate went from [Y%] to [Z%]. Brand-integration rate doubled the next month."',
      ],
      numbersToKnow: [
        '[WAU last 4 weeks, W/W %]',
        '[% of WAU from share-driven traffic]',
        '[Try-ons generated / week per WAU]',
        '[Share rate %]',
        '[K-factor (current + 4-week trend)]',
        '[W4/W8/W12 retention - generation-flow vs baseline]',
        '[New brand integrations + creators / month]',
        '[Confirmed GMV + brand MRR]',
        '[Cost per generation today vs 6 months ago]',
      ],
      ifAsked: [
        {
          q: 'What does week-1 to week-4 retention look like?',
          a: '[X%] / [Y%] for generation-flow users - 2–3x baseline. They have a personalized artifact, the share loop pulls them back, and the bookmarks compound across sessions.',
        },
        {
          q: 'When does K cross 1 sustainably?',
          a: 'Per our model: [X WAU] + [Y%] share rate. We\'re at [current values] today. The round closes the gap.',
        },
        {
          q: 'How do you know brand integrations are pulled, not pushed?',
          a: '[N%] of last quarter\'s new brand signups came inbound - they reached out after seeing share-driven clickout volume. We track inbound vs outbound explicitly.',
        },
      ],
      watchOutFor: [
        'Don\'t hide failed cohorts. If a Q3 cohort retained badly, explain why and what changed.',
        'Do NOT present this as 8 isolated metrics. The story is "they all move together because they\'re sides of the same loop".',
      ],
    },
  },
  {
    title: 'Business model & unit economics',
    description:
      'Three revenue streams: affiliate today, brand subscription this year, in-feed ads next. CAC, LTV, payback, contribution margin.',
    minutes: 5,
    cheatsheet: {
      openWith:
        '"Three revenue streams, layered chronologically. Affiliate is live. Brand subscription went live in [month]. In-feed ads are the 2026 unlock."',
      hitThese: [
        'AFFILIATE (live): [X%] take rate via FlexOffers / Skimlinks. Each clickout pays.',
        'BRAND SUBSCRIPTION (live): tiered SaaS for connected Shopify partners. $[X] starter / $[Y] pro / $[Z] enterprise. Brands pay because we send organic clickouts they can\'t buy elsewhere.',
        'IN-FEED ADS (2026): boosted product_creative inventory, capped at ~10% of feed. Pricing scales with WAU.',
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
          a: 'Industry standard for affiliate networks is 0–10%. We pay [X%]. Higher per-clickout than LTK on absolute dollars when you account for the AI generation tooling we provide - they don\'t need to produce content.',
        },
        {
          q: 'When do you become marketplace?',
          a: 'Never. Marketplace = we own checkout = brands churn. Brands integrate BECAUSE we send them traffic; the day we own checkout is the day they leave.',
        },
        {
          q: 'What\'s the contribution margin on a single generated try-on?',
          a: 'Cost: $0.50. Output: [N] product views, [M] clickouts, $[X] affiliate revenue, plus the share-driven shopper acquisition value. Net contribution per try-on is [$Y] - and that ignores the brand-side and ad-side monetization.',
        },
      ],
    },
  },
  {
    title: 'Competitive moat',
    description:
      'Generation pipeline, brand network, creator network, data moat. Why each compounds. Address obvious threats head-on.',
    minutes: 4,
    cheatsheet: {
      openWith:
        '"Four moats, each compounding on the others. The structural one is bigger than any of them: every incumbent in retail is locked out of the wedge by their own business model."',
      hitThese: [
        '1. Generation pipeline. Seedance prompts + role-tagged products + Marengo embeddings + pgvector + Fal queue + webhook orchestration. Proprietary glue, ~6 months of engineering to replicate.',
        '2. Brand network. Shopify partner integration with [N] live brands across [M] categories. Each new brand gives shoppers more cross-brand inventory; each shopper gives brands more clickouts.',
        '3. Creator network. [N] active curators with published catalogs, revshare baked into our payouts pipeline. Defensible because creators don\'t want to maintain catalogs in N places - once we\'re the home, switching cost is high.',
        '4. Data moat. Every clickout, save, and generation feeds Marengo + pgvector embeddings → better recommendations → more clickouts. Compounds quarterly.',
        'Structural moat: Amazon won\'t cannibalize their P&L by sending shoppers to Shopify stores. Shopify won\'t cannibalize merchants by pooling shoppers across stores. Meta retired Instagram Shop. The lane is structurally open and the incumbents can\'t close it without breaking their core business.',
      ],
      ifAsked: [
        {
          q: 'What if Amazon ships an AI shopping experience?',
          a: 'They\'ll ship it for Amazon products only - strengthening their walled garden, not opening it to Shopify stores. Our shoppers come to us BECAUSE they want cross-brand. Different product, different intent.',
        },
        {
          q: 'What if Shopify acquires Doji or builds AI try-on?',
          a: 'For individual stores. We\'re the layer ABOVE - cross-brand discovery and curation. Their solution makes individual product pages better; ours owns the top of the funnel before the shopper picks a brand.',
        },
        {
          q: 'What if Meta brings shopping back?',
          a: 'They\'ve tried twice and failed. Even if they restart, they won\'t out-curate a creator-led catalog tied to identity. The trust + revshare + AI generation stack is hard to clone with ad money.',
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
        'Engineering hires already signed: [N] - name only the senior ones.',
        'Next two hires post-round: [Head of Brand Partnerships, Sr. AI/ML Engineer, etc.] - be specific.',
        'Advisors: only mention ones who would take an investor reference call.',
      ],
      watchOutFor: [
        'Don\'t recite LinkedIn bios. The investor cares about: would these people walk through a wall for this company?',
      ],
    },
  },
  {
    title: 'The ask: capital to start the flywheel',
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
          All ten phases complete. Pitch wrapped - capture follow-ups while it&apos;s fresh.
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
            storageKey={`admin:fundraising:pitch:${pitchLength}`}
          />
        </>
      )}
    </div>
  );
}
