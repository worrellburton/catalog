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
import type { ReactNode } from 'react';
import '~/styles/beam-hosts.css';

/** Subset of the package's size presets we actually use. */
export type BeamSize = 'sm' | 'md' | 'pulse-inner' | 'pulse-outside';

export default function Beam({
  children,
  size = 'md',
  strength = 0.7,
  active = true,
  theme = 'dark',
  className,
  borderRadius,
}: {
  children: ReactNode;
  /** 'sm' for buttons/inputs, 'md' for cards, 'pulse-*' for a non-travelling glow. */
  size?: BeamSize;
  /**
   * 0–1 master opacity (the package's own `strength`). 0.7 is the app baseline
   * — the border-beam documentation's recommended setting. We render the
   * package's beam untouched; tune intensity here, not with custom overrides.
   */
  strength?: number;
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
  // Render the package beam untouched — className is layout-only (the per-call-
  // site shims in beam-hosts.css that box the wrapper to its child). No colour
  // override, no opacity boost: the look is the package's own, tuned via props.
  return (
    <BorderBeam
      size={size}
      colorVariant="colorful"
      strength={strength}
      active={active}
      theme={theme}
      className={className}
      borderRadius={borderRadius}
    >
      {children}
    </BorderBeam>
  );
}
