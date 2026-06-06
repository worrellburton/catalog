// Download a look's video to the device, compositing one of three creative
// "styles" onto it client-side:
//
//   1. 'logo'     — the Catalog logo in the upper-left (the plain watermark).
//   2. 'products' — an advertisement-style card showing the products in the
//                   look (thumbnail + brand + name + price) over a logo mark.
//   3. 'story'    — an Instagram-story-ready creative: animated gradient
//                   frame, creator handle, floating price chips and a
//                   "Shop this look" CTA.
//
// Compositing replays the video onto a <canvas> (drawing the overlay each
// frame) and re-encodes the canvas stream — plus the original audio track —
// through MediaRecorder. The video host (fal.media) serves
// `access-control-allow-origin: *`, so a crossOrigin video doesn't taint the
// canvas. Product images are loaded with crossOrigin='anonymous'; ones whose
// host doesn't send CORS headers fail to load and are simply skipped (drawn
// as a text-only card) so the canvas never gets tainted and the export keeps
// working. Where MediaRecorder / captureStream isn't available, we fall back
// to downloading the original file untouched.
//
// Delivery: on phones the native share sheet is offered first so the clip can
// be saved straight to Photos / camera roll; desktop falls back to download.

import {
  CATALOG_LOGO_PATH,
  CATALOG_LOGO_VIEWBOX,
  CATALOG_LOGO_ASPECT,
} from '~/constants/brand-logo';

export type DownloadVariant = 'logo' | 'products' | 'story';

export interface DownloadProduct {
  name: string;
  brand?: string | null;
  price?: string | null;
  image_url?: string | null;
}

export interface DownloadLookOptions {
  variant?: DownloadVariant;
  products?: DownloadProduct[];
  creatorHandle?: string | null;
}

function slug(s: string | null | undefined, fallback: string): string {
  const out = (s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return out || fallback;
}

/** `{username}-catalog-{YYYY-MM-DD}` (no extension). */
export function buildLookFilename(username: string | null | undefined, variant: DownloadVariant = 'logo'): string {
  const date = new Date().toISOString().slice(0, 10);
  const suffix = variant === 'logo' ? '' : `-${variant}`;
  return `${slug(username, 'creator')}-catalog${suffix}-${date}`;
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function canEncode(): boolean {
  return typeof window !== 'undefined'
    && 'MediaRecorder' in window
    && typeof HTMLCanvasElement.prototype.captureStream === 'function';
}

function pickMime(): string {
  const candidates = ['video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  for (const c of candidates) {
    try { if (MediaRecorder.isTypeSupported(c)) return c; } catch { /* ignore */ }
  }
  return 'video/webm';
}

function extFor(mime: string): string {
  return mime.startsWith('video/mp4') ? 'mp4' : 'webm';
}

// Rasterize the canonical Catalog wordmark (white) from its vector into an
// <img>. An SVG data URL doesn't taint the canvas. Cached across calls.
let logoImgPromise: Promise<HTMLImageElement | null> | null = null;
function loadLogoImage(): Promise<HTMLImageElement | null> {
  if (logoImgPromise) return logoImgPromise;
  logoImgPromise = new Promise((resolve) => {
    try {
      const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${CATALOG_LOGO_VIEWBOX}">` +
        `<path fill="#ffffff" d="${CATALOG_LOGO_PATH}"/></svg>`;
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    } catch { resolve(null); }
  });
  return logoImgPromise;
}

// Load a product image cross-origin. Resolves null (never throws / never
// taints) when the host doesn't allow CORS, so the caller can skip it.
function loadProductImage(url: string | null | undefined): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    if (!url) { resolve(null); return; }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

// ── canvas drawing helpers ─────────────────────────────────────────────
function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function ellipsize(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxWidth) t = t.slice(0, -1);
  return t + '…';
}

interface ResolvedProduct extends DownloadProduct { img: HTMLImageElement | null }

function drawLogo(ctx: CanvasRenderingContext2D, logo: HTMLImageElement | null, x: number, y: number, w: number, shadow = true) {
  if (!logo) return;
  const h = w * CATALOG_LOGO_ASPECT;
  ctx.save();
  if (shadow) {
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = h * 0.45;
    ctx.shadowOffsetY = 2;
  }
  ctx.globalAlpha = 0.95;
  ctx.drawImage(logo, x, y, w, h);
  ctx.restore();
}

// Variant 2 — advertisement: logo mark + a stacked product card panel.
function drawProductsOverlay(
  ctx: CanvasRenderingContext2D, W: number, H: number,
  logo: HTMLImageElement | null, products: ResolvedProduct[],
) {
  const pad = Math.round(W * 0.04);
  drawLogo(ctx, logo, pad, pad, W * 0.16);

  const list = products.slice(0, 3);
  if (list.length === 0) return;

  const rowH = Math.round(W * 0.15);
  const gap = Math.round(W * 0.025);
  const panelW = W - pad * 2;
  const headerH = Math.round(W * 0.085);
  const panelH = headerH + list.length * rowH + (list.length - 1) * gap + gap * 2;
  const panelX = pad;
  const panelY = H - pad - panelH;

  ctx.save();
  // Panel backdrop.
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = W * 0.05;
  ctx.shadowOffsetY = 4;
  ctx.fillStyle = 'rgba(12,14,18,0.62)';
  roundRectPath(ctx, panelX, panelY, panelW, panelH, W * 0.045);
  ctx.fill();
  ctx.shadowColor = 'transparent';

  // Header.
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.textBaseline = 'middle';
  ctx.font = `700 ${Math.round(W * 0.045)}px ui-sans-serif, -apple-system, "Segoe UI", Roboto, sans-serif`;
  ctx.fillText('Shop the look', panelX + gap * 1.4, panelY + headerH / 2 + gap * 0.3);

  list.forEach((p, i) => {
    const rowY = panelY + headerH + gap + i * (rowH + gap);
    const innerPad = Math.round(rowH * 0.12);
    const thumb = rowH - innerPad * 2;
    const thumbX = panelX + gap * 1.4;
    const thumbY = rowY + innerPad;

    // Thumbnail (image when CORS-clean, else a neutral tile).
    ctx.save();
    roundRectPath(ctx, thumbX, thumbY, thumb, thumb, thumb * 0.16);
    ctx.clip();
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(thumbX, thumbY, thumb, thumb);
    if (p.img) {
      // cover-fit
      const ir = p.img.width / p.img.height;
      let dw = thumb, dh = thumb, dx = thumbX, dy = thumbY;
      if (ir > 1) { dw = thumb * ir; dx = thumbX - (dw - thumb) / 2; }
      else { dh = thumb / ir; dy = thumbY - (dh - thumb) / 2; }
      ctx.drawImage(p.img, dx, dy, dw, dh);
    }
    ctx.restore();

    const textX = thumbX + thumb + gap;
    const priceText = (p.price || '').trim();
    ctx.textAlign = 'right';
    ctx.fillStyle = '#ffffff';
    ctx.font = `700 ${Math.round(W * 0.04)}px ui-sans-serif, -apple-system, "Segoe UI", Roboto, sans-serif`;
    const priceW = priceText ? ctx.measureText(priceText).width + gap : 0;
    if (priceText) ctx.fillText(priceText, panelX + panelW - gap * 1.4, rowY + rowH / 2);

    ctx.textAlign = 'left';
    const textMaxW = panelX + panelW - gap * 1.4 - priceW - textX;
    if (p.brand) {
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.font = `700 ${Math.round(W * 0.028)}px ui-sans-serif, -apple-system, "Segoe UI", Roboto, sans-serif`;
      ctx.fillText(ellipsize(ctx, p.brand.toUpperCase(), textMaxW), textX, rowY + rowH * 0.36);
    }
    ctx.fillStyle = '#ffffff';
    ctx.font = `600 ${Math.round(W * 0.036)}px ui-sans-serif, -apple-system, "Segoe UI", Roboto, sans-serif`;
    ctx.fillText(ellipsize(ctx, p.name || 'Product', textMaxW), textX, rowY + rowH * 0.64);
  });
  ctx.restore();
}

// Variant 3 — story-ready: animated gradient frame, handle, price chips, CTA.
function drawStoryOverlay(
  ctx: CanvasRenderingContext2D, W: number, H: number, t: number,
  logo: HTMLImageElement | null, products: ResolvedProduct[], handle: string | null,
) {
  const pad = Math.round(W * 0.035);

  // Animated gradient frame.
  const hue = (t * 36) % 360;
  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, `hsl(${hue}, 85%, 62%)`);
  grad.addColorStop(0.5, `hsl(${(hue + 90) % 360}, 85%, 62%)`);
  grad.addColorStop(1, `hsl(${(hue + 180) % 360}, 85%, 62%)`);
  ctx.save();
  ctx.lineWidth = Math.round(W * 0.018);
  ctx.strokeStyle = grad;
  ctx.shadowColor = `hsla(${hue}, 85%, 60%, 0.6)`;
  ctx.shadowBlur = W * 0.04;
  roundRectPath(ctx, pad, pad, W - pad * 2, H - pad * 2, W * 0.06);
  ctx.stroke();
  ctx.restore();

  // Top: logo centered + creator handle.
  const logoW = W * 0.32;
  drawLogo(ctx, logo, (W - logoW) / 2, H * 0.07, logoW);
  if (handle) {
    const at = handle.startsWith('@') ? handle : `@${handle}`;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = W * 0.02;
    ctx.font = `600 ${Math.round(W * 0.04)}px ui-sans-serif, -apple-system, "Segoe UI", Roboto, sans-serif`;
    ctx.fillText(at, W / 2, H * 0.07 + logoW * CATALOG_LOGO_ASPECT + W * 0.05);
    ctx.restore();
  }

  // Floating price chips (up to 3) stacked above the CTA.
  const chips = products.slice(0, 3).filter(p => (p.price || '').trim());
  const chipH = Math.round(W * 0.085);
  let chipY = H * 0.66 - chips.length * (chipH + pad * 0.6);
  ctx.save();
  ctx.textBaseline = 'middle';
  chips.forEach((p) => {
    const label = `${p.brand ? p.brand + ' · ' : ''}${p.price}`;
    ctx.font = `600 ${Math.round(W * 0.034)}px ui-sans-serif, -apple-system, "Segoe UI", Roboto, sans-serif`;
    const tw = ctx.measureText(label).width;
    const chipW = tw + W * 0.09;
    const chipX = W - pad - chipW - W * 0.02;
    ctx.fillStyle = 'rgba(10,12,16,0.6)';
    ctx.shadowColor = 'rgba(0,0,0,0.4)';
    ctx.shadowBlur = W * 0.025;
    roundRectPath(ctx, chipX, chipY, chipW, chipH, chipH / 2);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'left';
    ctx.fillText(label, chipX + W * 0.045, chipY + chipH / 2);
    chipY += chipH + pad * 0.6;
  });
  ctx.restore();

  // "Shop this look" CTA pill with a subtle pulse.
  const pulse = 1 + Math.sin(t * 2.2) * 0.02;
  const cta = 'Shop this look';
  ctx.save();
  ctx.font = `700 ${Math.round(W * 0.05)}px ui-sans-serif, -apple-system, "Segoe UI", Roboto, sans-serif`;
  const ctaTextW = ctx.measureText(cta).width;
  const arrowW = W * 0.06;
  const pillW = (ctaTextW + arrowW + W * 0.12) * pulse;
  const pillH = W * 0.135 * pulse;
  const pillX = (W - pillW) / 2;
  const pillY = H * 0.8;
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = W * 0.04;
  ctx.fillStyle = '#ffffff';
  roundRectPath(ctx, pillX, pillY, pillW, pillH, pillH / 2);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = '#0a0a0a';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(cta, pillX + W * 0.06, pillY + pillH / 2);
  // arrow
  ctx.strokeStyle = '#0a0a0a';
  ctx.lineWidth = W * 0.008;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const ax = pillX + W * 0.06 + ctaTextW + W * 0.03;
  const ay = pillY + pillH / 2;
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(ax + arrowW * 0.7, ay);
  ctx.moveTo(ax + arrowW * 0.42, ay - arrowW * 0.28);
  ctx.lineTo(ax + arrowW * 0.7, ay);
  ctx.lineTo(ax + arrowW * 0.42, ay + arrowW * 0.28);
  ctx.stroke();
  ctx.restore();
}

async function watermarkToBlob(
  videoUrl: string,
  opts: DownloadLookOptions,
): Promise<{ blob: Blob; ext: string } | null> {
  if (!canEncode()) return null;
  const variant = opts.variant ?? 'logo';

  const video = document.createElement('video');
  video.crossOrigin = 'anonymous';
  video.src = videoUrl;
  video.playsInline = true;
  video.muted = false;
  video.preload = 'auto';

  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error('video load failed'));
  });

  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) return null;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // Preload overlay assets (logo always; product images for ad/story).
  const logo = await loadLogoImage();
  let resolvedProducts: ResolvedProduct[] = [];
  if (variant !== 'logo') {
    const list = (opts.products ?? []).slice(0, 3);
    resolvedProducts = await Promise.all(list.map(async (p) => ({
      ...p,
      img: await loadProductImage(p.image_url),
    })));
  }

  const stream = canvas.captureStream(30);
  try {
    const v = video as HTMLVideoElement & {
      captureStream?: () => MediaStream;
      mozCaptureStream?: () => MediaStream;
    };
    const vStream = v.captureStream?.() ?? v.mozCaptureStream?.();
    const audio = vStream?.getAudioTracks?.()[0];
    if (audio) stream.addTrack(audio);
  } catch { /* silent export */ }

  const mime = pickMime();
  const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  const finished = new Promise<Blob>((resolve) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: mime }));
  });

  const startedAt = performance.now();
  const drawFrame = () => {
    ctx.drawImage(video, 0, 0, w, h);
    const t = (performance.now() - startedAt) / 1000;
    if (variant === 'products') {
      drawProductsOverlay(ctx, w, h, logo, resolvedProducts);
    } else if (variant === 'story') {
      drawStoryOverlay(ctx, w, h, t, logo, resolvedProducts, opts.creatorHandle ?? null);
    } else {
      // Plain embedded watermark: 30% larger than before (0.20 → 0.26) and
      // no drop shadow per design.
      drawLogo(ctx, logo, Math.round(w * 0.04), Math.round(w * 0.04), w * 0.26, false);
    }
  };

  let raf = 0;
  const loop = () => {
    if (video.paused || video.ended) return;
    drawFrame();
    raf = requestAnimationFrame(loop);
  };

  recorder.start();
  await video.play();
  drawFrame();
  loop();

  await new Promise<void>((resolve) => {
    video.onended = () => resolve();
    const capMs = (Number.isFinite(video.duration) ? video.duration : 12) * 1000 + 3000;
    setTimeout(resolve, capMs);
  });

  cancelAnimationFrame(raf);
  if (recorder.state !== 'inactive') recorder.stop();
  const blob = await finished;
  if (!blob.size) return null;
  return { blob, ext: extFor(mime) };
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

async function deliver(blob: Blob, filename: string): Promise<void> {
  // In the Flutter native shell, hand the rendered file to the app so it can
  // save straight to the camera roll (Photos). Requires the Flutter side to
  // register a `saveMedia` handler; until then callHandler resolves null and
  // we fall through to the web share/download path. Web can't write to Photos
  // directly, and the navigator.share trick below is unreliable because the
  // watermark render consumes the originating user gesture.
  try {
    const inShell = typeof document !== 'undefined'
      && document.documentElement.dataset.shell === 'catalog-app';
    const bridge = (window as unknown as {
      flutter_inappwebview?: { callHandler?: (name: string, ...args: unknown[]) => Promise<unknown> };
    }).flutter_inappwebview;
    if (inShell && bridge?.callHandler) {
      const dataUrl = await blobToDataUrl(blob);
      const ok = await bridge.callHandler('saveMedia', { filename, dataUrl, mime: blob.type || 'video/mp4' });
      if (ok) return;
    }
  } catch { /* fall through to web share / download */ }
  try {
    const file = new File([blob], filename, { type: blob.type || 'video/mp4' });
    const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function'
        && nav.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file] });
      return;
    }
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') return;
  }
  triggerDownload(blob, filename);
}

/**
 * Download (or share-to-camera-roll) a look video with one of three creative
 * overlays (logo / products / story). Falls back to the untouched original
 * when client-side encoding isn't available.
 */
export async function downloadLookVideo(
  videoUrl: string,
  username: string | null | undefined,
  opts: DownloadLookOptions = {},
): Promise<void> {
  const variant = opts.variant ?? 'logo';
  const base = buildLookFilename(username, variant);
  try {
    const result = await watermarkToBlob(videoUrl, opts);
    if (result) {
      await deliver(result.blob, `${base}.${result.ext}`);
      return;
    }
  } catch {
    /* fall through to raw download */
  }
  const res = await fetch(videoUrl);
  const blob = await res.blob();
  triggerDownload(blob, `${base}.mp4`);
}
