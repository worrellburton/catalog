// Sample look data (placeholders until real videos are provided)
const looks = [
  { id: 1, title: 'Look 01', description: 'A curated selection of essential pieces for the modern wardrobe.', color: '#c4a882', products: [{ name: 'Oversized Blazer', price: '$285' }, { name: 'Wide Leg Trousers', price: '$165' }, { name: 'Leather Belt', price: '$95' }] },
  { id: 2, title: 'Look 02', description: 'Effortless layering with neutral tones and soft textures.', color: '#8b9e8b', products: [{ name: 'Cashmere Sweater', price: '$320' }, { name: 'Silk Camisole', price: '$140' }] },
  { id: 3, title: 'Look 03', description: 'Sharp tailoring meets relaxed silhouettes.', color: '#a89090', products: [{ name: 'Structured Coat', price: '$450' }, { name: 'Knit Dress', price: '$210' }, { name: 'Ankle Boots', price: '$340' }] },
  { id: 4, title: 'Look 04', description: 'Minimalist elegance with bold accessories.', color: '#8899aa', products: [{ name: 'Column Dress', price: '$275' }, { name: 'Statement Earrings', price: '$85' }] },
  { id: 5, title: 'Look 05', description: 'Weekend ready with refined casual pieces.', color: '#b8a898', products: [{ name: 'Denim Jacket', price: '$195' }, { name: 'Cotton Tee', price: '$65' }, { name: 'Canvas Sneakers', price: '$120' }] },
  { id: 6, title: 'Look 06', description: 'Evening allure with timeless sophistication.', color: '#787878', products: [{ name: 'Satin Blouse', price: '$185' }, { name: 'Tailored Skirt', price: '$155' }, { name: 'Clutch Bag', price: '$220' }] },
  { id: 7, title: 'Look 07', description: 'Transitional dressing for in-between seasons.', color: '#9ca88c', products: [{ name: 'Trench Coat', price: '$395' }, { name: 'Merino Turtleneck', price: '$175' }] },
  { id: 8, title: 'Look 08', description: 'Monochrome mastery with textural contrast.', color: '#a09088', products: [{ name: 'Wool Coat', price: '$520' }, { name: 'Leather Gloves', price: '$110' }, { name: 'Scarf', price: '$95' }] },
  { id: 9, title: 'Look 09', description: 'Artful draping and fluid movement.', color: '#8a8a9e', products: [{ name: 'Wrap Dress', price: '$245' }, { name: 'Strappy Heels', price: '$290' }] },
  { id: 10, title: 'Look 10', description: 'Power dressing reimagined for today.', color: '#aa9e88', products: [{ name: 'Double-Breasted Suit', price: '$580' }, { name: 'Oxford Shoes', price: '$310' }] },
  { id: 11, title: 'Look 11', description: 'Soft palette with unexpected proportions.', color: '#9e8a7e', products: [{ name: 'Oversized Shirt', price: '$145' }, { name: 'Midi Skirt', price: '$170' }, { name: 'Flat Sandals', price: '$130' }] },
  { id: 12, title: 'Look 12', description: 'Polished ease for every occasion.', color: '#7e8e8e', products: [{ name: 'Linen Blazer', price: '$265' }, { name: 'Relaxed Chinos', price: '$135' }, { name: 'Tote Bag', price: '$195' }] },
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
  const cols = Math.max(1, Math.floor((window.innerWidth - 48) / (cardWidth + 12)));
  gridContainer.style.gridTemplateColumns = `repeat(${cols}, ${cardWidth}px)`;

  looks.forEach((look, i) => {
    const card = document.createElement('div');
    card.className = 'look-card';
    card.style.width = `${cardWidth}px`;
    card.dataset.id = look.id;

    card.innerHTML = `
      <div class="card-inner" style="background: ${look.color}">
        <div class="card-placeholder">${String(i + 1).padStart(2, '0')}</div>
        <div class="card-gradient"></div>
        <span class="card-title">${look.title}</span>
        <span class="card-number">${String(i + 1).padStart(2, '0')} / ${looks.length}</span>
      </div>
    `;

    card.addEventListener('click', (e) => {
      if (!hasDragged) {
        openLook(look, i);
      }
    });

    gridContainer.appendChild(card);
  });

  updateTransform();
}

function updateTransform() {
  gridContainer.style.transform = `translate(${panX}px, ${panY}px)`;
}

// Drag to pan
gridViewport.addEventListener('mousedown', (e) => {
  if (e.target.closest('#look-overlay')) return;
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
let touchStartX = 0, touchStartY = 0;

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
  detailMedia.innerHTML = `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:64px;color:rgba(255,255,255,0.06);font-weight:700;background:${look.color};border-radius:12px;aspect-ratio:3/1">${String(index + 1).padStart(2, '0')}</div>`;

  detailProducts.innerHTML = look.products.map(p => `
    <div class="product-item">
      <div class="product-thumb" style="background:${look.color};opacity:0.5"></div>
      <div class="product-details">
        <h4>${p.name}</h4>
        <span>${p.price}</span>
      </div>
    </div>
  `).join('');

  overlay.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

// Close look detail
function closeLook() {
  overlay.classList.add('hidden');
  document.body.style.overflow = '';
}

closeBtn.addEventListener('click', closeLook);

overlay.addEventListener('click', (e) => {
  if (e.target === overlay) closeLook();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeLook();
});

// Init
window.addEventListener('resize', buildGrid);
buildGrid();
