// The splash concept catalogue. One entry per motion concept; the admin
// picker and the consumer host both resolve variants through here.

import type { SplashVariantId } from '~/services/splash-config';
import type { SplashVariantMeta } from './types';
import CascadeGrid from './variants/CascadeGrid';
import SphereSwarm from './variants/SphereSwarm';
import SpiralVortex from './variants/SpiralVortex';
import Constellation from './variants/Constellation';
import LiquidChrome from './variants/LiquidChrome';
import MosaicReveal from './variants/MosaicReveal';

export const SPLASH_REGISTRY: SplashVariantMeta[] = [
  {
    id: 'cascade',
    name: 'Cascade to Grid',
    tagline: 'Products tumble in from 3D space and snap into the feed grid.',
    tech: 'CSS 3D',
    poster: ['#1e293b', '#0f172a'],
    Component: CascadeGrid,
  },
  {
    id: 'sphere',
    name: 'Sphere Swarm',
    tagline: 'A slowly rotating globe of products that blooms open into the feed.',
    tech: 'CSS 3D',
    poster: ['#312e81', '#0b1020'],
    Component: SphereSwarm,
  },
  {
    id: 'vortex',
    name: 'Spiral Vortex',
    tagline: 'Products spiral inward through a funnel and resolve on the logo.',
    tech: 'CSS 3D',
    poster: ['#4c1d95', '#0a0a0f'],
    Component: SpiralVortex,
  },
  {
    id: 'constellation',
    name: 'Constellation',
    tagline: 'Products drift as nodes linked by live threads, then converge.',
    tech: 'Canvas 2D',
    poster: ['#0b3a53', '#05080f'],
    Component: Constellation,
  },
  {
    id: 'liquid',
    name: 'Liquid Chrome',
    tagline: 'A flowing molten-metal shader resolves behind the wordmark.',
    tech: 'WebGL',
    poster: ['#475569', '#0b0d10'],
    Component: LiquidChrome,
  },
  {
    id: 'mosaic',
    name: 'Mosaic Reveal',
    tagline: 'A full-bleed tile wall flips alive, then peels back to the feed.',
    tech: 'CSS 3D',
    poster: ['#7c2d12', '#0a0a0a'],
    Component: MosaicReveal,
  },
];

const BY_ID = new Map(SPLASH_REGISTRY.map(v => [v.id, v]));

export function getVariant(id: SplashVariantId): SplashVariantMeta | undefined {
  return BY_ID.get(id);
}
