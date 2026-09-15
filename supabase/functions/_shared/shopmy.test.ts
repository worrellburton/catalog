// Run: deno test --no-check --allow-read supabase/functions/_shared/shopmy.test.ts
import { parseShopMyUrl, mapPin } from './shopmy.ts';

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
  assert(r?.sectionId === 409, 'sectionId');
});

Deno.test('parses a shop URL without a section', () => {
  const r = parseShopMyUrl('https://shopmy.us/justbobbidotcom');
  assert(r?.username === 'justbobbidotcom', 'bare username form');
  assert(r?.sectionId === null, 'no section');
});

Deno.test('rejects a non-ShopMy URL', () => {
  assert(parseShopMyUrl('https://ltk.app/someone') === null, 'must reject non-shopmy host');
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

Deno.test('skips a pin whose link is not a product page', () => {
  const m = mapPin(
    { id: 1, title: 'Cart', link: 'https://www.amazon.com/gp/cart/view.html',
      image: 'https://x/a.jpg', product: { AllBrand_name: 'X', fallbackPrice: 5 } } as any,
    CTX,
  ) as any;
  assert('skip' in m, 'cart link must be skipped');
});

Deno.test('keeps curation context in raw_data', () => {
  const pin = fixture.pins[0];
  const m = mapPin(pin, CTX) as any;
  if ('skip' in m) return;
  assert(m.raw_data.shopmy.collection_name === 'The Shoe Diary', 'collection name kept');
  assert(m.raw_data.shopmy.section_name === "Bobbi's Closet", 'section name kept');
  assert(m.raw_data.shopmy.curator === 'justbobbidotcom', 'curator kept');
  assert(typeof m.raw_data.shopmy.affiliate_link !== 'undefined', 'their link kept as provenance');
});
