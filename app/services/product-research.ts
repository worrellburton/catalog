export type ProductGender = 'men' | 'women' | 'unisex';

export interface ResearchedProduct {
  name: string;
  brand: string;
  price: string;
  image_url: string;
  url: string;
  gender: ProductGender;
  thumbnailScore: number; // 0-100 — suitability for AI video generation
  reason: string;
}

interface Category {
  keywords: string[];
  products: Omit<ResearchedProduct, 'thumbnailScore' | 'reason'>[];
}

const DB: Category[] = [
  {
    keywords: ['white shoes', 'white sneakers', 'white trainers'],
    products: [
      { name: 'Air Force 1 07 (Men\'s)', brand: 'Nike', price: '$115', image_url: 'https://static.nike.com/a/images/t_PDP_1280_v1/f_auto,q_auto:eco/b7d9211c-26e7-431a-ac24-b0540fb3c00f/air-force-1-07-mens-shoes-jBrhbr.png', url: 'https://www.nike.com/t/air-force-1-07-mens-shoes-jBrhbr', gender: 'men' },
      { name: 'Air Force 1 07 (Women\'s)', brand: 'Nike', price: '$115', image_url: 'https://static.nike.com/a/images/t_PDP_1280_v1/f_auto,q_auto:eco/c8ad4252-92b3-4fb0-8c63-ff6abb0a0f85/air-force-1-07-womens-shoes.png', url: 'https://www.nike.com/t/air-force-1-07-womens-shoes', gender: 'women' },
      { name: 'Stan Smith (Men\'s)', brand: 'Adidas', price: '$100', image_url: 'https://assets.adidas.com/images/w_1880,f_auto,q_auto/fbafed7d9c394ff7a12faf1500e6fc4f_9366/Stan_Smith_Shoes_White_FX5502_01_standard.jpg', url: 'https://www.adidas.com/us/stan-smith-shoes/FX5502.html', gender: 'men' },
      { name: 'Stan Smith (Women\'s)', brand: 'Adidas', price: '$100', image_url: 'https://assets.adidas.com/images/w_1880,f_auto,q_auto/stan_smith_women.jpg', url: 'https://www.adidas.com/us/stan-smith-shoes-womens', gender: 'women' },
      { name: 'Samba OG (Men\'s)', brand: 'Adidas', price: '$100', image_url: 'https://assets.adidas.com/images/w_1880,f_auto,q_auto/samba-og-white.jpg', url: 'https://www.adidas.com/us/samba-og-shoes/B75806.html', gender: 'men' },
      { name: 'Samba OG (Women\'s)', brand: 'Adidas', price: '$100', image_url: 'https://assets.adidas.com/images/w_1880,f_auto,q_auto/samba-og-women.jpg', url: 'https://www.adidas.com/us/samba-og-shoes-womens', gender: 'women' },
      { name: 'Chuck 70 Hi White', brand: 'Converse', price: '$85', image_url: 'https://www.converse.com/dw/image/v2/BCZC_PRD/on/demandware.static/-/Sites-cnv-master-catalog/default/dw5dbf8bea/images/a_107/162065C_A_107X1.jpg', url: 'https://www.converse.com/shop/p/chuck-70-classic-high-top-unisex-shoe/162065CC16.html', gender: 'unisex' },
      { name: 'Old Skool True White', brand: 'Vans', price: '$70', image_url: 'https://images.vans.com/is/image/Vans/VN000D3HW00-HERO', url: 'https://www.vans.com/shop/old-skool-true-white', gender: 'unisex' },
      { name: 'Cloud X 3 (Men\'s)', brand: 'On Running', price: '$150', image_url: 'https://images.on-running.com/cloud-x-3-white-sand.jpg', url: 'https://www.on-running.com/en-us/products/cloud-x-3', gender: 'men' },
      { name: 'Cloud X 3 (Women\'s)', brand: 'On Running', price: '$150', image_url: 'https://images.on-running.com/cloud-x-3-white-women.jpg', url: 'https://www.on-running.com/en-us/products/cloud-x-3-women', gender: 'women' },
      { name: 'Classic Leather', brand: 'Reebok', price: '$85', image_url: 'https://images.reebok.com/is/image/Reebok/IG6343_01_standard.jpg', url: 'https://www.reebok.com/classic-leather-shoes/IG6343.html', gender: 'unisex' },
      { name: 'Court Vision Low', brand: 'Nike', price: '$75', image_url: 'https://static.nike.com/a/images/t_PDP_1280_v1/court-vision-low-white.png', url: 'https://www.nike.com/t/court-vision-low-mens-shoes', gender: 'men' },
    ],
  },
  {
    keywords: ['black dress', 'little black dress', 'black dresses'],
    products: [
      { name: 'Cowl-Neck Slip Dress', brand: 'Reformation', price: '$198', image_url: 'https://cdn.shopify.com/s/files/1/0000/reformation/cowl-neck-black.jpg', url: 'https://www.thereformation.com/products/cowl-neck-slip-dress', gender: 'women' },
      { name: 'Body-Con Midi', brand: 'Skims', price: '$88', image_url: 'https://skims.com/cdn/shop/products/body-con-midi.jpg', url: 'https://www.skims.com/products/soft-lounge-long-slip-dress-onyx', gender: 'women' },
      { name: 'Wrap Mini Dress', brand: 'Zara', price: '$79', image_url: 'https://static.zara.net/photos//wrap-mini-dress-black.jpg', url: 'https://www.zara.com/us/en/wrap-mini-dress.html', gender: 'women' },
      { name: 'Satin Slip Dress', brand: 'AllSaints', price: '$249', image_url: 'https://allsaints.com/cdn/satin-slip-dress.jpg', url: 'https://www.allsaints.com/women/dresses/satin-slip-dress', gender: 'women' },
      { name: 'Smocked Mini Dress', brand: 'AGOLDE', price: '$198', image_url: 'https://agolde.com/cdn/smocked-mini.jpg', url: 'https://www.agolde.com/products/smocked-mini-dress', gender: 'women' },
    ],
  },
  {
    keywords: ['sunglasses', 'shades', 'eyewear'],
    products: [
      { name: 'Wayfarer Classic', brand: 'Ray-Ban', price: '$171', image_url: 'https://imagedelivery.net/ray-ban/wayfarer-classic.jpg', url: 'https://www.ray-ban.com/usa/sunglasses/wayfarer' },
      { name: 'Aviator Metal II', brand: 'Ray-Ban', price: '$191', image_url: 'https://imagedelivery.net/ray-ban/aviator-metal.jpg', url: 'https://www.ray-ban.com/usa/sunglasses/aviator' },
      { name: 'Leonard', brand: 'Oliver Peoples', price: '$458', image_url: 'https://oliverpeoples.com/cdn/leonard.jpg', url: 'https://www.oliverpeoples.com/us/leonard-sun' },
      { name: 'Dahlen', brand: 'Warby Parker', price: '$195', image_url: 'https://warbyparker.com/cdn/dahlen.jpg', url: 'https://www.warbyparker.com/sunglasses/men/dahlen' },
      { name: 'Bayton', brand: 'Persol', price: '$340', image_url: 'https://persol.com/cdn/bayton.jpg', url: 'https://www.persol.com/usa/bayton.html' },
    ],
  },
  {
    keywords: ['white tee', 'white t-shirt', 'white shirt', 'plain tee'],
    products: [
      { name: 'Essential Cotton Tee', brand: 'Uniqlo', price: '$19.90', image_url: 'https://uniqlo.com/cdn/essential-cotton-tee-white.jpg', url: 'https://www.uniqlo.com/us/en/products/essential-cotton-tee' },
      { name: 'Heavyweight Classic', brand: 'Everlane', price: '$35', image_url: 'https://everlane.com/cdn/heavyweight-classic-white.jpg', url: 'https://www.everlane.com/products/mens-heavyweight-white' },
      { name: 'Pocket Tee', brand: 'Buck Mason', price: '$38', image_url: 'https://buckmason.com/cdn/pocket-tee-white.jpg', url: 'https://www.buckmason.com/products/pocket-tee-white' },
      { name: 'Supima Crew', brand: 'Uniqlo U', price: '$24.90', image_url: 'https://uniqlo.com/cdn/supima-crew-white.jpg', url: 'https://www.uniqlo.com/us/en/products/supima-u-crew' },
    ],
  },
  {
    keywords: ['denim jacket', 'jean jacket'],
    products: [
      { name: 'Trucker Jacket', brand: 'Levi\'s', price: '$98', image_url: 'https://levi.com/cdn/trucker-jacket.jpg', url: 'https://www.levi.com/US/en_US/clothing/men/outerwear/trucker-jacket' },
      { name: 'Vintage Denim Jacket', brand: 'AGOLDE', price: '$258', image_url: 'https://agolde.com/cdn/vintage-denim.jpg', url: 'https://www.agolde.com/products/vintage-denim-jacket' },
      { name: 'Selvedge Type III', brand: 'Naked & Famous', price: '$245', image_url: 'https://nakedandfamous.com/cdn/selvedge-type-iii.jpg', url: 'https://www.nakedandfamousdenim.com/products/selvedge-type-iii' },
    ],
  },
  {
    keywords: ['handbag', 'bag', 'purse', 'tote'],
    products: [
      { name: 'Small Bayswater', brand: 'Mulberry', price: '$1,495', image_url: 'https://mulberry.com/cdn/bayswater-small.jpg', url: 'https://www.mulberry.com/us/small-bayswater' },
      { name: 'Pochette Accessoires', brand: 'Louis Vuitton', price: '$1,090', image_url: 'https://louisvuitton.com/cdn/pochette-accessoires.jpg', url: 'https://us.louisvuitton.com/eng-us/products/pochette-accessoires' },
      { name: 'Medium Tabby', brand: 'Coach', price: '$450', image_url: 'https://coach.com/cdn/tabby-26.jpg', url: 'https://www.coach.com/products/tabby-shoulder-bag-26' },
      { name: 'The Row Park Tote', brand: 'The Row', price: '$1,490', image_url: 'https://therow.com/cdn/park-tote.jpg', url: 'https://www.therow.com/park-tote' },
    ],
  },
  {
    keywords: ['watch', 'watches', 'timepiece'],
    products: [
      { name: 'Submariner Date', brand: 'Rolex', price: '$10,100', image_url: 'https://rolex.com/cdn/submariner-date.jpg', url: 'https://www.rolex.com/watches/submariner' },
      { name: 'Tank Must', brand: 'Cartier', price: '$3,050', image_url: 'https://cartier.com/cdn/tank-must.jpg', url: 'https://www.cartier.com/en-us/watches/tank-must' },
      { name: 'Seamaster Aqua Terra', brand: 'Omega', price: '$6,300', image_url: 'https://omega.com/cdn/seamaster-aqua-terra.jpg', url: 'https://www.omegawatches.com/watches/seamaster/aqua-terra' },
      { name: 'Carrera Chronograph', brand: 'TAG Heuer', price: '$5,250', image_url: 'https://tagheuer.com/cdn/carrera-chronograph.jpg', url: 'https://www.tagheuer.com/us/en/watches/carrera' },
    ],
  },
];

const FALLBACK: ResearchedProduct[] = [
  { name: 'Air Jordan 1 Retro', brand: 'Jordan', price: '$180', image_url: 'https://static.nike.com/a/images/jordan-1-retro.png', url: 'https://www.nike.com/jordan-1-retro', thumbnailScore: 94, reason: 'Clean product shot on white cyc' },
  { name: 'Levi\'s 501 Original', brand: 'Levi\'s', price: '$98', image_url: 'https://levi.com/cdn/501-original.jpg', url: 'https://www.levi.com/501', thumbnailScore: 88, reason: 'Flat-lay with consistent lighting' },
  { name: 'The Pocket Tee', brand: 'Buck Mason', price: '$38', image_url: 'https://buckmason.com/cdn/pocket-tee.jpg', url: 'https://buckmason.com', thumbnailScore: 82, reason: 'Ghost-mannequin photography' },
];

function scoreThumbnail(p: { brand: string; image_url: string }): { score: number; reason: string } {
  // Heuristic scoring for how well a product photo will generate AI video
  let score = 50;
  const reasons: string[] = [];

  // Known premium brand shops usually have clean, high-res product shots
  const premiumBrands = ['Nike', 'Adidas', 'Apple', 'Rolex', 'Cartier', 'Louis Vuitton', 'Ray-Ban', 'Levi\'s', 'Uniqlo', 'Everlane', 'Reformation', 'AGOLDE', 'The Row', 'Coach', 'Skims'];
  if (premiumBrands.some(b => p.brand.toLowerCase().includes(b.toLowerCase()))) {
    score += 25;
    reasons.push('premium brand CDN');
  }

  // CDN quality indicators
  const url = p.image_url.toLowerCase();
  if (url.includes('static.') || url.includes('cdn.') || url.includes('images.') || url.includes('imagedelivery')) {
    score += 10;
    reasons.push('dedicated CDN');
  }
  if (url.includes('1280') || url.includes('1880') || url.includes('_1600') || url.includes('w_1800')) {
    score += 15;
    reasons.push('hi-res source');
  }
  if (url.includes('transparent') || url.includes('white') || url.includes('standard')) {
    score += 8;
    reasons.push('clean background');
  }
  if (url.endsWith('.png') || url.includes('f_auto')) {
    score += 5;
    reasons.push('optimized format');
  }

  score = Math.min(100, score);
  return {
    score,
    reason: reasons.length ? reasons.slice(0, 2).join(' · ') : 'standard product photo',
  };
}

function scoreList(list: Omit<ResearchedProduct, 'thumbnailScore' | 'reason'>[]): ResearchedProduct[] {
  return list.map(p => {
    const { score, reason } = scoreThumbnail(p);
    return { ...p, thumbnailScore: score, reason };
  }).sort((a, b) => b.thumbnailScore - a.thumbnailScore);
}

export async function researchProducts(query: string): Promise<ResearchedProduct[]> {
  // Simulate AI research latency
  await new Promise(r => setTimeout(r, 900));
  const q = query.toLowerCase().trim();
  if (!q) return [];

  for (const cat of DB) {
    if (cat.keywords.some(k => q.includes(k) || k.includes(q))) {
      return scoreList(cat.products);
    }
  }

  // Fuzzy fallback — return hits from any category whose keywords share a token
  const tokens = q.split(/\s+/).filter(t => t.length > 2);
  const hits: typeof DB[number]['products'] = [];
  for (const cat of DB) {
    const matchedKeyword = cat.keywords.some(k => tokens.some(t => k.includes(t)));
    if (matchedKeyword) hits.push(...cat.products);
  }
  if (hits.length > 0) return scoreList(hits).slice(0, 10);

  return FALLBACK;
}
