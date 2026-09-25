// imports
import { useState } from 'react';
import type { AdminProduct, MediaStep } from '~/services/admin-product';
import type { MediaCompletion } from '~/utils/product-health';

// types
interface ProductPageMediaProps {
  product: AdminProduct;
  media: MediaCompletion;
  step: MediaStep | null;
  onGenerate: (mode: 'image' | 'video') => void;
}

type Slot = 'video' | 'image' | 'poster';

// constants
const STEP_LABEL: Record<MediaStep, string> = {
  pick: 'Picking the best photo…',
  polish: 'Polishing the primary image…',
  video: 'Sending the video to render…',
};

// main logic
/** Hero media (switchable between video, primary image and poster), the
 *  media checklist with the Generate actions, and the full photo gallery. */
export default function ProductPageMedia({ product, media, step, onGenerate }: ProductPageMediaProps) {
  const primary = product.primary_image_url || product.image_url;
  const [slot, setSlot] = useState<Slot>(product.primary_video_url ? 'video' : 'image');
  const rendering = product.primary_video_status === 'pending';
  const busy = !!step || rendering;

  const slots: Array<{ key: Slot; label: string; done: boolean; available: boolean }> = [
    { key: 'image', label: media.polished ? 'Polished image' : 'Image (not polished)', done: media.polished, available: !!primary },
    { key: 'poster', label: 'Poster', done: media.poster, available: !!product.primary_video_poster_url },
    { key: 'video', label: 'Video', done: media.video, available: !!product.primary_video_url },
  ];

  return (
    <div className="admin-pp-media">
      <div className="admin-pp-hero">
        {slot === 'video' && product.primary_video_url ? (
          <video key={product.primary_video_url} src={product.primary_video_url} poster={product.primary_video_poster_url || primary || undefined} autoPlay muted loop playsInline controls />
        ) : slot === 'poster' && product.primary_video_poster_url ? (
          <img src={product.primary_video_poster_url} alt="Primary poster" />
        ) : primary ? (
          <img src={primary} alt={product.name || 'Product'} />
        ) : (
          <span className="admin-pp-hero-empty">No image yet</span>
        )}
        {busy && <span className="admin-pp-hero-busy">{step ? STEP_LABEL[step] : 'Rendering the video…'}</span>}
      </div>

      <div className="admin-pp-slots" role="tablist" aria-label="Media">
        {slots.map(s => (
          <button
            key={s.key}
            type="button"
            role="tab"
            aria-selected={slot === s.key}
            className={`admin-pp-slot${slot === s.key ? ' is-active' : ''}${s.done ? ' is-done' : ''}`}
            onClick={() => setSlot(s.key)}
            disabled={!s.available}
          >
            <i aria-hidden="true" />{s.label}
          </button>
        ))}
      </div>

      <div className="admin-pp-generate">
        <button type="button" onClick={() => onGenerate('image')} disabled={busy}>
          {media.polished ? 'Regenerate image' : 'Generate image'}
        </button>
        <button type="button" className="is-primary" onClick={() => onGenerate('video')} disabled={busy}>
          {media.video ? 'Regenerate video' : 'Generate video'}
        </button>
      </div>

      {product.images.length > 0 && (
        <div className="admin-pp-gallery">
          {product.images.map(src => (
            <a key={src} href={src} target="_blank" rel="noopener noreferrer" className={src === product.primary_image_url ? 'is-primary' : ''}>
              <img src={src} alt="" loading="lazy" />
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
