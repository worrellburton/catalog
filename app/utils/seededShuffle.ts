// Tiny seeded PRNG (Mulberry32) + Fisher–Yates shuffle.
//
// Why we need a seeded shuffle in the consumer feed:
// FeedSection and GridView's pool memos used Math.random(), so the same
// useMemo with the same dep values would produce a different array every
// time. That defeats React's referential-equality optimizations — the
// pool's identity changes, so every downstream consumer (memoized cards,
// derived layouts) re-renders even when nothing semantically changed.
//
// With a seeded PRNG, shuffleKey + filteredLooks.length deterministically
// produce the same shuffle, so memos stay stable across re-renders that
// happen for unrelated reasons.

export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return function rng() {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededShuffle<T>(arr: readonly T[], seed: number): T[] {
  const rng = mulberry32(seed);
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Cheap string→int hash (djb2). Used to derive a numeric seed from a
// composite of the inputs that should produce a stable shuffle.
export function hashSeed(...parts: Array<string | number>): number {
  let h = 5381;
  for (const part of parts) {
    const s = String(part);
    for (let i = 0; i < s.length; i++) {
      h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    }
  }
  return h >>> 0;
}
