// imports
import type { MediaCompletion } from '~/utils/product-health';

// types
interface MediaCompletionMeterProps {
  media: MediaCompletion;
}

// constants
const STEPS: Array<{ key: 'polished' | 'poster' | 'video'; label: string }> = [
  { key: 'polished', label: 'Polished image' },
  { key: 'poster', label: 'Poster' },
  { key: 'video', label: 'Video' },
];

// main logic
/** Three-segment meter under the media thumbs: polished image · poster ·
 *  video. Filled segments take the row's completion colour (green 3/3,
 *  amber 1–2, red 0). */
export default function MediaCompletionMeter({ media }: MediaCompletionMeterProps) {
  const title = STEPS.map(s => `${media[s.key] ? '✓' : '✗'} ${s.label}`).join('  ·  ');
  return (
    <div className={`admin-media-meter is-${media.level}`} title={`Media ${media.done}/3 — ${title}`} aria-label={`Media ${media.done} of 3 complete`}>
      {STEPS.map(s => <span key={s.key} className={`admin-media-meter-seg${media[s.key] ? ' is-done' : ''}`} />)}
      <span className="admin-media-meter-count">{media.done}/3</span>
    </div>
  );
}
