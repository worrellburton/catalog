// Mutable singleton config — any consumer can dial up the live particle
// speed (e.g. SearchCeremony bumps it to 3.5 for the "searching the world"
// feel and restores it to 1 on cleanup). The single ParticleBackground
// canvas mounted at the app root reads this on every frame, so changing
// the value retunes the existing canvas without remounting or losing the
// particle field's continuity.

type PausedListener = () => void;
const pausedListeners = new Set<PausedListener>();

export const particleControls = {
  speed: 1,
  _paused: false,
  /** When true, the site singleton ParticleBackground STOPS its rAF loop
   *  (the feed is covering it, so painting is wasted GPU AND the loop itself
   *  is wasted CPU). One-off mounts that pass an explicit `speed` (search
   *  ceremony) ignore this and always render. Set from _index based on
   *  heroMode / heroScrolled. Implemented as an accessor so flipping it back
   *  to false can wake the stopped loop (see onPausedChange). */
  get paused(): boolean {
    return this._paused;
  },
  set paused(v: boolean) {
    if (this._paused === v) return;
    this._paused = v;
    pausedListeners.forEach(l => { try { l(); } catch { /* ignore */ } });
  },
  /** Subscribe to paused-state transitions. ParticleBackground uses this to
   *  restart its loop when it un-pauses, instead of spinning a no-op rAF the
   *  whole time it's paused. Returns an unsubscribe fn. */
  onPausedChange(l: PausedListener): () => void {
    pausedListeners.add(l);
    return () => { pausedListeners.delete(l); };
  },
};
