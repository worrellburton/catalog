// Mutable singleton config — any consumer can dial up the live particle
// speed (e.g. SearchCeremony bumps it to 3.5 for the "searching the world"
// feel and restores it to 1 on cleanup). The single ParticleBackground
// canvas mounted at the app root reads this on every frame, so changing
// the value retunes the existing canvas without remounting or losing the
// particle field's continuity.
export const particleControls = {
  speed: 1,
  /** When true, the site singleton ParticleBackground skips its GL draw
   *  (the feed is covering it, so painting is wasted GPU). One-off mounts
   *  that pass an explicit `speed` (search ceremony) ignore this and always
   *  render. Set from _index based on heroMode / heroScrolled. */
  paused: false,
};
