// StyleUp scene presets — the settings a shopper can pick before a full-look
// render. `phrase` is what actually reaches the render prompt (renderLook injects
// "Setting: <phrase>. Place the subject naturally in this environment."), so the
// phrasing is lifted from the autoScene vocab (INTENT_SCENE / OCCASION_SCENE) to
// stay render-friendly. `imageUrl` is a hosted backdrop thumbnail — regenerate
// with agents/scene-backdrops/generate.mjs (object names must match these ids).

export interface ScenePreset {
  id: string;
  label: string;
  phrase: string;
  imageUrl: string;
}

const BASE = 'https://vtarjrnqvcqbhoclvcur.supabase.co/storage/v1/object/public/scene-backdrops';
// Bump when the backdrops are regenerated — the objects are cached long/immutable,
// so a version query is what actually pushes new art to browsers. Only tags the
// thumbnail <img>; the render uses `phrase`, never the URL.
const V = 2;
const img = (id: string) => `${BASE}/${id}.jpg?v=${V}`;

export const SCENE_PRESETS: ScenePreset[] = [
  { id: 'studio', label: 'Clean studio', phrase: 'a clean studio', imageUrl: img('studio') },
  { id: 'restaurant', label: 'Candlelit restaurant', phrase: 'a candlelit restaurant', imageUrl: img('restaurant') },
  { id: 'rooftop', label: 'Rooftop bar', phrase: 'a rooftop bar at night', imageUrl: img('rooftop') },
  { id: 'cafe', label: 'Sunny café', phrase: 'a sunny outdoor café', imageUrl: img('cafe') },
  { id: 'street', label: 'City street', phrase: 'a scenic old-town street', imageUrl: img('street') },
  { id: 'beach', label: 'Beach at golden hour', phrase: 'a sandy beach at golden hour', imageUrl: img('beach') },
  { id: 'office', label: 'Modern office', phrase: 'a bright modern office', imageUrl: img('office') },
  { id: 'park', label: 'Sunny park', phrase: 'a sunny park', imageUrl: img('park') },
];

// Keyword → preset id, for when autoScene returns a rich phrase that isn't a
// verbatim preset ("a warm restaurant at night" → restaurant). First hit wins,
// so the more specific words are listed first.
const KEYWORD_TO_ID: Array<[RegExp, string]> = [
  [/\brooftop\b/, 'rooftop'],
  [/\b(restaurant|dining|dinner)\b/, 'restaurant'],
  [/\b(caf[eé]|coffee|brunch)\b/, 'cafe'],
  [/\b(beach|seaside|boardwalk|shore|ocean)\b/, 'beach'],
  [/\b(office|work|meeting)\b/, 'office'],
  [/\b(park|garden|campus|courtyard)\b/, 'park'],
  [/\b(street|town|city|sidewalk|avenue)\b/, 'street'],
  [/\bstudio\b/, 'studio'],
];

/** Map an autoScene phrase to the preset that should lead + pre-read as chosen.
 *  Exact phrase wins; else a keyword match; else null (caller shows the raw
 *  guess as a leading "Suggested" text card so the shopper's own setting stays
 *  one tap away). */
export function presetForPhrase(phrase: string | null | undefined): ScenePreset | null {
  if (!phrase) return null;
  const p = phrase.toLowerCase().trim();
  const exact = SCENE_PRESETS.find(s => s.phrase.toLowerCase() === p);
  if (exact) return exact;
  for (const [re, id] of KEYWORD_TO_ID) {
    if (re.test(p)) return SCENE_PRESETS.find(s => s.id === id) ?? null;
  }
  return null;
}
