// Run: deno test --no-check --allow-read supabase/functions/_shared/shopmy.test.ts
import { parseShopMyUrl, mapPin, mapCurator, pinAffiliateUrl } from './shopmy.ts';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`FAILED: ${msg}`);
}

const fixture = JSON.parse(
  await Deno.readTextFile(new URL('./fixtures/shopmy-collection.json', import.meta.url)),
);
const CTX = { curator: 'justbobbidotcom', collectionId: 4132497,
              collectionName: 'The Shoe Diary', sectionName: "Bobbi's Closet" };

Deno.test('parses a shop URL with a section', () => {
  const r = parseShopMyUrl('https://shopmy.us/shop/justbobbidotcom?tab=collections&Section_id=409');
  assert(r?.username === 'justbobbidotcom', 'username');
  assert(r?.curatorId === null, 'curatorId must be null when a path username is present');
  assert(r?.sectionId === 409, 'sectionId');
});

Deno.test('parses a shop URL without a section', () => {
  const r = parseShopMyUrl('https://shopmy.us/justbobbidotcom');
  assert(r?.username === 'justbobbidotcom', 'bare username form');
  assert(r?.curatorId === null, 'curatorId must be null when a path username is present');
  assert(r?.sectionId === null, 'no section');
});

Deno.test('parses a shop URL keyed by numeric Curator_id (no path username)', () => {
  const r = parseShopMyUrl('https://shopmy.us/shop?Curator_id=171052&Section_id=516840&tab=collections');
  assert(r?.username === null, 'username must be null');
  assert(r?.curatorId === 171052, 'curatorId');
  assert(r?.sectionId === 516840, 'sectionId');
});

Deno.test('rejects /shop with neither a username nor a Curator_id', () => {
  assert(parseShopMyUrl('https://shopmy.us/shop') === null, 'must reject with no identifier at all');
  assert(parseShopMyUrl('https://shopmy.us/shop?tab=collections') === null, 'must reject with only unrelated params');
});

Deno.test('treats a non-numeric Curator_id as absent', () => {
  assert(parseShopMyUrl('https://shopmy.us/shop?Curator_id=abc') === null, 'non-numeric Curator_id with no path username must reject');
});

Deno.test('prefers the path username over Curator_id when a URL somehow has both', () => {
  const r = parseShopMyUrl('https://shopmy.us/shop/justbobbidotcom?Curator_id=171052');
  assert(r?.username === 'justbobbidotcom', 'path username wins');
  assert(r?.curatorId === null, 'curatorId dropped in favor of the path username');
});

Deno.test('rejects a non-ShopMy URL', () => {
  assert(parseShopMyUrl('https://ltk.app/someone') === null, 'must reject non-shopmy host');
});

Deno.test('rejects lookalike hosts', () => {
  assert(parseShopMyUrl('https://notshopmy.us/drconnieyang') === null, 'must reject a host that merely contains shopmy.us');
  assert(parseShopMyUrl('https://shopmy.us.evil.com/drconnieyang') === null, 'must reject shopmy.us as a subdomain of another host');
});

Deno.test('rejects a malformed URL', () => {
  assert(parseShopMyUrl('not a url') === null, 'must reject unparseable input');
});

Deno.test('maps the merchant PDP, never the affiliate link', () => {
  const pin = fixture.pins.find((p: any) => (p.link ?? '').includes('mytheresa'));
  assert(!!pin, 'fixture must contain the mytheresa pin');
  const m = mapPin(pin, CTX) as any;
  assert(!('skip' in m), 'should not skip');
  assert(m.url.includes('mytheresa.com'), 'url must be the merchant PDP');
  assert(!m.url.includes('linksynergy'), 'url must never be the Rakuten affiliate link');
  assert(m.brand === 'Gucci', `brand should prefer AllBrand_name, got ${m.brand}`);
  assert(m.price === '$820.00', `price formatted to catalog convention, got ${m.price}`);
  assert(m.currency === 'USD', 'currency');
  assert(m.type === 'Clogs', 'type from Category_name');
  assert(Array.isArray(m.images) && m.images.length === 1, 'exactly one image');
  assert(m.raw_data.shopmy.merchant_name === 'Mytheresa', `merchant_name should be the retailer, got ${m.raw_data.shopmy.merchant_name}`);
  assert(m.raw_data.shopmy.merchant_domain === 'mytheresa.com', 'merchant_domain still present');
});

Deno.test('strips the BRAND | prefix from the title', () => {
  const pin = fixture.pins.find((p: any) => (p.title ?? '').includes('|'));
  assert(!!pin, 'fixture must contain a piped title');
  const m = mapPin(pin, CTX) as any;
  assert(!m.name.includes('|'), `name should not keep the pipe, got ${m.name}`);
});

Deno.test('skips a pin with no brand and no price', () => {
  const bad = fixture.pins.filter((p: any) => {
    const pr = p.product ?? {};
    return !pr.AllBrand_name && pr.fallbackPrice == null;
  });
  assert(bad.length > 0, 'fixture must contain an incomplete pin');
  for (const p of bad) {
    const m = mapPin(p, CTX) as any;
    assert('skip' in m, `expected skip for ${p.title}`);
  }
});

Deno.test('does not skip product slugs that merely start with a bad prefix', () => {
  // Boundary matching, not substring: Cartier is a real brand whose slugs
  // start with "cart". A bare startsWith() would silently drop them.
  for (const slug of ['cartier-love-bracelet', 'searchlight-boot', 'accountability-journal', 'checkout-lounge-chair']) {
    const m = mapPin(
      { id: 1, title: 'Thing', link: `https://shop.example.com/${slug}`, image: 'https://x/a.jpg',
        product: { AllBrand_name: 'X', fallbackPrice: 5, fallbackPriceCurrency: 'USD' } } as any,
      CTX,
    ) as any;
    assert(!('skip' in m), `${slug} must not be skipped, got ${JSON.stringify(m)}`);
  }
  // …but the real bad paths still are.
  for (const bad of ['cart', 'cart/items', 'checkout', 'search']) {
    const m = mapPin(
      { id: 1, title: 'Thing', link: `https://shop.example.com/${bad}`, image: 'https://x/a.jpg',
        product: { AllBrand_name: 'X', fallbackPrice: 5, fallbackPriceCurrency: 'USD' } } as any,
      CTX,
    ) as any;
    assert('skip' in m, `/${bad} must be skipped`);
  }
});

Deno.test('skips a pin whose link is not a product page', () => {
  const m = mapPin(
    { id: 1, title: 'Cart', link: 'https://www.amazon.com/gp/cart/view.html',
      image: 'https://x/a.jpg', product: { AllBrand_name: 'X', fallbackPrice: 5 } } as any,
    CTX,
  ) as any;
  assert('skip' in m, 'cart link must be skipped');
});

Deno.test('skips a pin with a zero fallback price and no brand', () => {
  // ShopMy uses a zero fallbackPrice for an unmatched product; "$0.00" must
  // not defeat the no-brand-no-price skip.
  const m = mapPin(
    { id: 1, title: 'Thing', link: 'https://shop.example.com/some-item', image: 'https://x/a.jpg',
      product: { AllBrand_name: null, fallbackPrice: 0, fallbackPriceCurrency: 'USD' } } as any,
    CTX,
  ) as any;
  assert('skip' in m && m.skip === 'no_brand_or_price', `expected no_brand_or_price skip, got ${JSON.stringify(m)}`);
});

Deno.test('rewrites an uploads-bucket S3 image URL to the ShopMy CDN', () => {
  const m = mapPin(
    { id: 1, title: 'Thing', link: 'https://shop.example.com/a-real-item',
      image: 'https://production-shopmyshelf-uploads.s3.us-east-2.amazonaws.com/pretty-prod-1766714458058',
      product: { AllBrand_name: 'X', fallbackPrice: 5, fallbackPriceCurrency: 'USD' } } as any,
    CTX,
  ) as any;
  assert(!('skip' in m), 'should not skip');
  assert(m.image_url === 'https://static.shopmy.us/uploads/pretty-prod-1766714458058', `expected CDN url, got ${m.image_url}`);
  assert(m.images[0] === m.image_url, 'images[0] must match image_url');
});

Deno.test('rewrites a pins-bucket S3 image URL to the ShopMy CDN', () => {
  const m = mapPin(
    { id: 1, title: 'Thing', link: 'https://shop.example.com/a-real-item',
      image: 'https://production-shopmyshelf-pins.s3.us-east-2.amazonaws.com/zoom-78911874-Skyler-Black-1.jpg',
      product: { AllBrand_name: 'X', fallbackPrice: 5, fallbackPriceCurrency: 'USD' } } as any,
    CTX,
  ) as any;
  assert(!('skip' in m), 'should not skip');
  assert(m.image_url === 'https://static.shopmy.us/pins/zoom-78911874-Skyler-Black-1.jpg', `expected CDN url, got ${m.image_url}`);
  assert(m.images[0] === m.image_url, 'images[0] must match image_url');
});

Deno.test('rewrites a dash-form S3 region host (s3-us-east-2, no dot) to the ShopMy CDN', () => {
  // AWS has two legacy/region host forms: `.s3.<region>.` (dot) and
  // `.s3-<region>.` (dash). ShopMy emits both; only the dot form was
  // previously handled, leaving dash-form urls as unrewritten 403s.
  const m = mapPin(
    { id: 1, title: 'Thing', link: 'https://shop.example.com/a-real-item',
      image: 'https://production-shopmyshelf-uploads.s3-us-east-2.amazonaws.com/eef28f3f-67c9-423f-b834-1f81840d4f4e_cnp5298_chocolate_xl_4.jpeg',
      product: { AllBrand_name: 'X', fallbackPrice: 5, fallbackPriceCurrency: 'USD' } } as any,
    CTX,
  ) as any;
  assert(!('skip' in m), 'should not skip');
  assert(
    m.image_url === 'https://static.shopmy.us/uploads/eef28f3f-67c9-423f-b834-1f81840d4f4e_cnp5298_chocolate_xl_4.jpeg',
    `expected CDN url, got ${m.image_url}`,
  );
  assert(m.images[0] === m.image_url, 'images[0] must match image_url');
});

Deno.test('rewrites a dash-form S3 region host on the pins bucket to the ShopMy CDN', () => {
  const m = mapPin(
    { id: 1, title: 'Thing', link: 'https://shop.example.com/a-real-item',
      image: 'https://production-shopmyshelf-pins.s3-us-east-2.amazonaws.com/zoom-78911874-Skyler-Black-1.jpg',
      product: { AllBrand_name: 'X', fallbackPrice: 5, fallbackPriceCurrency: 'USD' } } as any,
    CTX,
  ) as any;
  assert(!('skip' in m), 'should not skip');
  assert(m.image_url === 'https://static.shopmy.us/pins/zoom-78911874-Skyler-Black-1.jpg', `expected CDN url, got ${m.image_url}`);
  assert(m.images[0] === m.image_url, 'images[0] must match image_url');
});

Deno.test('does not rewrite a lookalike host that merely embeds the S3 pattern in its path', () => {
  const raw = 'https://evil.com/production-shopmyshelf-uploads.s3-us-east-2.amazonaws.com/x';
  const m = mapPin(
    { id: 1, title: 'Thing', link: 'https://shop.example.com/a-real-item', image: raw,
      product: { AllBrand_name: 'X', fallbackPrice: 5, fallbackPriceCurrency: 'USD' } } as any,
    CTX,
  ) as any;
  assert(!('skip' in m), 'should not skip');
  assert(m.image_url === raw, `must not rewrite a non-S3-host lookalike, got ${m.image_url}`);
});

Deno.test('leaves a non-S3 image URL unchanged', () => {
  const m = mapPin(
    { id: 1, title: 'Thing', link: 'https://shop.example.com/a-real-item',
      image: 'https://cdn.somebrand.com/a.jpg',
      product: { AllBrand_name: 'X', fallbackPrice: 5, fallbackPriceCurrency: 'USD' } } as any,
    CTX,
  ) as any;
  assert(!('skip' in m), 'should not skip');
  assert(m.image_url === 'https://cdn.somebrand.com/a.jpg', `must not mangle a non-ShopMy host, got ${m.image_url}`);
});

Deno.test('the fixture\'s first mappable pin gets a static.shopmy.us image, not a raw S3 url', () => {
  let mapped: any = null;
  for (const pin of fixture.pins) {
    const m = mapPin(pin, CTX) as any;
    if (!('skip' in m)) { mapped = m; break; }
  }
  assert(!!mapped, 'fixture must contain a mappable pin');
  assert(mapped.image_url.startsWith('https://static.shopmy.us/'), `expected static.shopmy.us, got ${mapped.image_url}`);
  assert(!mapped.image_url.includes('amazonaws.com'), `must not leave a raw S3 url, got ${mapped.image_url}`);
});

Deno.test('keeps curation context in raw_data', () => {
  const pin = fixture.pins[0];
  const m = mapPin(pin, CTX) as any;
  if ('skip' in m) return;
  assert(m.raw_data.shopmy.collection_name === 'The Shoe Diary', 'collection name kept');
  assert(m.raw_data.shopmy.section_name === "Bobbi's Closet", 'section name kept');
  assert(m.raw_data.shopmy.curator === 'justbobbidotcom', 'curator kept');
  // affiliate_link rotates between identical fetches of the same pin (verified
  // against the live ShopMy API), so it is deliberately NOT stored - keeping it
  // would make every re-sync look like a change and re-fire the products
  // trigger fan-out for no reason. We never use it as our outbound link anyway.
  assert(!('affiliate_link' in m.raw_data.shopmy), 'affiliate_link must not be stored');
});

Deno.test('mapCurator maps ShopMy user block to creator fields', () => {
  const r = mapCurator({
    id: 446,
    name: 'Bobbi Brown',
    username: 'justbobbidotcom',
    image: 'https://production-shopmyshelf-uploads.s3.us-east-2.amazonaws.com/img-user-deres-446-1726690629276',
    description: 'Makeup Artist, Entrepreneur, Hotelier',
  });
  assert(r?.handle === 'justbobbidotcom', 'handle');
  assert(r?.display_name === 'Bobbi Brown', 'display_name');
  assert(r?.bio === 'Makeup Artist, Entrepreneur, Hotelier', 'bio');
  assert(
    r?.avatar_url === 'https://static.shopmy.us/uploads/img-user-deres-446-1726690629276',
    'avatar must be rewritten to the CDN — the raw S3 object returns 403 to anyone',
  );
});

Deno.test('mapCurator normalises handle case, a leading @, and spaces', () => {
  // creators.handle is a case-SENSITIVE unique btree while CreatorAvatarFollow
  // resolves with ilike, so two case variants can both insert and then resolve
  // ambiguously. All three of these must collapse to one handle.
  assert(mapCurator({ username: '@JustBobbi', name: 'B' })?.handle === 'justbobbi', 'strips @ and lowercases');
  assert(mapCurator({ username: 'JustBobbi', name: 'B' })?.handle === 'justbobbi', 'lowercases');
  assert(mapCurator({ username: 'Just Bobbi', name: 'B' })?.handle === 'just-bobbi', 'kebabs spaces');
});

Deno.test('mapCurator falls back to the handle when ShopMy has no name', () => {
  // creators.display_name is NOT NULL, so an empty name cannot pass through.
  const r = mapCurator({ username: 'justbobbidotcom', name: null });
  assert(r?.display_name === 'justbobbidotcom', 'display_name falls back to the handle');
});

Deno.test('mapCurator rejects a user block with no usable username', () => {
  assert(mapCurator({ name: 'Bobbi Brown' }) === null, 'no username');
  assert(mapCurator({ username: '   ', name: 'B' }) === null, 'blank username');
  assert(mapCurator({ username: '@@@', name: 'B' }) === null, 'nothing survives normalisation');
});

Deno.test('pinAffiliateUrl is a pure function of the pin id, with no clickId', () => {
  const u = pinAffiliateUrl(51354524);
  assert(u === 'https://go.shopmy.us/p-51354524', 'exact shape');
  // The reason this replaces ShopMy's own affiliate_link field: that one
  // embeds a fresh clickId UUID per fetch, so storing it made every re-sync
  // look like a change and re-fired the products trigger fan-out.
  assert(!u.includes('clickId') && !u.includes('?'), 'must carry no rotating component');
  assert(pinAffiliateUrl(51354524) === u, 'stable across calls');
});
