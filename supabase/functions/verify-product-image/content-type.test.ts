// Tests for normalizeContentType() in index.ts — pure function, no network/Deno.serve.
// Run: deno test --no-check supabase/functions/verify-product-image/content-type.test.ts

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { normalizeContentType } from './index.ts';

Deno.test('bare subtype jpeg -> image/jpeg', () => {
  assertEquals(normalizeContentType('jpeg'), 'image/jpeg');
});

Deno.test('bare subtype jpg -> image/jpeg', () => {
  assertEquals(normalizeContentType('jpg'), 'image/jpeg');
});

Deno.test('bare subtype png -> image/png', () => {
  assertEquals(normalizeContentType('png'), 'image/png');
});

Deno.test('bare subtype webp -> image/webp', () => {
  assertEquals(normalizeContentType('webp'), 'image/webp');
});

Deno.test('bare subtype gif -> image/gif', () => {
  assertEquals(normalizeContentType('gif'), 'image/gif');
});

Deno.test('bare subtype avif -> image/avif', () => {
  assertEquals(normalizeContentType('avif'), 'image/avif');
});

Deno.test('already-proper image/jpeg untouched', () => {
  assertEquals(normalizeContentType('image/jpeg'), 'image/jpeg');
});

Deno.test('image/png with charset param stripped', () => {
  assertEquals(normalizeContentType('image/png; charset=binary'), 'image/png');
});

Deno.test('case-insensitive IMAGE/JPEG -> image/jpeg', () => {
  assertEquals(normalizeContentType('IMAGE/JPEG'), 'image/jpeg');
});

Deno.test('text/html NOT widened into an image', () => {
  const ct = normalizeContentType('text/html');
  assertEquals(ct, 'text/html');
  assertEquals(ct.startsWith('image/'), false);
});

Deno.test('application/xml NOT widened', () => {
  const ct = normalizeContentType('application/xml');
  assertEquals(ct, 'application/xml');
  assertEquals(ct.startsWith('image/'), false);
});

Deno.test('empty string NOT widened', () => {
  const ct = normalizeContentType('');
  assertEquals(ct, '');
  assertEquals(ct.startsWith('image/'), false);
});
