export interface Product {
  name: string;
  brand: string;
  price: string;
  url: string;
}

export interface Creator {
  name: string;
  displayName: string;
  avatar: string;
}

export interface Look {
  id: number;
  title: string;
  video: string;
  gender: 'men' | 'women';
  creator: string;
  description: string;
  color: string;
  products: Product[];
}

export const creators: Record<string, Creator> = {
  '@lilywittman': { name: '@lilywittman', displayName: 'Lily Wittman', avatar: 'https://i.pravatar.cc/100?img=47' },
  '@garrett':     { name: '@garrett',     displayName: 'Garrett',      avatar: 'https://i.pravatar.cc/100?img=12' },
};

const guyProducts: Product[] = [
  { name: 'Patchwork Pointelle Short-Sleeve Shirt', brand: 'Vince', price: '$568', url: 'https://www.vince.com/product/patchwork-pointelle-short-sleeve-shirt-M03516417A.html' },
  { name: 'Light Blue Straight Leg Jeans', brand: 'Suitsupply', price: '$199', url: 'https://suitsupply.com' },
  { name: 'B27 Uptown Low-Top Sneaker Gray and White', brand: 'Dior', price: '$1,200', url: 'https://www.dior.com' },
  { name: 'Digital Camera', brand: 'Fujifilm', price: '$1,725', url: 'https://www.fujifilm.com' },
];

const girlProducts: Product[] = [
  { name: 'Rock Style Flap Shoulder Bag', brand: 'Zara', price: '$49', url: 'https://www.zara.com' },
  { name: 'Major Shade Cat Eye Sunglasses', brand: 'Windsor', price: '$10', url: 'https://www.windsorstore.com' },
  { name: 'Oval D Glitter Case for iPhone 16 Pro', brand: 'Diesel', price: '$39', url: 'https://www.diesel.com' },
  { name: 'Cross Pendant Necklace', brand: 'Pavoi', price: '$13', url: 'https://www.pavoi.com' },
];

export const looks: Look[] = [
  { id: 1, title: 'Look 01', video: 'girl2.mp4', gender: 'women', creator: '@lilywittman', description: 'A curated selection of essential pieces for the modern wardrobe.', color: '#c4a882', products: girlProducts },
  { id: 2, title: 'Look 02', video: 'guy.mp4', gender: 'men', creator: '@garrett', description: 'Effortless layering with neutral tones and soft textures.', color: '#8b9e8b', products: guyProducts },
  { id: 3, title: 'Look 03', video: 'girl2.mp4', gender: 'women', creator: '@lilywittman', description: 'Sharp tailoring meets relaxed silhouettes.', color: '#a89090', products: girlProducts },
  { id: 4, title: 'Look 04', video: 'guy.mp4', gender: 'men', creator: '@garrett', description: 'Minimalist elegance with bold accessories.', color: '#8899aa', products: guyProducts },
  { id: 5, title: 'Look 05', video: 'girl2.mp4', gender: 'women', creator: '@lilywittman', description: 'Weekend ready with refined casual pieces.', color: '#b8a898', products: girlProducts },
  { id: 6, title: 'Look 06', video: 'guy.mp4', gender: 'men', creator: '@garrett', description: 'Evening allure with timeless sophistication.', color: '#787878', products: guyProducts },
  { id: 7, title: 'Look 07', video: 'girl2.mp4', gender: 'women', creator: '@lilywittman', description: 'Transitional dressing for in-between seasons.', color: '#9ca88c', products: girlProducts },
  { id: 8, title: 'Look 08', video: 'guy.mp4', gender: 'men', creator: '@garrett', description: 'Monochrome mastery with textural contrast.', color: '#a09088', products: guyProducts },
  { id: 9, title: 'Look 09', video: 'girl2.mp4', gender: 'women', creator: '@lilywittman', description: 'Artful draping and fluid movement.', color: '#8a8a9e', products: girlProducts },
  { id: 10, title: 'Look 10', video: 'guy.mp4', gender: 'men', creator: '@garrett', description: 'Power dressing reimagined for today.', color: '#aa9e88', products: guyProducts },
  { id: 11, title: 'Look 11', video: 'girl2.mp4', gender: 'women', creator: '@lilywittman', description: 'Soft palette with unexpected proportions.', color: '#9e8a7e', products: girlProducts },
  { id: 12, title: 'Look 12', video: 'guy.mp4', gender: 'men', creator: '@garrett', description: 'Polished ease for every occasion.', color: '#7e8e8e', products: guyProducts },
];

export const searchSuggestions = [
  'beach day', 'mens shorts', 'omg shoes', 'make me hot',
  'date night outfit', 'gym fits', 'summer dresses', 'streetwear',
  'brunch outfit', 'skincare routine', 'festival looks', 'quiet luxury',
  'clean girl aesthetic', 'wedding guest dress', 'vintage finds',
  'sneaker rotation', 'concert outfit', 'airport outfit',
  'first date fit', 'matcha everything', 'pilates princess',
  'cozy fall vibes', 'coffee shops LA', 'travel essentials',
  'old money style', 'dopamine dressing', 'it girl energy',
  'minimalist wardrobe', 'hot girl walk essentials', 'lazy sunday'
];
