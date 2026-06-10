// Client → analyze-look-media edge function. Takes a File (photo or
// video) the user just picked, extracts a JPEG frame (the file itself
// for photos, a canvas snapshot for videos), and POSTs the base64 to
// the edge function which runs Claude Vision and returns a short list
// of detected wearable items.
//
// All work is best-effort: callers should treat failure as "no
// detections" and let the user describe products manually.

import { supabase } from '~/utils/supabase';

export interface DetectedProduct {
  brand: string;
  name: string;
  type: string | null;
  color: string | null;
  notes: string | null;
}

// Max edge of the JPEG we send up — 1024 keeps the body well under
// Claude's 5MB image limit while preserving enough detail to read
// fabric, silhouette, and brand tags.
const MAX_EDGE = 1024;
const JPEG_QUALITY = 0.82;

/** Downscale + JPEG-encode an <img> or <video> source into base64 (no
 *  data: prefix). Returns the base64 string. */
function encodeToJpeg(source: HTMLImageElement | HTMLVideoElement): string {
  const srcW = 'naturalWidth' in source ? source.naturalWidth : source.videoWidth;
  const srcH = 'naturalHeight' in source ? source.naturalHeight : source.videoHeight;
  if (!srcW || !srcH) throw new Error('Source media has no dimensions');
  const scale = Math.min(1, MAX_EDGE / Math.max(srcW, srcH));
  const w = Math.round(srcW * scale);
  const h = Math.round(srcH * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create canvas context');
  ctx.drawImage(source, 0, 0, w, h);
  // toDataURL returns "data:image/jpeg;base64,XXXX" — slice off the
  // prefix; the edge function strips it defensively anyway.
  const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
  return dataUrl.split(',')[1] || '';
}

/** Load a File into an <img> and resolve once decoded. */
function imageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

/** Load a File into a <video>, seek to ~1.5s for a stable frame, and
 *  resolve once that frame has been decoded. */
function videoFrameFromFile(file: File): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.src = url;
    const cleanup = () => { URL.revokeObjectURL(url); };
    const fail = (e: unknown) => { cleanup(); reject(e instanceof Error ? e : new Error(String(e))); };
    v.onloadedmetadata = () => {
      // Pick a non-zero frame so we don't sample a black opener. Cap
      // at duration to keep tiny clips happy.
      const target = Math.min(1.5, Math.max(0.05, (v.duration || 1) * 0.1));
      v.currentTime = target;
    };
    v.onseeked = () => { resolve(v); /* caller will encode then we can revoke */ setTimeout(cleanup, 1000); };
    v.onerror = fail;
  });
}

/** Pull a JPEG base64 frame out of an arbitrary user-picked file. */
export async function fileToBase64Jpeg(file: File): Promise<{ base64: string; mediaType: 'image/jpeg' }> {
  if (file.type.startsWith('video/')) {
    const video = await videoFrameFromFile(file);
    return { base64: encodeToJpeg(video), mediaType: 'image/jpeg' };
  }
  const img = await imageFromFile(file);
  return { base64: encodeToJpeg(img), mediaType: 'image/jpeg' };
}

/** POST the encoded frame to the edge function and return the parsed
 *  products array. Throws on transport or Claude errors so callers can
 *  surface the message; an empty `products` array is a valid "model
 *  saw nothing shoppable" response. */
export async function analyzeLookMedia(file: File): Promise<DetectedProduct[]> {
  if (!supabase) throw new Error('Supabase not configured');
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Not authenticated');

  const { base64, mediaType } = await fileToBase64Jpeg(file);

  const baseUrl = import.meta.env.VITE_SUPABASE_URL || '';
  const apikey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY || '';
  const res = await fetch(`${baseUrl}/functions/v1/analyze-look-media`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
      apikey,
    },
    body: JSON.stringify({ image_base64: base64, media_type: mediaType }),
  });

  const json = (await res.json()) as { products?: DetectedProduct[]; error?: string };
  if (!res.ok) throw new Error(json.error || `analyze-look-media failed (${res.status})`);
  return Array.isArray(json.products) ? json.products : [];
}
