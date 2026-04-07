import type { Look } from '~/data/looks';

function colorDistance(hex1: string, hex2: string): number {
  const r1 = parseInt(hex1.slice(1, 3), 16);
  const g1 = parseInt(hex1.slice(3, 5), 16);
  const b1 = parseInt(hex1.slice(5, 7), 16);
  const r2 = parseInt(hex2.slice(1, 3), 16);
  const g2 = parseInt(hex2.slice(3, 5), 16);
  const b2 = parseInt(hex2.slice(5, 7), 16);
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2) / 441.67;
}

function similarityScore(a: Look, b: Look): number {
  let score = 0;
  if (a.gender === b.gender) score += 3;
  if (a.creator === b.creator) score += 2;
  score += (1 - colorDistance(a.color, b.color)) * 2;
  const aBrands = new Set(a.products.map(p => p.brand));
  score += b.products.filter(p => aBrands.has(p.brand)).length;
  return score;
}

export function getSimilarLooks(
  sourceLook: Look,
  allLooks: Look[],
  count = 8,
  exclude?: Set<number>,
): Look[] {
  return allLooks
    .filter(l => l.id !== sourceLook.id && !(exclude?.has(l.id)))
    .map(l => ({ look: l, score: similarityScore(sourceLook, l) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, count)
    .map(x => x.look);
}
