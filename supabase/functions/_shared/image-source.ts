// Image source normalization + geometry.
//
// Merchant CDNs frequently hand us a URL that has ALREADY been downsized or
// distorted by the merchant's own transform, and we were re-hosting THAT as the
// permanent render source. Two real cases, both measured 2026-07-29:
//
//   Amazon    .../81-efiaH6+L._AC_UL232_SR232,232_.jpg  ->  232x232, ratio 1.000
//             the SAME asset with the suffix stripped   -> 1694x2560, ratio 0.662
//             (a portrait book cover stored squashed into a square, at 1/49th
//              the pixels — and the pipeline had the better variant available,
//              but pruned it, because prune ranks by content and never by size)
//
//   Cloudinary .../f_auto,q_auto,w_800,h_800/ME0EB82_KHA.jpg -> 800x800, 1.000
//              the true original                             -> 1260x1416, 0.890
//              Cloudinary's DEFAULT crop mode is c_scale, which STRETCHES to hit
//              both dimensions. Adding c_fit preserves aspect: 712x800, 0.890.
//              This is what a ~12% horizontal squash looks like on a feed card.

/** Rewrite a merchant image URL to the best available original. Returns the
 *  input unchanged when the host is unknown or the URL is unparseable. */
export function upgradeImageUrl(raw: string): string {
  try {
    const u = new URL(raw);

    // Amazon: strip the size/crop token group to get the full-res original.
    //   /images/I/<asset>._<TOK>_.<ext>            -> /images/I/<asset>.<ext>
    //   /images/I/<asset>._AC_UL232_SR232,232_.jpg -> /images/I/<asset>.jpg
    if (/(^|\.)(media-amazon|ssl-images-amazon)\.com$/i.test(u.hostname)) {
      // The asset id is everything up to the FIRST dot; any dot-separated token
      // group between it and the extension is Amazon's sizing directive. Listing
      // the token characters explicitly does not work - the groups nest
      // underscores and commas (._AC_UL232_SR232,232_.) - so match "asset, then
      // anything, then extension" and require BOTH dots, which leaves an
      // already-bare URL untouched.
      u.pathname = u.pathname.replace(
        /\/images\/I\/([^/.]+)\..*\.(jpg|jpeg|png|webp)$/i,
        (_m, asset, ext) => `/images/I/${asset}.${ext}`,
      );
      return u.href;
    }

    // Cloudinary: a transform that sets w_/h_ but names no crop mode defaults
    // to c_scale (stretch). Insert c_fit so the aspect ratio survives.
    if (/(^|\.)res\.cloudinary\.com$/i.test(u.hostname)) {
      u.pathname = u.pathname.replace(
        /\/upload\/([^/]*\b[wh]_\d+[^/]*)\//,
        (m, seg: string) => (/\bc_[a-z]+/.test(seg) ? m : `/upload/c_fit,${seg}/`),
      );
      return u.href;
    }
  } catch { /* not a parseable URL — leave it alone */ }
  return raw;
}

/** Minimal JPEG/PNG/WebP header parse. We need PIXEL dimensions, not byte size:
 *  a 232x232 thumbnail and a 2560px original both clear a byte-size floor, and
 *  only the pixels tell you which is worth conditioning a video render on. */
export function imageDims(b: Uint8Array): { width: number; height: number } | null {
  // PNG
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50) {
    const dv = new DataView(b.buffer, b.byteOffset);
    return { width: dv.getUint32(16), height: dv.getUint32(20) };
  }
  // JPEG — walk the marker segments to the SOF frame header
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    const dv = new DataView(b.buffer, b.byteOffset);
    let i = 2;
    while (i < b.length - 9) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m >= 0xc0 && m <= 0xc3) return { width: dv.getUint16(i + 7), height: dv.getUint16(i + 5) };
      if (m === 0xd8 || m === 0xd9 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
      i += 2 + dv.getUint16(i + 2);
    }
  }
  // WebP
  if (b.length > 30 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
    const dv = new DataView(b.buffer, b.byteOffset);
    const fmt = String.fromCharCode(b[12], b[13], b[14], b[15]);
    if (fmt === 'VP8X') {
      return {
        width: (b[24] | (b[25] << 8) | (b[26] << 16)) + 1,
        height: (b[27] | (b[28] << 8) | (b[29] << 16)) + 1,
      };
    }
    if (fmt === 'VP8 ') {
      return { width: dv.getUint16(26, true) & 0x3fff, height: dv.getUint16(28, true) & 0x3fff };
    }
  }
  return null;
}
