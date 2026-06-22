// Heuristic product tagging for the admin Data → Products surface. Extracted
// verbatim from app/routes/admin/data.tsx (god-file split #8): pure logic, no
// React. deriveTags(name, brand) reads a product's name for color / material /
// type keywords and returns a deduped tag list (type, "Color Type" combo,
// individual colors, materials, and the brand).

const COLOR_WORDS = ['white', 'black', 'blue', 'navy', 'red', 'green', 'yellow', 'pink', 'purple', 'gray', 'grey', 'brown', 'tan', 'beige', 'cream', 'gold', 'silver', 'orange', 'khaki', 'olive', 'charcoal', 'burgundy', 'ivory'];
const MATERIAL_WORDS = ['leather', 'denim', 'cotton', 'silk', 'satin', 'wool', 'cashmere', 'linen', 'suede', 'velvet', 'knit', 'canvas', 'nylon', 'polyester'];
const TYPE_WORDS = [
  { match: ['shoulder bag', 'tote', 'crossbody', 'handbag', 'clutch', 'purse'], tag: 'Bag' },
  { match: ['sunglasses', 'eyewear', 'shades'], tag: 'Sunglasses' },
  { match: ['sneaker', 'trainer'], tag: 'Sneakers' },
  { match: ['shoe', 'boot', 'heel', 'loafer'], tag: 'Shoes' },
  { match: ['iphone case', 'phone case', 'case for'], tag: 'Phone Case' },
  { match: ['necklace', 'pendant'], tag: 'Necklace' },
  { match: ['ring '], tag: 'Ring' },
  { match: ['earring'], tag: 'Earrings' },
  { match: ['bracelet'], tag: 'Bracelet' },
  { match: ['watch'], tag: 'Watch' },
  { match: ['jean', 'denim'], tag: 'Denim' },
  { match: ['pant', 'trouser', 'chino'], tag: 'Pants' },
  { match: ['dress'], tag: 'Dress' },
  { match: ['skirt'], tag: 'Skirt' },
  { match: ['shirt', 't-shirt', 'tee', 'henley', 'polo'], tag: 'Top' },
  { match: ['short-sleeve', 'ss '], tag: 'Short Sleeve' },
  { match: ['long-sleeve', 'ls-', 'ls '], tag: 'Long Sleeve' },
  { match: ['jacket', 'coat', 'parka', 'blazer'], tag: 'Outerwear' },
  { match: ['hat', 'cap', 'beanie'], tag: 'Hat' },
  { match: ['sweater', 'hoodie', 'pullover'], tag: 'Sweater' },
  { match: ['boxer', 'brief', 'underwear'], tag: 'Underwear' },
  { match: ['camera'], tag: 'Camera' },
];

export function deriveTags(name: string, brand: string): string[] {
  const lower = (name || '').toLowerCase();
  const tags = new Set<string>();

  // Type tag
  for (const { match, tag } of TYPE_WORDS) {
    if (match.some(m => lower.includes(m))) {
      tags.add(tag);
    }
  }

  // Color tag
  const colors = COLOR_WORDS.filter(c => new RegExp(`\\b${c}\\b`, 'i').test(lower));

  // Material tag
  const materials = MATERIAL_WORDS.filter(m => lower.includes(m));

  // Combined color + type (e.g. "white hat", "black dress")
  const typeTag = Array.from(tags)[0];
  if (typeTag && colors.length > 0) {
    tags.add(`${colors[0].charAt(0).toUpperCase()}${colors[0].slice(1)} ${typeTag}`);
  }

  // Individual color tags
  colors.forEach(c => tags.add(c.charAt(0).toUpperCase() + c.slice(1)));

  // Material tags
  materials.forEach(m => tags.add(m.charAt(0).toUpperCase() + m.slice(1)));

  // Brand
  if (brand) tags.add(brand);

  return Array.from(tags);
}
