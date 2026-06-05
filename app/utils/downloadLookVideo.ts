// Download a look's video to the device, with the Catalog logo (the actual
// brand wordmark, rasterized from its vector) composited into the upper-left
// corner.
//
// Watermarking is done client-side by replaying the video onto a <canvas>
// (drawing the logo each frame) and re-encoding the canvas stream — plus the
// original audio track — through MediaRecorder. The video host (fal.media)
// serves `access-control-allow-origin: *`, so a crossOrigin video doesn't
// taint the canvas. Where MediaRecorder / canvas.captureStream isn't
// available (or anything throws), we fall back to downloading the original
// file untouched so the user always gets their video.
//
// Delivery: on devices that support sharing files (most phones) we hand the
// finished clip to the native share sheet, which on iOS/Android offers
// "Save Video" → Photos / camera roll. Where file-sharing isn't available
// (most desktops) we fall back to a plain download.

import {
  CATALOG_LOGO_PATH,
  CATALOG_LOGO_VIEWBOX,
  CATALOG_LOGO_ASPECT,
} from '~/constants/brand-logo';

function slug(s: string | null | undefined, fallback: string): string {
  const out = (s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return out || fallback;
}

/** `{username}-catalog-{YYYY-MM-DD}` (no extension). */
export function buildLookFilename(username: string | null | undefined): string {
  const date = new Date().toISOString().slice(0, 10);
  return `${slug(username, 'creator')}-catalog-${date}`;
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke after the click has been handled.
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
// <img> we can drawImage onto each frame. An SVG data URL doesn't taint the
// canvas, so MediaRecorder export keeps working. Cached across calls.
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
    } catch {
      resolve(null);
    }
  });
  return logoImgPromise;
}

// Hand the finished clip to the native share sheet when the platform can
// share files (phones) — that's how iOS/Android expose "Save Video" to the
// camera roll. Falls back to a normal download on desktop or if sharing is
// declined/unsupported. Note: iOS requires share() to run under a user
// gesture; after a long canvas re-encode that activation may have lapsed, in
// which case share throws and we download instead.
async function deliver(blob: Blob, filename: string): Promise<void> {
  try {
    const file = new File([blob], filename, { type: blob.type || 'video/mp4' });
    const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function'
        && nav.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file] });
      return;
    }
  } catch (err) {
    // User cancelled the share sheet — respect that, don't also download.
    if ((err as Error)?.name === 'AbortError') return;
    // Otherwise fall through to a plain download.
  }
  triggerDownload(blob, filename);
}

async function watermarkToBlob(videoUrl: string): Promise<{ blob: Blob; ext: string } | null> {
  if (!canEncode()) return null;

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

  const stream = canvas.captureStream(30);
  // Mux the original audio track in so the download isn't silent.
  try {
    const v = video as HTMLVideoElement & {
      captureStream?: () => MediaStream;
      mozCaptureStream?: () => MediaStream;
    };
    const vStream = v.captureStream?.() ?? v.mozCaptureStream?.();
    const audio = vStream?.getAudioTracks?.()[0];
    if (audio) stream.addTrack(audio);
  } catch { /* no audio track available — silent export */ }

  const mime = pickMime();
  const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  const finished = new Promise<Blob>((resolve) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: mime }));
  });

  const logo = await loadLogoImage();
  const pad = Math.round(w * 0.04);
  // Logo sized to ~20% of frame width; height derives from the wordmark's
  // own aspect ratio so it never distorts.
  const logoW = Math.round(w * 0.20);
  const logoH = Math.round(logoW * CATALOG_LOGO_ASPECT);
  const drawFrame = () => {
    ctx.drawImage(video, 0, 0, w, h);
    if (!logo) return;
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
    ctx.shadowBlur = logoH * 0.45;
    ctx.shadowOffsetY = 2;
    ctx.globalAlpha = 0.95;
    ctx.drawImage(logo, pad, pad, logoW, logoH);
    ctx.restore();
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
    // Safety cap: never hang longer than the clip + a margin.
    const capMs = (Number.isFinite(video.duration) ? video.duration : 12) * 1000 + 3000;
    setTimeout(resolve, capMs);
  });

  cancelAnimationFrame(raf);
  if (recorder.state !== 'inactive') recorder.stop();
  const blob = await finished;
  if (!blob.size) return null;
  return { blob, ext: extFor(mime) };
}

/**
 * Download (or share-to-camera-roll) a look video named
 * `{username}-catalog-{date}.<ext>`, watermarked with the Catalog logo when
 * the browser supports client-side encoding; otherwise the original file is
 * delivered untouched. On phones the native share sheet is offered first so
 * the clip can be saved straight to Photos / camera roll.
 */
export async function downloadLookVideo(
  videoUrl: string,
  username: string | null | undefined,
): Promise<void> {
  const base = buildLookFilename(username);
  try {
    const result = await watermarkToBlob(videoUrl);
    if (result) {
      await deliver(result.blob, `${base}.${result.ext}`);
      return;
    }
  } catch {
    /* fall through to raw download */
  }
  // Fallback — original mp4, no watermark, but the user still gets the file.
  const res = await fetch(videoUrl);
  const blob = await res.blob();
  triggerDownload(blob, `${base}.mp4`);
}
