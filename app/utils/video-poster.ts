import { supabase } from './supabase';

const POSTER_QUALITY = 0.75;
const MAX_WIDTH = 720;
const SEEK_TIME = 0.1;

export async function extractPosterBlob(videoUrl: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.muted = true;
    video.defaultMuted = true;
    video.preload = 'auto';
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    // iOS will not run the decoder for a <video> that is not in the document,
    // so a detached element never reaches loadeddata and every extraction here
    // timed out silently — which is why looks_creative.thumbnail_url is null on
    // effectively every row. Parked offscreen rather than hidden: display:none
    // and visibility:hidden stop the decoder just as surely as being detached.
    video.style.cssText =
      'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
    document.body.appendChild(video);

    const cleanup = () => {
      video.removeAttribute('src');
      video.load();
      video.remove();
    };

    const onSeeked = () => {
      try {
        const sw = video.videoWidth;
        const sh = video.videoHeight;
        if (!sw || !sh) { cleanup(); reject(new Error('zero-size video')); return; }
        const scale = sw > MAX_WIDTH ? MAX_WIDTH / sw : 1;
        const w = Math.round(sw * scale);
        const h = Math.round(sh * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(video, 0, 0, w, h);
        canvas.toBlob(
          (blob) => { cleanup(); blob ? resolve(blob) : reject(new Error('toBlob returned null')); },
          'image/jpeg',
          POSTER_QUALITY,
        );
      } catch (e) { cleanup(); reject(e); }
    };

    const onError = () => { cleanup(); reject(new Error(`video load failed: ${videoUrl}`)); };
    const timeout = setTimeout(() => { cleanup(); reject(new Error('poster extraction timed out')); }, 15_000);

    video.addEventListener('seeked', () => { clearTimeout(timeout); onSeeked(); }, { once: true });
    video.addEventListener('error', () => { clearTimeout(timeout); onError(); }, { once: true });

    // Muted inline playback is what actually gets a frame decoded on iOS; the
    // seek alone is not enough from a cold element. Pause again as soon as
    // there is data — this only ever needs one frame.
    video.addEventListener('loadedmetadata', () => {
      void video.play().catch(() => {});
    }, { once: true });

    video.addEventListener('loadeddata', () => {
      video.pause();
      video.currentTime = Math.min(SEEK_TIME, video.duration || SEEK_TIME);
    }, { once: true });

    video.src = videoUrl;
  });
}

export async function uploadPoster(
  lookId: string,
  blob: Blob,
): Promise<string | null> {
  if (!supabase) return null;
  // The look-media INSERT policy is `(storage.foldername(name))[1] =
  // auth.uid()`, so the uploader's own id HAS to be the first path segment —
  // the old `looks/<lookId>/poster.jpg` key put the literal string "looks"
  // there and every upload was denied, which is why no look in the catalogue
  // has a stored poster. Same shape addMediaToLook() already uses for the
  // trimmer's poster. The id has to come from the session rather than from the
  // look's creator: an admin publishing someone else's generation is the
  // uploader, and RLS checks who is calling, not who the look belongs to.
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth?.user?.id;
  if (!uid) { console.warn('[poster] upload skipped: not signed in'); return null; }
  const key = `${uid}/${lookId}/poster.jpg`;
  const { error } = await supabase.storage
    .from('look-media')
    .upload(key, blob, { contentType: 'image/jpeg', upsert: true });
  if (error) { console.warn('[poster] upload failed:', error.message); return null; }
  const { data } = supabase.storage.from('look-media').getPublicUrl(key);
  return data?.publicUrl ?? null;
}

export async function generateAndStorePoster(
  lookId: string,
  creativeId: string,
  videoUrl: string,
): Promise<string | null> {
  try {
    const blob = await extractPosterBlob(videoUrl);
    const publicUrl = await uploadPoster(lookId, blob);
    if (publicUrl && supabase) {
      await supabase
        .from('looks_creative')
        .update({ thumbnail_url: publicUrl })
        .eq('id', creativeId);
    }
    return publicUrl;
  } catch (e) {
    console.warn('[poster] generation failed:', e);
    return null;
  }
}
