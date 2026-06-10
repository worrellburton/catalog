// Public share page: /s/<slug>
//
// Anyone with the slug — signed in or not — gets a focused single-look
// view: the watermarked video, a "made with Catalog" footer, and a CTA
// to come make their own. RLS on look_shares allows anon select by slug
// (the slug is the access token), so this works without a session.

import { useEffect, useState } from 'react';
import { useParams, Link } from '@remix-run/react';
import {
  getLookShareBySlug,
  type LookShare,
} from '~/services/look-shares';
import { getGeneration } from '~/services/user-generations';
import type { UserGeneration } from '~/services/user-generations';
import '~/styles/share-page.css';

export default function SharePage() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug ?? '';
  const [share, setShare] = useState<LookShare | null | 'missing'>(null);
  const [generation, setGeneration] = useState<UserGeneration | null>(null);

  // Fetch the share row + the underlying generation so we can fall
  // back to the un-watermarked URL while Modal is still rendering.
  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    getLookShareBySlug(slug).then(async (s) => {
      if (cancelled) return;
      if (!s) { setShare('missing'); return; }
      setShare(s);
      const g = await getGeneration(s.generation_id);
      if (!cancelled) setGeneration(g);
    });
    return () => { cancelled = true; };
  }, [slug]);

  // Poll while the watermark is rendering. Stops the moment we land
  // on a terminal status, so a finished share goes idle.
  useEffect(() => {
    if (!share || share === 'missing') return;
    if (share.status === 'done' || share.status === 'failed') return;
    const tick = window.setInterval(async () => {
      const fresh = await getLookShareBySlug(slug);
      if (fresh) setShare(fresh);
    }, 3000);
    return () => window.clearInterval(tick);
  }, [share, slug]);

  if (share === 'missing') {
    return (
      <div className="share-page share-page--empty">
        <div className="share-page-card">
          <h1>Look not found</h1>
          <p>This share link is invalid or was removed.</p>
          <Link to="/" className="share-page-cta">Make your own look →</Link>
        </div>
      </div>
    );
  }

  if (share === null) {
    return (
      <div className="share-page share-page--loading">
        <div className="share-page-spinner" aria-label="Loading" />
      </div>
    );
  }

  // Prefer the watermarked render once it lands; otherwise show the
  // raw generation video so visitors aren't staring at a spinner
  // forever if Modal is slow.
  const videoUrl = share.watermarked_video_url || generation?.video_url || '';
  const isStillRendering = share.status === 'pending' || share.status === 'rendering';

  return (
    <div className="share-page">
      <div className="share-page-stage">
        {videoUrl ? (
          <video
            className="share-page-video"
            src={videoUrl}
            autoPlay
            loop
            muted
            playsInline
            controls
          />
        ) : (
          <div className="share-page-spinner" aria-label="Loading video" />
        )}

        {isStillRendering && (
          <div className="share-page-rendering" aria-live="polite">
            Watermarking… your full-quality version will appear here in a moment.
          </div>
        )}
      </div>

      <div className="share-page-foot">
        <span className="share-page-mark">Made with Catalog</span>
        <Link to="/" className="share-page-cta">
          Make your own look
        </Link>
      </div>
    </div>
  );
}
