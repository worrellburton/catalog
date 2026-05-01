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
    title: 'Welcome & introductions',
    description:
      'Quick handshake. Confirm who is on the call, names, roles, and what the investor wants to get out of the next 30 minutes.',
    minutes: 1,
    cheatsheet: {
      openWith:
        '"Thanks for making time. I\'m [name], co-founder of Catalog. Before I dive in — anything specific you want me to lead with, or should I run the standard arc?"',
      hitThese: [
        'Confirm who else is on the call and their role at the firm.',
        'Set the agenda explicitly: problem, demo, traction, ask, Q&A.',
        'Reaffirm the time box — "I\'ll keep us to 23 min so we have 7 for questions."',
        'Name-drop the warm intro / mutual contact if there is one.',
      ],
      watchOutFor: [
        'Don\'t small-talk past the 60-second mark. The investor budgeted 30 min, not 35.',
        'Don\'t apologize for anything (broken video, dog barking) — investors mirror your energy.',
      ],
    },
  },
  {
    title: 'The problem',
    description:
      'The pain we solve, who feels it, and why now. One vivid customer anecdote — keep it concrete, not abstract.',
    minutes: 2,
    cheatsheet: {
      openWith:
        '"Amazon won the search-bar era. Prime won the convenience era. The next era belongs to whoever wins AI-native discovery — and the incumbent is structurally unable to ship it. Online retail discovery is broken: shoppers can\'t see products in context, and the people with actual taste have no way to monetize curation without grinding out content full-time."',
      hitThese: [
        'Amazon framing: a $1.6T retail giant built on a 1995 mental model — type a keyword, scroll a list, read reviews. AI-native shoppers reject this UX.',
        'Shopper side: product images are aspirational, sizing-blind, decontextualized. Across every category — apparel, beauty, home, gear — shoppers want to see the product on someone like them, in context.',
        'Curator side: people with taste (across all retail verticals, not just fashion) earn pennies per affiliate click. The creator-commerce stack is built for the top 1% of influencers, not the long tail of curators.',
        'Brand side: Amazon\'s search ads and Meta\'s paid social are both saturated. Brands need a new top-of-funnel that arrives with intent.',
        'Why now: AI video + multi-modal embeddings let us generate personalized product-in-context content per-user, per-product. That was impossible 18 months ago.',
      ],
      ifAsked: [
        {
          q: 'Isn\'t this just TikTok Shop?',
          a: 'TikTok Shop is a checkout layer on entertainment content — algorithmic firehose, no curation, no cross-brand discovery. Catalog is a structured catalog: products are organized, shoppable, and tied to identity (creator + shopper), not vibes.',
        },
        {
          q: 'Why hasn\'t Amazon or Pinterest done this?',
          a: 'Amazon\'s incentive is to keep you in their funnel — they won\'t generate cross-brand creator content that links out to Shopify stores. Pinterest indexes other people\'s images; they don\'t generate them, and they can\'t close the loop to checkout. Both are structurally locked out of the wedge.',
        },
      ],
      watchOutFor: [
        'Don\'t pitch this as a fashion company. The wedge is fashion; the surface is all retail. Investors fund category-defining outcomes, not vertical SaaS.',
        'Don\'t present the problem as "we\'re building tools for creators". Present it as a shopper outcome — investors fund consumer demand.',
      ],
    },
  },
  {
    title: 'Demo: the product in 90 seconds',
    description:
      'Show the live app. Open one look, save a product, click out. Narrate the wedge. No slides during demo.',
    minutes: 5,
    cheatsheet: {
      openWith:
        '"Let me just show you. This is catalog.shop — production. Every product on this feed is shoppable end-to-end."',
      hitThese: [
        'Land on the feed. Tap one look — narrate the morph (shared video element, no reload).',
        'Open the product page on a card. Show the retailer comparison drawer — point out the "Lowest" badge.',
        'Trigger Save. Then back. Then open a different product — show "More like this" cross-brand similar feed.',
        'Show the /generate flow if time allows: face photo + 2 products → AI lookbook video in ~30s.',
      ],
      showInApp: [
        'catalog.shop main feed (mobile or desktop)',
        'A look detail with creator avatar + 3+ products',
        'A product page with retailer chips + "More from <Brand>" rail',
        '/generate flow → live job → published look',
      ],
      ifAsked: [
        {
          q: 'How is the video generated?',
          a: 'Bytedance Seedance via Fal — Lite for fast, Pro for premium. We compose prompts from the user\'s height, age band, style preset, and product role-tags. ~30s per generation on Lite, ~90s on Pro.',
        },
        {
          q: 'Where does the product data come from?',
          a: 'Three pipelines: Shopify partner integration for connected brands, our own Modal-hosted crawlers for direct product imports, and admin curation for the editorial catalog.',
        },
      ],
      watchOutFor: [
        'If the demo breaks live, do NOT say "this works on my machine". Say "let\'s skip ahead, I\'ll send you a video walkthrough after this call".',
        'Don\'t show admin-only pages. Investors care about the shopper experience.',
      ],
    },
  },
  {
    title: 'Market opportunity',
    description:
      'TAM / SAM / SOM in one slide. Anchor with a comparable category transition (TikTok → Shop, Pinterest → boards, etc.).',
    minutes: 2,
    cheatsheet: {
      openWith:
        '"US retail e-commerce is $1.1T and growing 8% per year. Amazon owns ~38% of it on a 30-year-old UX. The AI-native discovery layer for the rest of retail is the next $100B+ company."',
      hitThese: [
        'TAM: global retail e-commerce — $6T+ and rising.',
        'SAM: US/EN AI-native discoverable retail — apparel, beauty, home, gear, accessories. ~$400B.',
        'SOM 3 years out: 0.5–1% of SAM with our current wedge (fashion-led) plus category expansion to beauty + home.',
        'Wedge → expansion: fashion is where AI-generated try-on content has the cleanest unit economics. Same pipeline ports to beauty (try-on with face), home (place-in-room), gear (lifestyle context).',
        'Comparables: Amazon at IPO ($438M), Pinterest at IPO ($13B), Shopify at IPO ($1.3B). All three were "obvious in hindsight" verticals built on a UX shift.',
      ],
      numbersToKnow: [
        '[Live MAU on catalog.shop]',
        '[GMV trailing 30 days]',
        '[# active brands integrated via Shopify]',
        '[# creators with published looks]',
      ],
      watchOutFor: [
        'Don\'t use bottom-up TAM and top-down TAM in the same breath. Pick one, defend it.',
        'Don\'t pitch only fashion. Lead with retail; explain fashion as the wedge.',
      ],
    },
  },
  {
    title: 'Traction & metrics',
    description:
      'Weekly active shoppers, looks generated, clickout volume, revenue runrate. Show the trend, not just the latest number.',
    minutes: 4,
    cheatsheet: {
      openWith:
        '"Here\'s the trajectory over the last [N] weeks. I\'ll walk through the four metrics that matter."',
      hitThese: [
        'WAU shoppers — week-over-week growth rate.',
        'Looks generated per week — split organic vs paid acquisition.',
        'Clickouts to brand sites — and the conversion rate from clickout to confirmed order (where we have Shopify webhook data).',
        'Brand-side: # connected stores, GMV through Catalog, average take rate.',
        'Cohort retention — week 4 / week 8 / week 12. This is the metric VCs will dig into.',
      ],
      numbersToKnow: [
        '[WAU last 4 weeks, with W/W growth]',
        '[Total looks published]',
        '[Total clickouts last 30 days]',
        '[Confirmed GMV via Shopify webhooks]',
        '[Cohort retention W4/W8/W12]',
      ],
      ifAsked: [
        {
          q: 'What\'s your CAC?',
          a: 'Blended [$X] — but creator-driven looks have organic distribution, so true marginal CAC on engaged users approaches zero.',
        },
        {
          q: 'How sticky is week-1 retention?',
          a: '[X%] — driven by the bookmarks feature and the algorithmic feed. Generation-flow users retain at 2–3x baseline because they have a personalized library.',
        },
      ],
      watchOutFor: [
        'Don\'t cherry-pick the best week. Investors will ask for the chart, and inconsistencies kill trust.',
        'If a metric is down, address it head-on with the cause and the fix.',
      ],
    },
  },
  {
    title: 'Business model',
    description:
      'Affiliate take rate today, ad inventory tomorrow, partner subscription floor. Walk a single $X spend through to net revenue.',
    minutes: 2,
    cheatsheet: {
      openWith:
        '"Three revenue streams, layered. Today is mostly affiliate. By Q[X] next year, ads and brand subscription dominate."',
      hitThese: [
        'Affiliate: [X%] take rate via networks (FlexOffers, Skimlinks). Live today.',
        'Brand subscription: tiered SaaS for connected Shopify partners — $X/mo + usage.',
        'In-feed ads: product_creative inventory we sell to brands. Margin scales with WAU.',
        'Walk a $100 shopper checkout through: $X to brand, $Y to Catalog, $Z to creator.',
      ],
      numbersToKnow: [
        '[Current blended take rate]',
        '[# paying brand partners]',
        '[Ad CPM benchmark in fashion]',
        '[Creator payout share]',
      ],
      ifAsked: [
        {
          q: 'Why not just be a marketplace?',
          a: 'Marketplaces own checkout — we explicitly don\'t. We send the shopper to the brand\'s site so the brand owns CRM, fulfillment, returns. That\'s why brands integrate.',
        },
      ],
      watchOutFor: [
        'Don\'t describe the business as "we\'ll figure out monetization later". Pick the wedge that\'s real today and defend it.',
      ],
    },
  },
  {
    title: 'Competitive landscape',
    description:
      'Who is in the lane, where they fall short, and why our wedge (creator-led catalogs, AI generation) is hard to copy.',
    minutes: 2,
    cheatsheet: {
      openWith:
        '"Four incumbents on the map — Amazon, Shopify, TikTok Shop, and the LTK/ShopMy creator-commerce stack. Each is structurally locked out of cross-brand AI-native discovery for one of three reasons."',
      hitThese: [
        'Amazon — owns the search-bar era. Their entire economic model depends on shoppers staying inside Amazon. They will NOT build a surface that sends traffic to Shopify stores. Innovator\'s dilemma in the cleanest possible form.',
        'Shopify — their incentive is to keep brands inside their walled gardens. A cross-brand discovery surface is anti-Shopify by design (pro-shopper, which is why brands opt in to ours).',
        'TikTok Shop — entertainment-first, algorithmic firehose. Can\'t organize a structured, curated catalog around personal taste.',
        'LTK / ShopMy / similar — link-in-bio for the top 1% of influencers. Don\'t generate content; locked into fashion + beauty; no AI tooling.',
        'Our moat: the only stack that combines AI video generation (Seedance via Fal) + creator-curated catalogs + cross-brand similarity (Marengo embeddings + pgvector) + Shopify partner integrations. Each piece is ~6 months of engineering on its own; the glue is the moat.',
      ],
      ifAsked: [
        {
          q: 'What stops Amazon from building this?',
          a: 'Amazon\'s revenue model depends on shoppers staying inside Amazon. Cross-brand discovery that links out to Shopify stores is structurally hostile to their P&L. They\'re Blockbuster in 2007 — they see the shift, but they can\'t ship it without cannibalizing.',
        },
        {
          q: 'What stops Shopify from building this?',
          a: 'Same dilemma in reverse. Shopify\'s value-prop to merchants is "your store, your customer". A discovery layer that pools shoppers across competing stores breaks that promise. Brands integrate with us BECAUSE Shopify won\'t.',
        },
        {
          q: 'What about Meta / Instagram?',
          a: 'Meta retired Instagram Shop in 2023. The vacuum is exactly what created our window — a top-of-funnel for retail that isn\'t locked into Amazon\'s walled garden or Meta\'s ad model.',
        },
      ],
    },
  },
  {
    title: 'Team',
    description:
      'Founders, key hires, what each of us has shipped before. Ten seconds per person — they can read the bio later.',
    minutes: 2,
    cheatsheet: {
      openWith:
        '"Two co-founders. [Name] previously [shipped X at Y]. I previously [shipped X at Y]. Both technical, both have shipped consumer-scale products before."',
      hitThese: [
        'Founder #1: domain edge — the unfair advantage they bring.',
        'Founder #2: complementary skill — the wedge they cover.',
        'Key hire #1 (if any): why this person joined.',
        'Advisors: only name-drop ones who would actually take an investor reference call.',
      ],
      watchOutFor: [
        'Don\'t list every hire. The investor wants to know that the founders can recruit, not that you have a 12-person org chart.',
      ],
    },
  },
  {
    title: 'The ask & use of funds',
    description:
      'Round size, lead terms (if any), runway it buys, and the 4–6 milestones we hit before the next raise.',
    minutes: 3,
    cheatsheet: {
      openWith:
        '"We\'re raising $[X] on a [valuation] cap. [$Y] committed from [prior investors]. Looking for a lead at [check size]."',
      hitThese: [
        'Round size + valuation (or note "we\'re flexible on structure for the right lead").',
        'Existing commitments — names if you have permission, otherwise "$[Y] from prior investors".',
        'Runway: this round buys us [N] months to hit [milestone].',
        'Use of funds: [X%] engineering, [Y%] creator acquisition, [Z%] brand partnerships, [W%] runway buffer.',
        'Milestones: 4–6 specific, time-bound goals you commit to.',
      ],
      numbersToKnow: [
        '[Current burn rate / month]',
        '[Months of runway with current cash]',
        '[Months of runway after the round]',
        '[Specific revenue / WAU milestone for the next raise]',
      ],
      watchOutFor: [
        'Never say "we\'ll spend it on engineering and growth". Be specific or you sound unprepared.',
      ],
    },
  },
  {
    title: 'Q&A and next steps',
    description:
      'Open the floor. Capture every question — written down — and end with a concrete ask: data room, follow-up call, or partner intro.',
    minutes: 7,
    cheatsheet: {
      openWith:
        '"Open to questions. What\'s on your mind?"',
      hitThese: [
        'Write down every question. Even ones you answer well — they\'re tells about the firm\'s thesis.',
        'If a question is hard, say "great question, here\'s how we think about it" — never "I don\'t know" without a follow-up.',
        'Ask THEM questions: "What would you need to see to move forward?" "Who else at the firm should I meet?"',
        'Close with a concrete next step. Data room link, follow-up call on date, partner intro.',
      ],
      ifAsked: [
        {
          q: 'How does this become a $10B+ outcome?',
          a: 'AI-native discovery is the next Amazon. We own the top of the funnel for a $1T+ retail category — starting with fashion as the wedge, expanding to beauty, home, and gear as the same pipeline ports. Pinterest IPO\'d at $13B with weaker monetization and a single category. Amazon at IPO was $438M.',
        },
        {
          q: 'What keeps you up at night?',
          a: 'Pick ONE real risk and how you\'re mitigating it. Don\'t deflect.',
        },
      ],
      watchOutFor: [
        'Don\'t end the meeting without a concrete ask. "We\'ll be in touch" from an investor means dead.',
        'Send the recap email within 4 hours — questions, answers, asks, next steps.',
      ],
    },
  },
];

const AGENDA_60: Phase[] = [
  {
    title: 'Welcome & rapport',
    description:
      'Catch up briefly. Connect on a mutual contact or recent investment. Set the agenda explicitly so the investor knows the arc.',
    minutes: 3,
    cheatsheet: {
      openWith:
        '"Great to actually meet. Saw you led [recent investment] — congrats on that. Before I run the deck, anything specific you want me to spend more time on?"',
      hitThese: [
        'Reference one specific investment or post the partner has put out — shows you did homework.',
        'Confirm everyone on the call. Note titles. Note who looks engaged vs distracted.',
        'Set the arc explicitly: "Founder story → problem → demo → traction → ask, with 12 min for Q&A".',
        'Establish energy. This is a partner meeting, not a screening call — the room reads your conviction in the first 90 seconds.',
      ],
      watchOutFor: [
        'Don\'t reference an investment without saying something specific about it. "Saw your portfolio" is worse than not saying anything.',
        'Don\'t over-prepare the rapport phase. 3 minutes max — the deck is what gets you funded.',
      ],
    },
  },
  {
    title: 'Founder story & why now',
    description:
      'How we ended up working on this. The conviction, the unfair advantage, and why this window is open today and not in 2019 or 2030.',
    minutes: 5,
    cheatsheet: {
      openWith:
        '"Two threads converged. [Co-founder] spent [X years] doing [thing]. I spent [Y years] doing [thing]. The wedge between those is what Catalog is."',
      hitThese: [
        'The personal moment: when you saw the gap. A specific scene, not a thesis statement.',
        'The unfair advantage: why YOU specifically can build this — relationships, technical chops, brand network.',
        'Why now: AI video at <$0.50 per generation only landed in 2025. The infra (Seedance, Veo, Marengo embeddings) didn\'t exist 18 months ago.',
        'Why not earlier: tried-and-failed efforts in this space (Polyvore, Wanelo, ShopStyle) lacked AI generation + creator-curation glue.',
        'Why not later: incumbents are on the move (Pinterest AI, TikTok Shop). 12-month window before the surface gets contested.',
      ],
      ifAsked: [
        {
          q: 'How long have you been working on this?',
          a: '[N months]. Architecturally we\'re on Remix + Supabase + Fal — set up to scale before we needed it.',
        },
      ],
      watchOutFor: [
        'Don\'t make the founder story too long. Investors ARE interested, but they\'re really looking for one signal: would you bet years of your life on this?',
      ],
    },
  },
  {
    title: 'The problem, in depth',
    description:
      'Three customer archetypes, what their journey looks like today, and where the friction lives. Real quotes beat slides.',
    minutes: 5,
    cheatsheet: {
      openWith:
        '"Online retail is run on a 1995 mental model — search bar, list of results, photos shot in a studio. Three archetypes feel this hardest. Let me walk through each."',
      hitThese: [
        'Shopper (Gen Z / millennial, mobile-first): across categories — apparel, beauty, home, gear — they want to see the product on someone like them, in their context, before buying. Static PDP photos + reviews are a 30-year-old solution.',
        'Curator (sub-100k niche taste, across verticals): "I have great taste — in clothes, in skincare, in home goods — but the only way to monetize it today is to grind out content full-time on Instagram or TikTok." The creator-commerce stack (LTK, ShopMy) is fashion-only and built for the top 1%.',
        'Brand (DTC across categories): "Amazon ads are saturated. Meta CAC is climbing every quarter. We need a top-of-funnel that arrives with intent, not impressions."',
        'The bridge: AI video + multi-modal embeddings let a curator publish 50+ pieces of personalized product-in-context content per week without filming anything. The unit economics of content production flip overnight.',
        'Why fashion first: highest content-to-revenue ratio (a single try-on video → multiple SKU clickouts), cleanest AI generation pipeline. Same architecture ports to beauty (face try-on), home (place-in-room), gear (lifestyle context).',
      ],
      ifAsked: [
        {
          q: 'Who exactly is the customer?',
          a: 'Two-sided: shoppers are the consumer-facing customer (free, ad/affiliate-monetized), brands are the paying customer (subscription + ads). Creators are the supply-side participant — revshare, not payments. Same model that worked for YouTube and TikTok.',
        },
        {
          q: 'Why not start with all categories at once?',
          a: 'Wedge discipline. Fashion is where the AI generation pipeline gives us the cleanest unit economics today. Once we own that surface, we extend the same multi-modal stack to beauty, home, and gear.',
        },
      ],
    },
  },
  {
    title: 'Live product demo',
    description:
      'Full walkthrough — feed, look detail, product page, search, generate flow. Pause for the investor to drive if they want.',
    minutes: 10,
    cheatsheet: {
      openWith:
        '"Pulling up catalog.shop now. This is production — the same site any user gets. I\'ll drive for the first part, then hand you the keyboard."',
      hitThese: [
        '1. Feed — scroll through the mixed look + product feed. Note the cross-brand mix (rag & bone, ALO, Levi\'s, etc.).',
        '2. Tap a look — narrate the morph. Show the creator avatar + tagged products.',
        '3. From the look, tap a product → ProductPage. Show retailer drawer (Bloomingdale\'s, Amazon, Nordstrom comparison with "Lowest" badge).',
        '4. Hit back — should restore the look (recently shipped fix).',
        '5. Search: type "blue summer dress" → semantic search via Marengo embeddings.',
        '6. /generate flow — full pipeline: photo + 2 products → live job → AI video lookbook in ~30s.',
        '7. (If admin context) Show admin/content → Unpublished tab → click Model on a row → pipeline node diagram + prompt + parameters.',
      ],
      showInApp: [
        'catalog.shop main feed',
        'A look with a creator + 4 products',
        'A product page with retailer drawer + brand rail + cross-brand "More like this"',
        '/generate end-to-end flow (this is the killer demo)',
        'admin/content Unpublished → Model expansion (only if technical investor)',
      ],
      ifAsked: [
        {
          q: 'How is the AI video so good?',
          a: 'Bytedance Seedance Pro for premium, Lite for fast. We compose prompts with style preset + role-tagged products + height/age band. Fal handles queue + webhook callbacks.',
        },
        {
          q: 'What about IP / model rights?',
          a: 'Generated content is owned by us under Fal\'s commercial license. Face photos are user-uploaded; we surface a clear consent flow. No third-party celebrity faces, ever.',
        },
        {
          q: 'How do you handle copyright on product images?',
          a: 'We crawl with proper attribution, link out via affiliate, and pull down on takedown notice. For paid Shopify partners, the brand explicitly licenses imagery via the partner agreement.',
        },
      ],
      watchOutFor: [
        'Don\'t demo bug-fixes you just shipped without testing them once. Run through the full flow on the call device 30 min before the meeting.',
        'Have a 90-second video walkthrough as Plan B if the live demo fails.',
      ],
    },
  },
  {
    title: 'Market sizing & opportunity',
    description:
      'Bottom-up calc: shoppers × sessions × take rate. Cross-check with comparable creator-commerce platforms and category benchmarks.',
    minutes: 5,
    cheatsheet: {
      openWith:
        '"US retail e-commerce is $1.1T. Amazon owns 38% on a 30-year-old UX. The AI-native discovery layer for the rest of retail is the next $100B+ company. Two sizings — bottom-up from our funnel, top-down from category benchmarks — converge on the same wedge."',
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
    title: 'Traction, growth & key metrics',
    description:
      'Cohort retention, week-over-week growth, GMV through-flow. Call out the inflection point and what triggered it.',
    minutes: 8,
    cheatsheet: {
      openWith:
        '"Six metrics, in order of importance for our stage."',
      hitThese: [
        '1. WAU shoppers — current value, W/W growth, source split (organic / referral / paid).',
        '2. Cohort retention — W4 / W8 / W12 — call out the cohort that broke through.',
        '3. Looks generated — total + per-week. Split admin-curated vs creator-published vs shopper-self-generated.',
        '4. Clickout volume → confirmed orders (where Shopify webhook is wired). Conversion %.',
        '5. GMV through-flow last 30 days. Average order value. Brand mix.',
        '6. Brand-side: # connected Shopify partners, # brands paying for promotion, $ MRR.',
        'Highlight the inflection: "When we shipped [feature] in week [X], retention jumped from [Y] to [Z]". That\'s the slide investors remember.',
      ],
      numbersToKnow: [
        '[WAU last 4 weeks, growth %]',
        '[W4/W8/W12 cohort retention]',
        '[Total looks: admin / creator / shopper]',
        '[Clickouts last 30 days]',
        '[Confirmed Shopify-attributed GMV]',
        '[Connected brands / paying brands / brand MRR]',
        '[Generation pipeline: success rate, avg duration]',
      ],
      ifAsked: [
        {
          q: 'What does week-1 to week-4 retention look like?',
          a: '[X%] / [Y%] — driven by bookmarks + creator follow + algorithmic feed personalization. Generate-flow users retain at 2-3x baseline because of personalized library.',
        },
        {
          q: 'How many looks need to work for unit economics to flip?',
          a: '~[N] looks viewed per session at current take rate gets us to contribution-positive on a paid shopper. We\'re at [X] today.',
        },
      ],
      watchOutFor: [
        'Don\'t hide failed cohorts. If a Q3 cohort retained badly, explain why and what changed.',
      ],
    },
  },
  {
    title: 'Business model & unit economics',
    description:
      'CAC, LTV, payback, contribution margin. The path from take-rate-only today to multi-product (ads + subscription) over 18 months.',
    minutes: 5,
    cheatsheet: {
      openWith:
        '"Three revenue streams, layered chronologically. Affiliate is live. Brand subscription went live in [month]. Ad inventory is the 2026 unlock."',
      hitThese: [
        'Affiliate (live): [X%] take rate via FlexOffers / Skimlinks. Pure margin after creator payout.',
        'Brand subscription (live): tiered SaaS for connected Shopify partners. $[X] starter / $[Y] pro / $[Z] enterprise.',
        'In-feed product ads (2026): brands buy boosted product_creative slots. CPM-based, capped at ~10% of feed inventory.',
        'Unit walk-through: $100 checkout → $[X] to brand, $[Y] to Catalog (affiliate), $[Z] to creator (revshare). Contribution margin [%].',
        'CAC: blended $[X] today. LTV: $[Y] at current retention. Payback: [N] months — getting shorter every quarter.',
      ],
      numbersToKnow: [
        '[Blended CAC]',
        '[Avg LTV per shopper]',
        '[Payback period in months]',
        '[Contribution margin per order]',
        '[Creator revshare %]',
      ],
      ifAsked: [
        {
          q: 'Why is the creator share so [low/high]?',
          a: 'Industry standard for affiliate networks is 0–10%. We pay [X%] because we generate the look — the creator doesn\'t produce content manually. Higher than LTK on a per-clickout basis when you account for our generation tooling.',
        },
        {
          q: 'When do you become marketplace?',
          a: 'We don\'t plan to. Marketplace = we own checkout. We explicitly send shoppers to the brand because the brand owns CRM. That\'s why brands integrate. The day we own checkout is the day brands churn.',
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
    title: 'Ask, milestones & Q&A',
    description:
      'Round size, terms, what the capital unlocks, and the milestones we commit to. Long open Q&A — make it a real conversation.',
    minutes: 12,
    cheatsheet: {
      openWith:
        '"Raising $[X] on a [valuation] cap. [$Y] committed. Looking for a lead at [check size]. This buys us [N] months to hit [specific milestone]."',
      hitThese: [
        'Round size + valuation + structure (priced round / SAFE / convertible).',
        'Existing commitments — names if permission, otherwise dollar amount.',
        'Use of funds: % to engineering, % to creator acquisition, % to brand partnerships, % to runway buffer.',
        '6 specific, time-bound milestones for the next raise — pick ones you\'ll actually hit.',
        'Q&A: open, take notes, ask THEM questions. End with explicit next step.',
      ],
      numbersToKnow: [
        '[Current burn / month]',
        '[Months runway pre-round / post-round]',
        '[Specific revenue + WAU milestone for next raise]',
        '[Hires planned with the round]',
      ],
      ifAsked: [
        {
          q: 'What would you do with 2x more money?',
          a: 'Hire 3 more brand-partnership AEs and double creator acquisition spend. NOT engineering — engineering is solved with the team we have.',
        },
        {
          q: 'What does the next round look like?',
          a: 'Series A in [N] months, $[X]M at $[Y]M post. Triggers are: [WAU target], [revenue target], [N] paying brands.',
        },
        {
          q: 'How do you become a $10B+ company?',
          a: 'AI-native discovery is the next Amazon. We start with fashion (cleanest unit economics for AI generation), expand to beauty, home, and gear on the same pipeline, and end up owning the top of the funnel for a $1T+ retail category. Amazon at IPO was $438M; Pinterest at IPO was $13B with weaker monetization in a single vertical. The window is the next 24 months before incumbents wake up.',
        },
        {
          q: 'What\'s your biggest risk?',
          a: 'Pick ONE real risk. Be specific about how you\'re mitigating. Never deflect.',
        },
      ],
      watchOutFor: [
        'Never end without a concrete next step. "We\'ll be in touch" = dead. Push for: data room, partner intro, follow-up scheduled before you hang up.',
        'Send the recap email within 4 hours: questions, answers, asks, decided next steps. This single discipline closes more rounds than any deck slide.',
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
