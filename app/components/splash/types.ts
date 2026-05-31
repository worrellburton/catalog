// Shared contract for every splash concept.
//
// A variant is a pure background-motion component. The SplashHost owns
// everything cross-cutting — image loading, the assemble→reveal→exit
// phase clock, the CATALOG wordmark overlay, the exit cross-fade, and
// onDone — so each concept only has to render its motion against the
// supplied images + phase.

import type { ComponentType } from 'react';
import type { SplashVariantId } from '~/services/splash-config';

export type SplashPhase = 'assemble' | 'reveal' | 'exit';

/** A real product clip from the feed, paired with a clean still to use as
 *  the poster so the tile shows the product image until the video buffers
 *  (it never flashes black on a cold open). */
export interface SplashVideo {
  src: string;
  poster: string;
}

export interface SplashVariantProps {
  /** Clean product-photo URLs from the live home feed (brand CDN packshots
   *  preferred over AI/video stills). May be empty on a cold cache — the
   *  host renders a logo-only fallback when there are zero images. */
  images: string[];
  /** A small capped set of real product video clips (with poster stills).
   *  Variants may render a few of these as live tiles; optional so a
   *  variant can ignore them. */
  videos?: SplashVideo[];
  /** Current act of the animation. */
  phase: SplashPhase;
  /** Total run time in ms — variants scale their internal timing to it. */
  durationMs: number;
  /** True when the device prefers reduced motion (variants should calm
   *  down or no-op; the host already renders a fallback in this case). */
  reduced: boolean;
  /** Bumps to force a fresh replay (used by the admin preview). */
  replayKey: number;
}

export interface SplashVariantMeta {
  id: SplashVariantId;
  /** Display name in the admin picker. */
  name: string;
  /** One-line description of the motion. */
  tagline: string;
  /** Rendering tech, surfaced as a chip in the picker. */
  tech: 'CSS 3D' | 'Canvas 2D' | 'WebGL';
  /** Two CSS colors used to paint the card's ambient poster gradient. */
  poster: [string, string];
  Component: ComponentType<SplashVariantProps>;
}
