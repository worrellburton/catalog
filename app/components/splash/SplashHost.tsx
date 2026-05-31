// SplashHost — drives any splash concept.
//
// Owns the cross-cutting concerns so each variant stays tiny:
//   • image loading (useSplashImages)
//   • the assemble → reveal → exit phase clock
//   • the CATALOG wordmark overlay (fades in at reveal)
//   • the exit cross-fade + onDone callback
//   • reduced-motion / cold-cache fallback (logo-only)
//
// Variants render full-bleed behind the logo. Performance: the host adds
// nothing per-frame; all motion is the variant's own (CSS/Canvas/WebGL).

import { useEffect, useRef, useState } from 'react';
import CatalogLogo from '../CatalogLogo';
import { useSplashImages } from './useSplashImages';
import { getVariant } from './registry';
import type { SplashPhase } from './types';
import type { SplashVariantId } from '~/services/splash-config';

interface SplashHostProps {
  variant: SplashVariantId;
  durationMs?: number;
  onDone?: () => void;
  /** Preview mode: stays mounted (no auto-exit / onDone), replays on key. */
  preview?: boolean;
  replayKey?: number;
}

const EXIT_FADE_MS = 440;

export default function SplashHost({
  variant,
  durationMs = 2500,
  onDone,
  preview = false,
  replayKey = 0,
}: SplashHostProps) {
  const images = useSplashImages();
  const [phase, setPhase] = useState<SplashPhase>('assemble');
  const doneRef = useRef(false);

  const reduced = typeof window !== 'undefined'
    && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  useEffect(() => {
    doneRef.current = false;
    setPhase('assemble');
    const revealAt = Math.max(700, durationMs * 0.5);
    const exitAt = Math.max(revealAt + 300, durationMs - EXIT_FADE_MS);
    const t1 = window.setTimeout(() => setPhase('reveal'), revealAt);
    const t2 = window.setTimeout(() => setPhase('exit'), exitAt);
    const t3 = window.setTimeout(() => {
      if (preview || doneRef.current) return;
      doneRef.current = true;
      onDone?.();
    }, durationMs + EXIT_FADE_MS);
    return () => { window.clearTimeout(t1); window.clearTimeout(t2); window.clearTimeout(t3); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [durationMs, replayKey, variant]);

  const meta = getVariant(variant);
  const VariantComponent = meta?.Component;

  // Fallback: reduced motion, cold image cache, or an unknown variant id.
  if (reduced || images.length === 0 || !VariantComponent) {
    return (
      <div className={`splash-host splash-simple ${phase === 'exit' ? 'sh-exit' : ''}`} aria-hidden="true">
        <CatalogLogo className="sh-logo" />
      </div>
    );
  }

  return (
    <div
      className={`splash-host ${phase === 'exit' ? 'sh-exit' : ''}`}
      data-variant={variant}
      data-phase={phase}
      aria-hidden="true"
    >
      <VariantComponent
        images={images}
        phase={phase}
        durationMs={durationMs}
        reduced={reduced}
        replayKey={replayKey}
      />
      <div className={`sh-logo-wrap ${phase !== 'assemble' ? 'sh-logo-in' : ''}`}>
        <CatalogLogo className="sh-logo" />
      </div>
    </div>
  );
}
