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
        '"Thanks for making time. I\'m [name], co-founder of Catalog. The thing I want to leave you with today is one idea: we\'re activating the first real flywheel in retail discovery — AI try-on creates content, users share to socials, traffic compounds, and every loop turn pulls in more brands and creators. The whole pitch is about how that flywheel turns."',
      hitThese: [
        'State the meta-thesis upfront: "We\'re activating a flywheel. The pitch is about why it\'s real, why now, and what capital activates it."',
        'Confirm who else is on the call and their role at the firm.',
        'Set the agenda explicitly: problem → demo (flywheel in action) → traction (flywheel turning) → ask (activating it). 7 min for Q&A.',
        'Name-drop the warm intro / mutual contact if there is one.',
      ],
      watchOutFor: [
        'Don\'t small-talk past the 60-second mark. The investor budgeted 30 min, not 35.',
        'Don\'t apologize for anything (broken video, dog barking) — investors mirror your energy.',
        'Don\'t introduce the flywheel as a metaphor. It\'s the actual mechanism — every phase will show one of its sides.',
      ],
    },
  },
  {
    title: 'The problem & the missing flywheel',
    description:
      'Online retail has no flywheel. Amazon has search, Shopify has stores, TikTok has entertainment — none of them have a self-reinforcing discovery loop.',
    minutes: 2,
    cheatsheet: {
      openWith:
        '"Amazon won search. Prime won convenience. But there\'s never been a flywheel in retail discovery — a loop where every shopper attracts the next shopper, every brand attracts the next brand, every piece of content makes the next one cheaper. AI try-on makes that flywheel possible for the first time."',
      hitThese: [
        'Amazon framing: $1.6T on a 1995 UX (search → list → reviews). Linear funnel, no compounding.',
        'Shopify: brands win individually but there\'s no shared discovery surface. No flywheel — just stores.',
        'TikTok Shop: distribution is rented from the algorithm. Turn off the spend, turn off the funnel. No flywheel.',
        'LTK / ShopMy: depend on creators producing content manually. Linear cost-to-content ratio. No flywheel.',
        'The missing piece: a mechanism where every shopper interaction MAKES the platform more valuable for the next shopper. AI try-on is that mechanism — every try-on is content, every share is acquisition, every new shopper is more brand demand.',
        'Why now: AI video at <$0.50/generation only landed in 2025. Before that, you couldn\'t turn shoppers into content producers at zero marginal cost. The flywheel needed this primitive.',
      ],
      ifAsked: [
        {
          q: 'Isn\'t this just TikTok Shop?',
          a: 'TikTok Shop borrows distribution from the algorithm. We GENERATE distribution from the user — every try-on is a shareable artifact. We pay zero CAC for organic shares; TikTok Shop pays algorithm rent forever.',
        },
        {
          q: 'Why hasn\'t Amazon built this?',
          a: 'Amazon\'s economic model needs shoppers to stay inside Amazon. A flywheel that depends on users SHARING content out to TikTok / IG / X is structurally hostile to their walled garden. Shopify has the same problem inversely. Both incumbents are locked out by their own P&L.',
        },
      ],
      watchOutFor: [
        'Don\'t pitch this as a fashion company. The wedge is fashion; the flywheel is all retail.',
        'Don\'t describe the flywheel abstractly — name the four sides (shopper → content → distribution → brand demand) every time.',
      ],
    },
  },
  {
    title: 'Demo: the flywheel in motion',
    description:
      'Show the four sides of the flywheel turning live: discovery → try-on → share → return shopper. The /generate flow is the headline.',
    minutes: 5,
    cheatsheet: {
      openWith:
        '"I\'m going to show you the flywheel turning. Four moves: discovery, try-on, share, return."',
      hitThese: [
        'MOVE 1 — discovery. Land on catalog.shop feed. Cross-brand mix (rag & bone, ALO, Levi\'s) — already broader than any single Shopify store.',
        'MOVE 2 — try-on (the killer moment). Open /generate. Upload a face photo. Pick 2 products. ~30s later: AI video of THE INVESTOR wearing the products. Share button right there.',
        'MOVE 3 — share. Show the share-to-socials flow — every share carries a watermark + a deep link back to catalog.shop/l/<slug>. Each share = free distribution.',
        'MOVE 4 — return. Show the look that came in via a share — same shoppable experience. Tap a product, see retailer drawer + "More like this" cross-brand similar feed. The new shopper enters the loop.',
        'Pause and say: "That\'s one full turn of the flywheel — and we paid zero CAC for the new shopper."',
      ],
      showInApp: [
        'catalog.shop feed — cross-brand mix front and center',
        '/generate end-to-end (the wow moment — let the investor watch the AI video render live)',
        'Share sheet on a generated look (with watermark / branded link visible)',
        'A look opened via share-link → product page → retailer drawer',
      ],
      ifAsked: [
        {
          q: 'How is the AI video generated?',
          a: 'Bytedance Seedance via Fal queue — Lite for fast, Pro for premium. Prompt is composed from height + age band + style preset + product role-tags. ~30s on Lite, ~90s on Pro. Cost: <$0.50/generation, falling.',
        },
        {
          q: 'What\'s the share rate today?',
          a: '[X%] of generated try-ons get shared externally. Each share drives [Y] new sessions on average. Compounds weekly.',
        },
        {
          q: 'Where does the product data come from?',
          a: 'Three pipelines: Shopify partner integration for connected brands, our own Modal-hosted crawlers for direct imports, admin curation for editorial.',
        },
      ],
      watchOutFor: [
        'Lead with the /generate flow, NOT the feed. The feed is table stakes; the try-on is the flywheel ignition.',
        'If the demo breaks: "let me send you a 90-second video after this — the live flow runs at <30s normally". Never apologize.',
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
    title: 'Traction: the flywheel turning',
    description:
      'Show each side of the flywheel with numbers. Generations, share rate, viral coefficient, and the brand + creator pull-in that follows.',
    minutes: 4,
    cheatsheet: {
      openWith:
        '"Six numbers. Each one is one face of the flywheel — and they all move together."',
      hitThese: [
        '1. WAU shoppers — current value, W/W growth, source split (organic vs share-driven vs paid).',
        '2. Try-ons generated per week — and the % that hit "share" externally. THIS is the flywheel input metric.',
        '3. Viral coefficient — new sessions per share. K-factor today is [X]; the goal is K > 1 (every shared try-on brings >1 new shopper back).',
        '4. Cohort retention W4 / W8 / W12 — generation-flow users retain at 2–3x baseline because each session creates a personal artifact.',
        '5. Brand pull: # Shopify integrations / month — accelerating because brands see organic clickout volume from the share loop.',
        '6. Creator pull: # curators publishing per month — they come for the distribution the share loop creates.',
        'Punchline: every metric on the page reinforces every other metric. That IS the flywheel.',
      ],
      numbersToKnow: [
        '[WAU last 4 weeks, W/W growth %]',
        '[Try-ons generated per week]',
        '[% of try-ons shared externally]',
        '[K-factor / new sessions per share]',
        '[W4/W8/W12 retention — generation-flow vs baseline]',
        '[Confirmed Shopify-attributed GMV]',
        '[New brand integrations + new creators per month]',
      ],
      ifAsked: [
        {
          q: 'What\'s your CAC?',
          a: 'Blended [$X]. But marginal CAC on share-driven shoppers is approaching zero — that\'s the flywheel. We pay paid CAC only to seed the loop; once it spins, organic share traffic dominates.',
        },
        {
          q: 'How do you know the flywheel is real and not just a vanity metric?',
          a: 'Three signals: (1) K-factor trending up week-over-week, (2) organic share traffic now [Y%] of WAU, (3) the brand-integration rate accelerated AFTER share traffic crossed [Z%] — they\'re pulling us in, not vice versa.',
        },
      ],
      watchOutFor: [
        'Don\'t cherry-pick the best week. Show the full trend — investors notice consistency.',
        'If the K-factor is below 1, own it: "We\'re paying to seed the loop. It crosses 1 at [X] WAU per our model. Here\'s how we get there."',
      ],
    },
  },
  {
    title: 'Business model: monetizing the flywheel',
    description:
      'Each face of the flywheel monetizes a different way. Affiliate today, brand subscription this year, ad inventory next.',
    minutes: 2,
    cheatsheet: {
      openWith:
        '"Three revenue streams, each one layered onto a face of the flywheel. As the flywheel spins faster, each stream compounds."',
      hitThese: [
        'Affiliate (live): [X%] take rate via FlexOffers / Skimlinks. Each share-driven clickout pays — share volume is the input, affiliate revenue is the output.',
        'Brand subscription (live): tiered SaaS for connected Shopify partners. Brands pay because the flywheel creates organic clickouts — they\'re renting a top-of-funnel they can\'t get elsewhere.',
        'In-feed product ads (2026): boosted product_creative slots. Pricing scales with WAU; WAU scales with the flywheel.',
        'Walk a $100 checkout through: $X to brand, $Y to Catalog (affiliate), $Z to creator (revshare). Contribution margin compounds because content production cost is ~$0.50 per try-on.',
      ],
      numbersToKnow: [
        '[Current blended take rate]',
        '[# paying brand partners + MRR]',
        '[Avg revenue per try-on shared]',
        '[Creator payout share]',
      ],
      ifAsked: [
        {
          q: 'Why not own checkout / become a marketplace?',
          a: 'Owning checkout breaks the flywheel\'s brand side. Brands integrate BECAUSE we send them traffic — they own CRM, fulfillment, returns. The day we own checkout is the day brands churn.',
        },
        {
          q: 'What\'s the contribution margin on a generated try-on?',
          a: 'Cost is ~$0.50 (Seedance Lite). One try-on generates [N] product views, [M] clickouts, $[X] in affiliate revenue, plus the share-driven shopper acquisition. Payback per try-on is well inside the loop.',
        },
      ],
      watchOutFor: [
        'Don\'t describe the business as "we\'ll figure out monetization later". The flywheel monetizes at every input.',
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
    title: 'The ask: capital to activate the flywheel',
    description:
      'Round size, runway, and the four flywheel inputs the capital activates. Every dollar maps to making the loop spin faster.',
    minutes: 3,
    cheatsheet: {
      openWith:
        '"Raising $[X] on a [valuation] cap. [$Y] committed. We\'re not raising to BUILD the flywheel — that\'s built and turning. We\'re raising to ACTIVATE it: spend the seed CAC to get K above 1, then let it compound."',
      hitThese: [
        'Round size + valuation + structure.',
        'Existing commitments — names if permitted, otherwise "$[Y] from prior investors".',
        'Use of funds, mapped to the flywheel sides:',
        '  — [X%] paid acquisition seed (drives shoppers into the try-on funnel — fuel for the share loop)',
        '  — [Y%] AI compute scale (Seedance / Fal — every share lowers $/share so we can subsidize more)',
        '  — [Z%] brand partnerships team (close the brand pull side)',
        '  — [W%] creator acquisition (revshare guarantees + tooling)',
        '  — [V%] runway buffer',
        'Milestones (next raise): K-factor > 1 sustained for [N] weeks, [WAU target], [N] paying brands, [generation cost target].',
      ],
      numbersToKnow: [
        '[Current burn / month]',
        '[Runway pre-round / post-round]',
        '[Current K-factor + target K-factor for next raise]',
        '[Cost-per-generation today vs targeted at scale]',
      ],
      watchOutFor: [
        'Never say "we\'ll spend it on engineering and growth". Map every spend bucket to a flywheel input.',
        'Be ready to defend why paid CAC is the right activation lever today vs raw engineering hires.',
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
          a: 'When K crosses 1 and stays there, every flywheel turn is more shoppers, more brands, more content — at decreasing marginal cost. Amazon got to $1.6T on a flywheel that didn\'t even include user-generated distribution. Ours does.',
        },
        {
          q: 'What\'s the single biggest risk to the flywheel?',
          a: 'Share rate. If users don\'t share their try-ons, K stays below 1 and we\'re another paid-acquisition company. Mitigation: we\'ve A/B-tested [X] variants of the share UX; current share rate is [Y%]; we have a roadmap to push it to [Z%] via [specific lever].',
        },
        {
          q: 'What keeps you up at night?',
          a: 'Pick ONE real risk and how you\'re mitigating it. Don\'t deflect.',
        },
      ],
      watchOutFor: [
        'Don\'t end the meeting without a concrete ask. "We\'ll be in touch" from an investor means dead.',
        'Send the recap email within 4 hours — questions, answers, asks, next steps.',
        'Every Q&A answer should ladder back to the flywheel. If you can\'t connect a question to the loop, you\'re losing the room.',
      ],
    },
  },
];

const AGENDA_60: Phase[] = [
  {
    title: 'Welcome & the meta-thesis',
    description:
      'Set the meta-thesis upfront: this whole pitch is about activating the first real flywheel in retail discovery.',
    minutes: 3,
    cheatsheet: {
      openWith:
        '"Great to meet. Quick context on what I want to leave you with: this pitch is about ONE thing — activating a four-sided flywheel in retail discovery. AI try-on creates content, users share to socials, traffic compounds, brands and creators get pulled in. Every move I show you today is a face of that loop."',
      hitThese: [
        'State the meta-thesis in the first 30 seconds. Don\'t bury it in the deck.',
        'Reference one specific investment or post the partner has put out.',
        'Confirm everyone on the call. Note titles + who looks engaged.',
        'Set the arc: "Founder story → why no one else has built a flywheel here → demo (the loop in motion) → traction (the loop turning) → ask (the capital that activates it). 12 min for Q&A."',
        'Establish conviction. Investors fund flywheels — they fund FOUNDERS who can make a flywheel turn.',
      ],
      watchOutFor: [
        'Don\'t reference a portfolio investment generically. Have one specific point ready.',
        'Don\'t over-prepare rapport. 3 minutes max.',
        'Lock in the flywheel framing in the first minute. The rest of the meeting depends on it.',
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
    title: 'The problem: retail has no flywheel',
    description:
      'Walk through every existing retail model and prove that none of them have a self-reinforcing loop. Set up why our flywheel is different.',
    minutes: 5,
    cheatsheet: {
      openWith:
        '"Pause on this for a second: name a single retail platform with a real flywheel. Amazon? Linear funnel — search, list, buy. Shopify? Stores in isolation. TikTok Shop? Distribution rented from the algorithm. LTK? Content production scales linearly with creator hours. There is NO flywheel in retail discovery today."',
      hitThese: [
        'Amazon — the funnel: keyword → list → reviews → buy. Every shopper acquisition costs the same. No compounding.',
        'Shopify — sells stores; doesn\'t pool shoppers. No discovery flywheel BY DESIGN.',
        'TikTok Shop — distribution rented from a third-party algorithm. Spend stops, traffic stops.',
        'LTK / ShopMy — creator content scales linearly with creator labor. No share-loop mechanism.',
        'Pinterest — closest thing to a discovery flywheel ever shipped, but no AI generation, no shoppable closure to checkout. Stalled at $13B.',
        'Our flywheel — four sides, all compounding: (1) shopper opens app → (2) does AI try-on → (3) shares to socials → (4) traffic returns + brands and creators pull in → loops back to (1). Each turn lowers the marginal cost of the next.',
        'The missing primitive (AI try-on at <$1) is what lets the flywheel exist. It became possible 18 months ago. Window before incumbents notice: ~24 months.',
      ],
      ifAsked: [
        {
          q: 'Who exactly is the customer?',
          a: 'Two-sided. Shoppers are consumer-facing (free, ad/affiliate monetized). Brands are paying (subscription + ads). Creators are supply-side (revshare). Same shape as YouTube — except the flywheel ALSO uses shoppers as content producers, which YouTube doesn\'t.',
        },
        {
          q: 'Why fashion first?',
          a: 'Cleanest unit economics for AI generation today (full-body video at <$1). Highest content-to-revenue ratio. The flywheel mechanics port unchanged to beauty, home, and gear once we\'ve dialed in the share rate.',
        },
        {
          q: 'What if Pinterest builds a flywheel?',
          a: 'They\'d need three things they don\'t have: AI generation, creator revshare, and shoppable closure. That\'s a 2-year build. We\'ll have crossed K=1 by then.',
        },
      ],
    },
  },
  {
    title: 'Live demo: turning the flywheel',
    description:
      'Spin the flywheel live — discover, try-on, share, return. The /generate flow is the headline; let it render in real time.',
    minutes: 10,
    cheatsheet: {
      openWith:
        '"I\'m going to spin the flywheel for you live. Four moves. Then I\'ll let you drive."',
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
    title: 'Ask: capital that activates the flywheel',
    description:
      'Round size, runway, milestones — every dollar maps to one face of the flywheel. K=1 is the headline milestone.',
    minutes: 12,
    cheatsheet: {
      openWith:
        '"Raising $[X] on a [valuation] cap. [$Y] already committed. We\'re NOT raising to build the flywheel — that\'s built and starting to spin. We\'re raising to ACTIVATE it: get K above 1 and let it compound. Every dollar maps to one face of the loop."',
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
