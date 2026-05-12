import { catalogNames } from '~/data/catalogNames';

// Map individual search words to catalogNames keys so queries like
// "first date fit", "gym fits", or "cozy fall vibes" land on themed names.
const KEYWORD_ALIASES: Record<string, string> = {
  date: 'datenight', dating: 'datenight', romantic: 'datenight', night: 'datenight',
  hot: 'datenight', rizz: 'datenight', first: 'datenight',
  gym: 'workout', workout: 'workout', fitness: 'workout', yoga: 'workout',
  run: 'workout', running: 'workout', pilates: 'workout', sweat: 'workout',
  brunch: 'brunch', mimosa: 'brunch', sunday: 'brunch',
  wedding: 'wedding', bridal: 'wedding',
  festival: 'festival', concert: 'festival', coachella: 'festival',
  office: 'office', work: 'office', business: 'office', corporate: 'office',
  street: 'streetwear', streetwear: 'streetwear', hype: 'streetwear',
  sneaker: 'streetwear', sneakers: 'streetwear', drop: 'streetwear',
  minimal: 'minimalist', minimalist: 'minimalist', clean: 'minimalist',
  capsule: 'minimalist',
  vintage: 'vintage', retro: 'vintage', thrift: 'vintage', y2k: 'vintage',
  boho: 'boho', bohemian: 'boho', hippie: 'boho',
  luxury: 'luxury', rich: 'luxury', designer: 'luxury', quiet: 'luxury',
  old: 'luxury', money: 'luxury',
  formal: 'formal', gala: 'formal', black: 'formal', tie: 'formal',
  cheap: 'budget', budget: 'budget', broke: 'budget', affordable: 'budget',
  bed: 'bedroom', bedroom: 'bedroom', cozy: 'bedroom', sleep: 'bedroom',
  kitchen: 'kitchen', cooking: 'kitchen', chef: 'kitchen',
  bath: 'bathroom', bathroom: 'bathroom', shower: 'bathroom', spa: 'bathroom',
  home: 'homedecor', decor: 'homedecor', apartment: 'homedecor',
  cat: 'cats', cats: 'cats', kitten: 'cats',
  dog: 'dogs', dogs: 'dogs', puppy: 'dogs',
  wellness: 'wellness', matcha: 'wellness', skincare: 'wellness',
  self: 'wellness', glow: 'wellness',
  outfit: 'fashion', fit: 'fashion', fits: 'fashion', drip: 'fashion',
  dress: 'fashion', dresses: 'fashion', pants: 'fashion', shoes: 'fashion',
  airport: 'fashion', travel: 'fashion', beach: 'fashion', summer: 'fashion',
  winter: 'fashion', spring: 'fashion', fall: 'fashion',
  nyc: 'nyc', brooklyn: 'nyc', manhattan: 'nyc',
  la: 'la', hollywood: 'la', calabasas: 'la',
  paris: 'paris', french: 'paris',
  tokyo: 'tokyo', japan: 'tokyo', harajuku: 'tokyo',
  athleisure: 'athleisure',
  dopamine: 'maximalist', maximalist: 'maximalist',
  cottagecore: 'cottagecore', mushroom: 'cottagecore',
  scandi: 'scandi', hygge: 'scandi', neutral: 'scandi',
  industrial: 'industrial', loft: 'industrial',
  midcentury: 'midcentury',
  electronics: 'electronics', tech: 'electronics', gadget: 'electronics',
  girly: 'women', girl: 'women', girls: 'women',
  mens: 'men', guys: 'men', guy: 'men',
};

// Title-case the user's literal search so it reads as a proper catalog
// name beneath the logo. Short single tokens are kept uppercase so
// "omg" → "OMG", but longer words use Title Case.
export function toCatalogName(query: string): string {
  return query
    .trim()
    .split(/\s+/)
    .map(w => (w.length <= 3 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1).toLowerCase()))
    .join(' ');
}

export function getRandomCatalogName(query?: string): string {
  if (query && query.trim()) {
    const q = query.toLowerCase().trim();
    const words = q.split(/\s+/).filter(w => w.length > 1);

    // Collect candidate keys from alias + direct matches
    const matched = new Set<string>();
    for (const w of words) {
      const alias = KEYWORD_ALIASES[w];
      if (alias && catalogNames[alias]) matched.add(alias);
    }
    // Direct key lookup (covers combo keys like 'fashion+la')
    for (const key of Object.keys(catalogNames)) {
      const parts = key.split('+');
      const allPartsMatched = parts.every(part =>
        words.some(w => w === part || w.includes(part) || part.includes(w))
      );
      if (allPartsMatched) matched.add(key);
    }

    if (matched.size > 0) {
      // Prefer combo keys (more specific) over single keys
      const sorted = [...matched].sort((a, b) => b.split('+').length - a.split('+').length);
      const names = catalogNames[sorted[0]];
      if (names && names.length > 0) {
        return names[Math.floor(Math.random() * names.length)];
      }
    }

    // No match - fall back to generic fashion names instead of random unrelated theme
    const fashion = catalogNames.fashion;
    return fashion[Math.floor(Math.random() * fashion.length)];
  }
  const allNames = Object.values(catalogNames).flat();
  return allNames[Math.floor(Math.random() * allNames.length)];
}
