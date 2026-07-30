import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { upgradeImageUrl, imageDims } from './image-source.ts';

Deno.test('Amazon: strips the size/crop suffix to reach the full original', () => {
  // The exact URL that was stored as a 232x232 square for a portrait book cover.
  assertEquals(
    upgradeImageUrl('https://images-na.ssl-images-amazon.com/images/I/81-efiaH6+L._AC_UL232_SR232,232_.jpg'),
    'https://images-na.ssl-images-amazon.com/images/I/81-efiaH6+L.jpg',
  );
  // Single-token form.
  assertEquals(
    upgradeImageUrl('https://m.media-amazon.com/images/I/81-efiaH6+L._SY385_.jpg'),
    'https://m.media-amazon.com/images/I/81-efiaH6+L.jpg',
  );
});

Deno.test('Amazon: an already-bare asset URL is left alone', () => {
  const bare = 'https://m.media-amazon.com/images/I/81-efiaH6+L.jpg';
  assertEquals(upgradeImageUrl(bare), bare);
});

Deno.test('Cloudinary: inserts c_fit when w_/h_ carry no crop mode', () => {
  // Peter Millar's own URL — w_800,h_800 with no crop mode means c_scale,
  // which stretched a 1260x1416 (0.890) photo into a 800x800 square.
  assertEquals(
    upgradeImageUrl('https://res.cloudinary.com/petermillar/image/upload/f_auto,q_auto,w_800,h_800/v1775067942/ME0EB82_KHA.jpg'),
    'https://res.cloudinary.com/petermillar/image/upload/c_fit,f_auto,q_auto,w_800,h_800/v1775067942/ME0EB82_KHA.jpg',
  );
});

Deno.test('Cloudinary: an explicit crop mode is respected, not overridden', () => {
  for (const mode of ['c_fill', 'c_pad', 'c_limit', 'c_fit']) {
    const u = `https://res.cloudinary.com/x/image/upload/${mode},w_800,h_800/v1/a.jpg`;
    assertEquals(upgradeImageUrl(u), u, `${mode} must be preserved`);
  }
});

Deno.test('Cloudinary: a transform with no w_/h_ is left alone', () => {
  const u = 'https://res.cloudinary.com/x/image/upload/f_auto,q_auto/v1/a.jpg';
  assertEquals(upgradeImageUrl(u), u);
});

Deno.test('unknown hosts and junk input pass through untouched', () => {
  for (const u of [
    'https://shop.lululemon.com/p/x/img_800x800.png',
    'https://cdn.shopify.com/s/files/1/x/foo_800x800.jpg',
    'not a url',
    '',
  ]) {
    assertEquals(upgradeImageUrl(u), u);
  }
});

Deno.test('imageDims reads PNG dimensions', () => {
  // 8-byte signature + IHDR length/type + width/height
  const png = new Uint8Array(32);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  new DataView(png.buffer).setUint32(16, 1694);
  new DataView(png.buffer).setUint32(20, 2560);
  assertEquals(imageDims(png), { width: 1694, height: 2560 });
});

Deno.test('imageDims reads JPEG dimensions from the SOF0 frame header', () => {
  // SOI, then an APP0 segment to skip, then SOF0 carrying height/width.
  const jpg = new Uint8Array([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x04, 0x00, 0x00,             // APP0, length 4
    0xff, 0xc0, 0x00, 0x11, 0x08, 0x05, 0x88, 0x04, 0xEC, // SOF0: h=1416 w=1260
    ...new Array(16).fill(0),
  ]);
  assertEquals(imageDims(jpg), { width: 1260, height: 1416 });
});

Deno.test('imageDims returns null on non-image bytes rather than guessing', () => {
  assertEquals(imageDims(new Uint8Array([1, 2, 3, 4])), null);
});
