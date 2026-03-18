// Creator profiles with avatar colors (will use generated SVG avatars)
const creators = {
  '@sophia': { name: '@sophia', color: '#e8c4a0', initials: 'S' },
  '@marcus': { name: '@marcus', color: '#7ea8c4', initials: 'M' },
  '@lena':   { name: '@lena',   color: '#c49eb8', initials: 'L' },
};

function avatarSvg(creator) {
  const c = creators[creator];
  if (!c) return '';
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 44 44"><circle cx="22" cy="22" r="22" fill="${c.color}"/><text x="22" y="23" text-anchor="middle" dominant-baseline="central" font-family="sans-serif" font-size="18" font-weight="600" fill="#fff">${c.initials}</text></svg>`)}`;
}

// Product sets
const guyProducts = [
  { name: 'Patchwork Pointelle Short-Sleeve Shirt', brand: 'Vince', price: '$568' },
  { name: 'Light Blue Straight Leg Jeans', brand: 'Suitsupply', price: '$199' },
  { name: 'B27 Uptown Low-Top Sneaker Gray and White', brand: 'Dior', price: '$1,200' },
  { name: 'Digital Camera', brand: 'Fujifilm', price: '$1,725' },
];

const girlProducts = [
  { name: 'Rock Style Flap Shoulder Bag', brand: 'Zara', price: '$49' },
  { name: 'Major Shade Cat Eye Sunglasses', brand: 'Windsor', price: '$10' },
  { name: 'Oval D Glitter Case for iPhone 16 Pro', brand: 'Diesel', price: '$39' },
  { name: 'Cross Pendant Necklace', brand: 'Pavoi', price: '$13' },
];

// Look data with video files and creators
const looks = [
  { id: 1, title: 'Look 01', video: 'girl.mp4', creator: '@sophia', description: 'A curated selection of essential pieces for the modern wardrobe.', color: '#c4a882', products: girlProducts },
  { id: 2, title: 'Look 02', video: 'guy.mp4', creator: '@marcus', description: 'Effortless layering with neutral tones and soft textures.', color: '#8b9e8b', products: guyProducts },
  { id: 3, title: 'Look 03', video: 'girl.mp4', creator: '@sophia', description: 'Sharp tailoring meets relaxed silhouettes.', color: '#a89090', products: girlProducts },
  { id: 4, title: 'Look 04', video: 'guy.mp4', creator: '@lena', description: 'Minimalist elegance with bold accessories.', color: '#8899aa', products: guyProducts },
  { id: 5, title: 'Look 05', video: 'girl.mp4', creator: '@marcus', description: 'Weekend ready with refined casual pieces.', color: '#b8a898', products: girlProducts },
  { id: 6, title: 'Look 06', video: 'guy.mp4', creator: '@lena', description: 'Evening allure with timeless sophistication.', color: '#787878', products: guyProducts },
  { id: 7, title: 'Look 07', video: 'girl.mp4', creator: '@sophia', description: 'Transitional dressing for in-between seasons.', color: '#9ca88c', products: girlProducts },
  { id: 8, title: 'Look 08', video: 'guy.mp4', creator: '@marcus', description: 'Monochrome mastery with textural contrast.', color: '#a09088', products: guyProducts },
  { id: 9, title: 'Look 09', video: 'girl.mp4', creator: '@lena', description: 'Artful draping and fluid movement.', color: '#8a8a9e', products: girlProducts },
  { id: 10, title: 'Look 10', video: 'guy.mp4', creator: '@sophia', description: 'Power dressing reimagined for today.', color: '#aa9e88', products: guyProducts },
  { id: 11, title: 'Look 11', video: 'girl.mp4', creator: '@marcus', description: 'Soft palette with unexpected proportions.', color: '#9e8a7e', products: girlProducts },
  { id: 12, title: 'Look 12', video: 'guy.mp4', creator: '@lena', description: 'Polished ease for every occasion.', color: '#7e8e8e', products: guyProducts },
];

// DOM
const gridContainer = document.getElementById('grid-container');
const gridViewport = document.getElementById('grid-viewport');
const scaleSlider = document.getElementById('scale-slider');
const overlay = document.getElementById('look-overlay');
const closeBtn = document.getElementById('close-look');
const detailMedia = document.getElementById('detail-media');
const detailTitle = document.getElementById('detail-title');
const detailDescription = document.getElementById('detail-description');
const detailProducts = document.getElementById('detail-products');

// State
let cardWidth = parseInt(scaleSlider.value);
let panX = 0;
let panY = 0;
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;
let startPanX = 0;
let startPanY = 0;
let hasDragged = false;

// Build grid
function buildGrid() {
  gridContainer.innerHTML = '';
  const cols = Math.max(1, Math.floor((window.innerWidth - 32) / (cardWidth + 8)));
  gridContainer.style.gridTemplateColumns = `repeat(${cols}, ${cardWidth}px)`;

  looks.forEach((look, i) => {
    const card = createLookCard(look, i);
    gridContainer.appendChild(card);
  });

  updateTransform();
}

function createLookCard(look, i) {
  const card = document.createElement('div');
  card.className = 'look-card';
  card.style.width = `${cardWidth}px`;
  card.dataset.id = look.id;

  card.innerHTML = `
    <div class="card-inner" style="background: ${look.color}">
      <video src="${look.video}" muted loop playsinline autoplay preload="auto"></video>
      <div class="card-gradient"></div>
      <div class="card-creator-row" data-creator="${look.creator}">
        <img class="card-creator-avatar" src="${avatarSvg(look.creator)}" alt="${look.creator}">
        <span class="card-creator-name">${look.creator}</span>
      </div>
    </div>
  `;

  // Creator link click
  const creatorLink = card.querySelector('.card-creator-row');
  creatorLink.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!hasDragged) openCreatorPage(look.creator);
  });

  card.addEventListener('click', (e) => {
    if (!hasDragged && !e.target.closest('.card-creator-row')) {
      openLook(look, i);
    }
  });

  return card;
}

function updateTransform() {
  gridContainer.style.transform = `translate(${panX}px, ${panY}px)`;
}

// Drag to pan
gridViewport.addEventListener('mousedown', (e) => {
  if (e.target.closest('#look-overlay')) return;
  if (e.target.closest('.card-creator-row')) return;
  isDragging = true;
  hasDragged = false;
  dragStartX = e.clientX;
  dragStartY = e.clientY;
  startPanX = panX;
  startPanY = panY;
  gridViewport.classList.add('dragging');
  e.preventDefault();
});

window.addEventListener('mousemove', (e) => {
  if (!isDragging) return;
  const dx = e.clientX - dragStartX;
  const dy = e.clientY - dragStartY;
  if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
    hasDragged = true;
  }
  panX = startPanX + dx;
  panY = startPanY + dy;
  updateTransform();
});

window.addEventListener('mouseup', () => {
  isDragging = false;
  gridViewport.classList.remove('dragging');
});

// Touch support
gridViewport.addEventListener('touchstart', (e) => {
  if (e.target.closest('#look-overlay')) return;
  const touch = e.touches[0];
  isDragging = true;
  hasDragged = false;
  dragStartX = touch.clientX;
  dragStartY = touch.clientY;
  startPanX = panX;
  startPanY = panY;
}, { passive: true });

gridViewport.addEventListener('touchmove', (e) => {
  if (!isDragging) return;
  const touch = e.touches[0];
  const dx = touch.clientX - dragStartX;
  const dy = touch.clientY - dragStartY;
  if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
    hasDragged = true;
  }
  panX = startPanX + dx;
  panY = startPanY + dy;
  updateTransform();
  e.preventDefault();
}, { passive: false });

gridViewport.addEventListener('touchend', () => {
  isDragging = false;
});

// Scale slider
scaleSlider.addEventListener('input', () => {
  cardWidth = parseInt(scaleSlider.value);
  buildGrid();
});

// Open look detail
function openLook(look, index) {
  detailTitle.textContent = look.title;
  detailDescription.textContent = look.description;
  detailMedia.innerHTML = `<video src="${look.video}" autoplay loop muted playsinline style="width:100%;border-radius:12px;aspect-ratio:3/4;object-fit:cover"></video>`;

  detailProducts.innerHTML = look.products.map(p => `
    <div class="product-item">
      <div class="product-thumb" style="background:${look.color};opacity:0.5"></div>
      <div class="product-details">
        ${p.brand ? `<span class="product-brand">${p.brand}</span>` : ''}
        <h4>${p.name}</h4>
        <span>${p.price}</span>
      </div>
    </div>
  `).join('');

  overlay.classList.remove('hidden');
}

// Close look detail
function closeLook() {
  overlay.classList.add('hidden');
  const vid = detailMedia.querySelector('video');
  if (vid) vid.pause();
}

closeBtn.addEventListener('click', closeLook);

// Click anywhere on the overlay (negative space) to close
overlay.addEventListener('click', (e) => {
  // Close if clicking the overlay background, the detail container, or the media area
  // Only keep open if clicking product info interactive elements
  if (e.target === overlay || e.target.closest('.look-media') || e.target.closest('.look-detail') && !e.target.closest('.product-item')) {
    closeLook();
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!overlay.classList.contains('hidden')) {
      closeLook();
    } else {
      closeCreatorPage();
    }
  }
});

// Creator catalog page
function openCreatorPage(creatorName) {
  closeCreatorPage();

  const creatorLooks = looks.filter(l => l.creator === creatorName);
  const c = creators[creatorName];

  const page = document.createElement('div');
  page.className = 'creator-page';
  page.id = 'creator-page';

  page.innerHTML = `
    <button class="creator-back" id="creator-back">&larr; Back</button>
    <div class="creator-header">
      <h1>${creatorName}</h1>
      <p>${creatorLooks.length} looks</p>
    </div>
    <div class="creator-grid" id="creator-grid"></div>
  `;

  document.body.appendChild(page);

  const creatorGrid = page.querySelector('#creator-grid');
  creatorLooks.forEach((look, i) => {
    const card = document.createElement('div');
    card.className = 'look-card';
    card.style.width = '100%';

    card.innerHTML = `
      <div class="card-inner" style="background: ${look.color}">
        <video src="${look.video}" muted loop playsinline autoplay preload="auto"></video>
        <div class="card-gradient"></div>
        <div class="card-creator-row">
          <img class="card-creator-avatar" src="${avatarSvg(look.creator)}" alt="${look.creator}">
          <span class="card-creator-name">${look.creator}</span>
        </div>
      </div>
    `;

    card.addEventListener('click', () => {
      const globalIndex = looks.findIndex(l => l.id === look.id);
      openLook(look, globalIndex);
    });

    creatorGrid.appendChild(card);
  });

  page.querySelector('#creator-back').addEventListener('click', closeCreatorPage);
}

function closeCreatorPage() {
  const page = document.getElementById('creator-page');
  if (page) page.remove();
}

// Init
window.addEventListener('resize', buildGrid);
buildGrid();
