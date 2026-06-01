// Site-wide particle host — mounts one ParticleBackground canvas at the
// app root level so splash → landing → search ceremony → empty-catalog
// all see the SAME continuous AI-diamond field. The host stays mounted
// for the life of the app session; consumers retune speed by setting
// `particleControls.speed` (services/particles.ts).

import { memo } from 'react';
import ParticleBackground from './ParticleBackground';

export default memo(function SiteParticleHost() {
  return (
    <div className="site-particle-host" aria-hidden="true">
      <ParticleBackground />
    </div>
  );
});
