// Beam — the single tuning point for every animated border beam in the app.
//
// Wraps border-beam's <BorderBeam> so the six call sites (home search bar,
// profile cards, my-catalog identity card, the upload dropzone, StyleUp's
// "Find a stylist", and the chat composer) share one set of defaults. When
// someone says "the beam is too much", change it HERE, not at six call sites.
//
// LAYOUT WARNING: BorderBeam renders a wrapper <div> around its children, so
// dropping it into a flex/grid parent inserts a new box into that layout.
// Pass `className` and style the wrapper to take over the child's layout role
// (width, flex, display) wherever that matters — see the call sites.
//
// The package auto-detects the child's border-radius; only pass borderRadius
// when the child's radius comes from a source it can't read.

import { BorderBeam } from 'border-beam';
import type { CSSProperties, ReactNode } from 'react';
import '~/styles/beam-hosts.css';

/** Subset of the package's size presets we actually use. */
export type BeamSize = 'sm' | 'md' | 'pulse-inner' | 'pulse-outside';

export default function Beam({
  children,
  size = 'md',
  strength = 1,
  boost = 2,
  active = true,
  theme = 'dark',
  className,
  borderRadius,
}: {
  children: ReactNode;
  /** 'sm' for buttons/inputs, 'md' for cards, 'pulse-*' for a non-travelling glow. */
  size?: BeamSize;
  /** 0–1 master opacity, and it CAPS at 1 — see `boost` for anything beyond. */
  strength?: number;
  /**
   * Opacity multiplier on the beam's EDGE layers (stroke + bloom), via the
   * package's own --beam-*-opacity vars.
   *
   * Needed because `strength` maxes out at 1 and the package's presets are
   * calibrated for a small card on a flat dark surface. Against Catalog's
   * glass-and-photography backdrops the beam at strength=1 is still only just
   * visible, so 2 is the app's baseline. Raise for more, 1 for the package's
   * untouched defaults.
   *
   * Deliberately does NOT touch --beam-inner-opacity: that layer is an inset
   * glow that paints across the element's INTERIOR, and boosting it washes
   * colour over whatever the card contains (it bled over the profile form
   * fields at 2). Edges get boosted, interiors stay clean.
   */
  boost?: number;
  /** Set false to freeze the beam without unmounting (keeps layout stable). */
  active?: boolean;
  /**
   * Match the SURFACE the beam sits on, not the app theme — the package tunes
   * its glow opacity for the backdrop. Most of the app is dark, but StyleUp
   * renders on a light background, so those call sites pass 'light'. Getting
   * this wrong doesn't break anything, it just washes the beam out.
   */
  theme?: 'dark' | 'light' | 'auto';
  className?: string;
  borderRadius?: number;
}) {
  return (
    <BorderBeam
      size={size}
      colorVariant="colorful"
      strength={strength}
      active={active}
      theme={theme}
      // cat-beam is the hook the fluid-gradient override in beam-hosts.css
      // targets — every call site gets it, the per-site class is for layout.
      className={`cat-beam${className ? ` ${className}` : ''}`}
      borderRadius={borderRadius}
      style={{
        // Custom properties inherit, so setting them on the container reaches
        // the beam's layer elements underneath.
        '--beam-stroke-opacity': String(boost),
        '--beam-bloom-opacity': String(boost),
      } as CSSProperties}
    >
      {children}
    </BorderBeam>
  );
}
