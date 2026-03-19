// Password gate
const pwInput = document.getElementById('pw-input');
const pwError = document.getElementById('pw-error');
const pwGate = document.getElementById('password-gate');
const splashScreen = document.getElementById('splash-screen');
const PASSWORD = '123';
const LANDING_PASSWORD = '321';

function attemptLogin() {
  const val = pwInput.value.trim().toLowerCase();

  if (val === 'deck') {
    pwError.textContent = '';
    pwGate.classList.add('dismissed');
    document.getElementById('deck-view').classList.add('active');
    document.body.classList.add('deck-mode');
    setTimeout(() => pwGate.remove(), 600);
    return;
  }

  if (val === LANDING_PASSWORD) {
    pwError.textContent = '';
    pwGate.classList.add('dismissed');
    document.getElementById('landing-page').classList.add('active');
    document.body.classList.add('landing-mode');
    setTimeout(() => pwGate.remove(), 600);
    initLandingPage();
    return;
  }

  if (val === PASSWORD) {
    pwError.textContent = '';
    pwGate.classList.add('dismissed');
    document.body.classList.remove('from-deck');

    // Show splash
    splashScreen.classList.add('active');

    // After splash plays, fade out and reveal app
    setTimeout(() => {
      splashScreen.classList.add('fade-out');
      document.body.classList.remove('locked');
    }, 2200);

    setTimeout(() => {
      splashScreen.remove();
      pwGate.remove();
    }, 3000);
  } else {
    pwError.textContent = 'Incorrect code';
    pwInput.value = '';
    pwInput.classList.add('shake');
    setTimeout(() => pwInput.classList.remove('shake'), 500);
  }
}

pwInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') attemptLogin();
});

document.getElementById('pw-enter').addEventListener('click', attemptLogin);

// Auto-focus password input
pwInput.focus();

// Creator profiles with real avatar photos
const creators = {
  '@lilywittman': { name: '@lilywittman', displayName: 'Lily Wittman', avatar: 'https://i.pravatar.cc/100?img=47' },
  '@garrett':     { name: '@garrett',     displayName: 'Garrett',      avatar: 'https://i.pravatar.cc/100?img=12' },
};

function avatarSvg(creator) {
  const c = creators[creator];
  if (!c) return '';
  return c.avatar;
}

// Product sets
const guyProducts = [
  { name: 'Patchwork Pointelle Short-Sleeve Shirt', brand: 'Vince', price: '$568', url: 'https://www.vince.com/product/patchwork-pointelle-short-sleeve-shirt-M03516417A.html' },
  { name: 'Light Blue Straight Leg Jeans', brand: 'Suitsupply', price: '$199', url: 'https://suitsupply.com' },
  { name: 'B27 Uptown Low-Top Sneaker Gray and White', brand: 'Dior', price: '$1,200', url: 'https://www.dior.com' },
  { name: 'Digital Camera', brand: 'Fujifilm', price: '$1,725', url: 'https://www.fujifilm.com' },
];

const girlProducts = [
  { name: 'Rock Style Flap Shoulder Bag', brand: 'Zara', price: '$49', url: 'https://www.zara.com' },
  { name: 'Major Shade Cat Eye Sunglasses', brand: 'Windsor', price: '$10', url: 'https://www.windsorstore.com' },
  { name: 'Oval D Glitter Case for iPhone 16 Pro', brand: 'Diesel', price: '$39', url: 'https://www.diesel.com' },
  { name: 'Cross Pendant Necklace', brand: 'Pavoi', price: '$13', url: 'https://www.pavoi.com' },
];

// Look data with video files and creators
const looks = [
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

// Active filter
let activeFilter = 'all'; // 'all', 'men', 'women'

function getFilteredLooks() {
  let filtered = activeFilter === 'all' ? looks : looks.filter(l => l.gender === activeFilter);
  if (searchQuery) {
    filtered = filtered.filter(l =>
      l.title.toLowerCase().includes(searchQuery) ||
      l.creator.toLowerCase().includes(searchQuery) ||
      l.description.toLowerCase().includes(searchQuery) ||
      l.products.some(p => p.name.toLowerCase().includes(searchQuery) || p.brand.toLowerCase().includes(searchQuery))
    );
  }
  return filtered;
}

// DOM
const gridContainer = document.getElementById('grid-container');
const gridViewport = document.getElementById('grid-viewport');
const scaleSlider = document.getElementById('scale-slider');
const overlay = document.getElementById('look-overlay');
const closeBtn = document.getElementById('close-look');
const detailMedia = document.getElementById('detail-media');
const detailCreator = document.getElementById('detail-creator');
const detailTitle = document.getElementById('detail-title');
const detailDescription = document.getElementById('detail-description');
const detailProducts = document.getElementById('detail-products');

// State
let cardWidth = parseInt(scaleSlider.value);

// IntersectionObserver to lazy-play videos only when visible
const videoObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    const video = entry.target;
    if (entry.isIntersecting) {
      if (video.dataset.src && !video.dataset.srcSet) {
        video.dataset.srcSet = '1';
        video.src = video.dataset.src;
        video.load();
      }
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  });
}, { rootMargin: '200px' });

// Build grid
function buildGrid() {
  // Disconnect all observed videos first
  gridContainer.querySelectorAll('video').forEach(v => videoObserver.unobserve(v));
  gridContainer.innerHTML = '';

  // On mobile, let CSS handle the 2-col grid; on desktop, use slider value
  if (window.innerWidth <= 768) {
    gridContainer.style.gridTemplateColumns = '';
  } else {
    gridContainer.style.gridTemplateColumns = `repeat(auto-fill, minmax(${cardWidth}px, 1fr))`;
  }

  const filtered = getFilteredLooks();
  destroyParticleWorld();
  if (filtered.length === 0) {
    if (searchQuery) {
      const container = document.createElement('div');
      container.className = 'no-results-container';
      container.id = 'no-results-container';

      const canvas = document.createElement('canvas');
      canvas.className = 'no-results-canvas';
      canvas.id = 'particle-canvas';
      container.appendChild(canvas);

      const noResults = document.createElement('div');
      noResults.className = 'no-results';
      noResults.innerHTML = `
        <div class="no-results-icon">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        </div>
        <h3>No content matches "${searchQuery}"</h3>
        <p>Try a different search or browse all looks</p>
      `;
      container.appendChild(noResults);
      document.body.appendChild(container);
      initParticleWorld(canvas);
    }
    return;
  }

  // Cap repeats to a reasonable number (max ~48 cards)
  const maxCards = 48;
  const repeatCount = Math.max(1, Math.ceil(maxCards / filtered.length));

  for (let r = 0; r < repeatCount; r++) {
    filtered.forEach((look, i) => {
      const card = createLookCard(look, i);
      gridContainer.appendChild(card);
    });
  }
}

function createLookCard(look, i) {
  const card = document.createElement('div');
  card.className = 'look-card';
  card.dataset.id = look.id;

  const creatorData = creators[look.creator];
  card.innerHTML = `
    <div class="card-inner">
      <div class="card-shimmer"></div>
      <video data-src="${look.video}" muted loop playsinline preload="none"></video>
      <div class="card-gradient"></div>
      <div class="card-creator-row" data-creator="${look.creator}">
        <img class="card-creator-avatar" src="${avatarSvg(look.creator)}" alt="${look.creator}">
        <span class="card-creator-name">${creatorData ? creatorData.displayName : look.creator}</span>
      </div>
    </div>
  `;

  const video = card.querySelector('video');
  const shimmer = card.querySelector('.card-shimmer');

  function markLoaded() {
    if (card.classList.contains('loaded')) return;
    card.classList.add('loaded');
    if (shimmer) setTimeout(() => { if (shimmer.parentNode) shimmer.remove(); }, 700);
  }

  // Multiple triggers to catch all browser behaviors
  ['playing', 'canplay', 'loadeddata', 'loadedmetadata'].forEach(evt => {
    video.addEventListener(evt, markLoaded, { once: true });
  });

  // Poll fallback: check if video has data every 500ms, give up after 8s
  let pollCount = 0;
  const pollInterval = setInterval(() => {
    pollCount++;
    if (card.classList.contains('loaded') || pollCount > 16) {
      clearInterval(pollInterval);
      markLoaded(); // force it after 8s no matter what
      return;
    }
    if (video.readyState >= 2) { // HAVE_CURRENT_DATA or better
      clearInterval(pollInterval);
      markLoaded();
    }
  }, 500);

  videoObserver.observe(video);

  const creatorLink = card.querySelector('.card-creator-row');
  creatorLink.addEventListener('click', (e) => {
    e.stopPropagation();
    openCreatorPage(look.creator);
  });

  card.addEventListener('click', (e) => {
    if (!e.target.closest('.card-creator-row')) {
      openLook(look, i);
    }
  });

  return card;
}

// Scale slider (debounced)
let scaleTimeout;
scaleSlider.addEventListener('input', () => {
  clearTimeout(scaleTimeout);
  scaleTimeout = setTimeout(() => {
    cardWidth = parseInt(scaleSlider.value);
    buildGrid();
  }, 80);
});

// Bookmarks (persisted in localStorage)
let bookmarkedLooks = JSON.parse(localStorage.getItem('catalog_bookmarked_looks') || '[]');
let bookmarkedProducts = JSON.parse(localStorage.getItem('catalog_bookmarked_products') || '[]');

function saveBookmarks() {
  localStorage.setItem('catalog_bookmarked_looks', JSON.stringify(bookmarkedLooks));
  localStorage.setItem('catalog_bookmarked_products', JSON.stringify(bookmarkedProducts));
  updateBookmarkCount();
}

function isLookBookmarked(lookId) {
  return bookmarkedLooks.includes(lookId);
}

function toggleLookBookmark(lookId) {
  if (isLookBookmarked(lookId)) {
    bookmarkedLooks = bookmarkedLooks.filter(id => id !== lookId);
  } else {
    bookmarkedLooks.push(lookId);
  }
  saveBookmarks();
}

function productKey(p) {
  return `${p.brand}::${p.name}`;
}

function isProductBookmarked(p) {
  return bookmarkedProducts.some(bp => productKey(bp) === productKey(p));
}

function toggleProductBookmark(p) {
  const key = productKey(p);
  if (bookmarkedProducts.some(bp => productKey(bp) === key)) {
    bookmarkedProducts = bookmarkedProducts.filter(bp => productKey(bp) !== key);
  } else {
    bookmarkedProducts.push({ name: p.name, brand: p.brand, price: p.price, url: p.url });
  }
  saveBookmarks();
}

function updateBookmarkCount() {
  const total = bookmarkedLooks.length + bookmarkedProducts.length;
  const toggle = document.getElementById('bookmark-toggle');
  let badge = toggle.querySelector('.bookmark-count');
  if (total > 0) {
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'bookmark-count';
      toggle.appendChild(badge);
    }
    badge.textContent = total;
  } else if (badge) {
    badge.remove();
  }
}
updateBookmarkCount();

// Open look detail
function openLook(look, index) {
  // Creator row
  const cInfo = creators[look.creator];
  detailCreator.innerHTML = `
    <div class="detail-creator-row" data-creator="${look.creator}">
      <img class="detail-creator-avatar" src="${avatarSvg(look.creator)}" alt="${look.creator}">
      <span class="detail-creator-name">${cInfo ? cInfo.displayName : look.creator}</span>
    </div>
    <button class="look-bookmark-btn ${isLookBookmarked(look.id) ? 'active' : ''}" id="look-bookmark-btn" aria-label="Bookmark look">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
    </button>
  `;

  detailCreator.querySelector('.detail-creator-row').addEventListener('click', () => {
    closeLook();
    openCreatorPage(look.creator);
  });

  detailCreator.querySelector('#look-bookmark-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    toggleLookBookmark(look.id);
    e.currentTarget.classList.toggle('active', isLookBookmarked(look.id));
  });

  detailTitle.textContent = look.title;
  detailDescription.textContent = look.description;
  detailMedia.innerHTML = `<video src="${look.video}" autoplay loop muted playsinline style="width:100%;border-radius:12px;aspect-ratio:3/4;object-fit:cover"></video>`;

  detailProducts.innerHTML = look.products.map((p, pi) => `
    <div class="product-item" data-product-index="${pi}" style="cursor:pointer">
      <div class="product-thumb" style="background:${look.color};opacity:0.5"></div>
      <div class="product-details">
        ${p.brand ? `<span class="product-brand">${p.brand}</span>` : ''}
        <h4>${p.name}</h4>
        <span>${p.price}</span>
      </div>
      <button class="product-bookmark-btn ${isProductBookmarked(p) ? 'active' : ''}" data-product-index="${pi}" aria-label="Bookmark product">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
      </button>
      <svg class="product-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
    </div>
  `).join('');

  // Product bookmark buttons
  detailProducts.querySelectorAll('.product-bookmark-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const pi = parseInt(btn.dataset.productIndex);
      const product = look.products[pi];
      toggleProductBookmark(product);
      btn.classList.toggle('active', isProductBookmarked(product));
    });
  });

  // Make product items clickable (but not on bookmark btn)
  detailProducts.querySelectorAll('.product-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (e.target.closest('.product-bookmark-btn')) return;
      e.stopPropagation();
      const pi = parseInt(item.dataset.productIndex);
      const product = look.products[pi];
      if (product && product.url) {
        openInAppBrowser(product.url, product.name);
      }
    });
  });

  overlay.classList.remove('hidden');
}

// Close look detail
function closeLook() {
  overlay.classList.add('hidden');
  const vid = detailMedia.querySelector('video');
  if (vid) vid.pause();
}

closeBtn.addEventListener('click', closeLook);

// Swipe down to close on mobile
let touchStartY = 0;
let touchStartX = 0;
let overlayTranslateY = 0;

overlay.addEventListener('touchstart', (e) => {
  touchStartY = e.touches[0].clientY;
  touchStartX = e.touches[0].clientX;
  overlayTranslateY = 0;
}, { passive: true });

overlay.addEventListener('touchmove', (e) => {
  const dy = e.touches[0].clientY - touchStartY;
  const dx = Math.abs(e.touches[0].clientX - touchStartX);
  // Only track downward vertical swipes
  if (dy > 0 && dy > dx) {
    overlayTranslateY = dy;
    const opacity = Math.max(0.3, 1 - dy / 400);
    overlay.style.transform = `translateY(${dy}px)`;
    overlay.style.opacity = opacity;
    overlay.style.transition = 'none';
  }
}, { passive: true });

overlay.addEventListener('touchend', () => {
  if (overlayTranslateY > 120) {
    // Swipe far enough — close
    overlay.style.transform = `translateY(100vh)`;
    overlay.style.opacity = '0';
    overlay.style.transition = 'transform 0.3s ease, opacity 0.3s ease';
    setTimeout(() => {
      closeLook();
      overlay.style.transform = '';
      overlay.style.opacity = '';
      overlay.style.transition = '';
    }, 300);
  } else {
    // Snap back
    overlay.style.transform = '';
    overlay.style.opacity = '';
    overlay.style.transition = 'transform 0.3s ease, opacity 0.3s ease';
    setTimeout(() => { overlay.style.transition = ''; }, 300);
  }
  overlayTranslateY = 0;
});

// Click anywhere on the overlay (negative space) to close
overlay.addEventListener('click', (e) => {
  if (e.target === overlay || e.target.closest('.look-media') || (e.target.closest('.look-detail') && !e.target.closest('.product-item') && !e.target.closest('.detail-creator-row'))) {
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

    const cData = creators[look.creator];
    card.innerHTML = `
      <div class="card-inner">
        <div class="card-shimmer"></div>
        <video data-src="${look.video}" muted loop playsinline preload="none"></video>
        <div class="card-gradient"></div>
        <div class="card-creator-row">
          <img class="card-creator-avatar" src="${avatarSvg(look.creator)}" alt="${look.creator}">
          <span class="card-creator-name">${cData ? cData.displayName : look.creator}</span>
        </div>
      </div>
    `;

    const video = card.querySelector('video');
    const shimmerEl = card.querySelector('.card-shimmer');

    function markCardLoaded() {
      if (card.classList.contains('loaded')) return;
      card.classList.add('loaded');
      if (shimmerEl) setTimeout(() => { if (shimmerEl.parentNode) shimmerEl.remove(); }, 700);
    }

    ['playing', 'canplay', 'loadeddata', 'loadedmetadata'].forEach(evt => {
      video.addEventListener(evt, markCardLoaded, { once: true });
    });

    let cPollCount = 0;
    const cPollInterval = setInterval(() => {
      cPollCount++;
      if (card.classList.contains('loaded') || cPollCount > 16) {
        clearInterval(cPollInterval);
        markCardLoaded();
        return;
      }
      if (video.readyState >= 2) {
        clearInterval(cPollInterval);
        markCardLoaded();
      }
    }, 500);

    videoObserver.observe(video);

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
  if (page) {
    page.querySelectorAll('video').forEach(v => videoObserver.unobserve(v));
    page.remove();
  }
}

// Bottom bar - search & filters
const bottomBar = document.getElementById('bottom-bar');
const searchBtn = document.getElementById('search-btn');
const searchInput = document.getElementById('search-input');
const filterBtns = document.querySelectorAll('.filter-chip');

// Search - expand bottom bar
const searchBackdrop = document.getElementById('search-backdrop');
const bottomSearchInput = document.getElementById('bottom-search-input');

searchBtn.addEventListener('click', () => {
  bottomBar.classList.add('search-open');
  searchBackdrop.classList.add('visible');
  setTimeout(() => bottomSearchInput.focus(), 100);
});

function closeSearch() {
  bottomBar.classList.remove('search-open');
  searchBackdrop.classList.remove('visible');
  if (!searchQuery) bottomSearchInput.value = '';
  bottomSearchInput.blur();
}

searchBackdrop.addEventListener('click', closeSearch);

// Search filtering
let searchQuery = '';

bottomSearchInput.addEventListener('input', (e) => {
  searchQuery = e.target.value.trim().toLowerCase();
  buildGrid();
});

bottomSearchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && searchQuery) {
    closeSearch();
    // keep the query active — grid already filtered
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && bottomBar.classList.contains('search-open')) {
    closeSearch();
  }
});

// Star Wars crawl — search ideas on main screen
const crawlIdeas = [
  'beach day', 'mens shorts', 'omg shoes', 'make me hot',
  'healthy food', 'paris', 'restaurants in NYC', 'date night outfit',
  'cozy fall vibes', 'gym fits', 'summer dresses', 'streetwear',
  'coffee shops LA', 'brunch outfit', 'skincare routine', 'festival looks',
  'travel essentials', 'clean girl aesthetic', 'wedding guest dress',
  'vintage finds', 'apartment decor', 'sneaker rotation', 'hiking gear',
  'best sunglasses', 'cocktail recipes', 'book recommendations',
  'work from home setup', 'ski trip', 'golden hour pics', 'thrift haul',
  'Tokyo street style', 'plant mom', 'vinyl collection', 'sunset chasing',
  'morning routine', 'laptop bags', 'denim on denim', 'smoothie bowls',
  'rooftop bars', 'linen everything', 'road trip snacks', 'yoga fits',
  'minimalist wardrobe', 'concert outfit', 'self care sunday',
  'what to wear in Italy', 'best tacos ever', 'coastal grandmother',
  'mob wife aesthetic', 'quiet luxury', 'old money style', 'gorpcore',
  'cottagecore', 'dopamine dressing', 'tech bro uniform', 'it girl energy',
  'summer in Greece', 'Miami nightlife', 'London fog weather',
  'cabin in the woods', 'after party looks', 'airport outfit',
  'first date fit', 'lazy sunday', 'farmers market haul',
  'best pizza NYC', 'matcha everything', 'pilates princess',
  'hot girl walk essentials', 'desk setup inspo'
];

const crawlContent = document.getElementById('crawl-content');
if (crawlContent) {
  // Shuffle and repeat for long scroll
  const shuffled = [...crawlIdeas].sort(() => Math.random() - 0.5);
  const doubled = [...shuffled, ...shuffled];
  crawlContent.innerHTML = doubled.map(idea =>
    `<div class="crawl-line" data-query="${idea}">${idea}</div>`
  ).join('');

  crawlContent.addEventListener('click', (e) => {
    const line = e.target.closest('.crawl-line');
    if (!line) return;
    const query = line.dataset.query;
    // Open search and populate
    bottomBar.classList.add('search-open');
    searchBackdrop.classList.add('visible');
    bottomSearchInput.value = query;
    bottomSearchInput.dispatchEvent(new Event('input'));
    setTimeout(() => bottomSearchInput.focus(), 100);
  });
}

// Filter chips
filterBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const filter = btn.dataset.filter;

    if (activeFilter === filter) {
      activeFilter = 'all';
    } else {
      activeFilter = filter;
    }

    filterBtns.forEach(b => b.classList.toggle('active', b.dataset.filter === activeFilter));
    buildGrid();
  });
});

// In-app browser
function openInAppBrowser(url, title) {
  closeInAppBrowser();

  const browser = document.createElement('div');
  browser.className = 'in-app-browser';
  browser.id = 'in-app-browser';

  browser.innerHTML = `
    <div class="iab-header">
      <button class="iab-back" id="iab-back">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        Back to catalog
      </button>
      <span class="iab-title">${title || ''}</span>
    </div>
    <iframe src="${url}" class="iab-frame" sandbox="allow-scripts allow-same-origin allow-popups allow-forms"></iframe>
  `;

  document.body.appendChild(browser);

  // Trigger slide-in
  requestAnimationFrame(() => {
    browser.classList.add('open');
  });

  browser.querySelector('#iab-back').addEventListener('click', closeInAppBrowser);
}

function closeInAppBrowser() {
  const browser = document.getElementById('in-app-browser');
  if (!browser) return;

  browser.classList.remove('open');
  browser.addEventListener('transitionend', () => browser.remove(), { once: true });
}

// View toggle — cycles: grid → vertical → feed
const viewToggle = document.getElementById('view-toggle');
const viewModes = ['grid', 'vertical', 'feed'];
let currentViewIndex = 0;

viewToggle.addEventListener('click', () => {
  document.body.classList.remove('grid-mode', 'vertical-mode', 'feed-mode');
  currentViewIndex = (currentViewIndex + 1) % viewModes.length;
  document.body.classList.add(viewModes[currentViewIndex] + '-mode');
});

// Theme toggle
const themeToggle = document.getElementById('theme-toggle');
themeToggle.addEventListener('click', () => {
  document.body.classList.toggle('light-mode');
});

// Deck: See MVP button → show app with back-to-deck
document.getElementById('deck-mvp-btn').addEventListener('click', () => {
  document.getElementById('deck-view').classList.remove('active');
  document.body.classList.remove('deck-mode', 'locked', 'feed-mode', 'vertical-mode');
  document.body.classList.add('from-deck', 'grid-mode');
  currentViewIndex = 0;
});

// Deck: Visit website button → go straight to landing page
document.getElementById('deck-website-btn').addEventListener('click', (e) => {
  e.preventDefault();
  document.getElementById('deck-view').classList.remove('active');
  document.body.classList.remove('deck-mode', 'locked');
  document.getElementById('landing-page').classList.add('active');
  document.body.classList.add('landing-mode');
  initLandingPage();
});

document.getElementById('back-to-deck').addEventListener('click', () => {
  const dv = document.getElementById('deck-view');
  dv.classList.add('active');
  dv.scrollTop = 0;
  document.body.classList.add('deck-mode');
  document.body.classList.remove('from-deck');
});

// Deck theme toggle
document.getElementById('deck-theme-toggle').addEventListener('click', () => {
  document.body.classList.toggle('light-mode');
});

// Deck slide reveal on scroll
const deckView = document.getElementById('deck-view');
const deckObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
    }
  });
}, { threshold: 0.15 });

deckView.querySelectorAll('.deck-slide').forEach(slide => {
  deckObserver.observe(slide);
});

// 3D Particle world for no-results state
let particleAnimId = null;
let particleMouseX = 0;
let particleMouseY = 0;

function destroyParticleWorld() {
  if (particleAnimId) {
    cancelAnimationFrame(particleAnimId);
    particleAnimId = null;
  }
  const existing = document.getElementById('no-results-container');
  if (existing) existing.remove();
}

function initParticleWorld(canvas) {
  const ctx = canvas.getContext('2d');
  let w, h;
  const particles = [];
  const PARTICLE_COUNT = 120;
  const MOUSE_RADIUS = 140;
  const isLight = document.body.classList.contains('light-mode');

  function resize() {
    w = canvas.width = window.innerWidth;
    h = canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener('resize', resize);

  // Create particles with 3D positions
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    particles.push({
      x: Math.random() * w,
      y: Math.random() * h,
      z: Math.random() * 400 + 100, // depth: 100-500
      vx: (Math.random() - 0.5) * 0.3,
      vy: (Math.random() - 0.5) * 0.3,
      vz: (Math.random() - 0.5) * 0.2,
      baseSize: Math.random() * 1.5 + 0.5,
    });
  }

  canvas.addEventListener('mousemove', (e) => {
    particleMouseX = e.clientX;
    particleMouseY = e.clientY;
  });

  canvas.addEventListener('touchmove', (e) => {
    if (e.touches.length > 0) {
      particleMouseX = e.touches[0].clientX;
      particleMouseY = e.touches[0].clientY;
    }
  }, { passive: true });

  function animate() {
    ctx.clearRect(0, 0, w, h);

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];

      // Drift
      p.x += p.vx;
      p.y += p.vy;
      p.z += p.vz;

      // Wrap around
      if (p.x < -20) p.x = w + 20;
      if (p.x > w + 20) p.x = -20;
      if (p.y < -20) p.y = h + 20;
      if (p.y > h + 20) p.y = -20;
      if (p.z < 50) p.z = 500;
      if (p.z > 500) p.z = 50;

      // Perspective projection
      const scale = 300 / p.z;
      const screenX = (p.x - w / 2) * scale + w / 2;
      const screenY = (p.y - h / 2) * scale + h / 2;
      const size = p.baseSize * scale;

      // Mouse repulsion
      const dx = screenX - particleMouseX;
      const dy = screenY - particleMouseY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      let pushX = 0, pushY = 0;
      if (dist < MOUSE_RADIUS && dist > 0) {
        const force = (1 - dist / MOUSE_RADIUS) * 3;
        pushX = (dx / dist) * force;
        pushY = (dy / dist) * force;
        p.x += pushX;
        p.y += pushY;
      }

      // Draw particle
      const depthAlpha = Math.max(0.03, 1 - (p.z - 100) / 500);
      const alpha = depthAlpha * 0.35;
      ctx.beginPath();
      ctx.arc(screenX, screenY, Math.max(0.5, size), 0, Math.PI * 2);
      ctx.fillStyle = isLight
        ? `rgba(0, 0, 0, ${alpha})`
        : `rgba(255, 255, 255, ${alpha})`;
      ctx.fill();

      // Draw connections between nearby particles
      for (let j = i + 1; j < particles.length; j++) {
        const q = particles[j];
        const qScale = 300 / q.z;
        const qx = (q.x - w / 2) * qScale + w / 2;
        const qy = (q.y - h / 2) * qScale + h / 2;
        const d = Math.sqrt((screenX - qx) ** 2 + (screenY - qy) ** 2);
        if (d < 100) {
          const lineAlpha = (1 - d / 100) * 0.08 * Math.min(depthAlpha, Math.max(0.03, 1 - (q.z - 100) / 500));
          ctx.beginPath();
          ctx.moveTo(screenX, screenY);
          ctx.lineTo(qx, qy);
          ctx.strokeStyle = isLight
            ? `rgba(0, 0, 0, ${lineAlpha})`
            : `rgba(255, 255, 255, ${lineAlpha})`;
          ctx.lineWidth = 0.5;
          ctx.stroke();
        }
      }
    }

    particleAnimId = requestAnimationFrame(animate);
  }

  animate();
}

// Bookmarks page
const bookmarksPage = document.getElementById('bookmarks-page');
const bookmarksBack = document.getElementById('bookmarks-back');
const bookmarksLooksGrid = document.getElementById('bookmarks-looks-grid');
const bookmarksProductsList = document.getElementById('bookmarks-products-list');
const bookmarksLooksEmpty = document.getElementById('bookmarks-looks-empty');
const bookmarksProductsEmpty = document.getElementById('bookmarks-products-empty');

document.getElementById('bookmark-toggle').addEventListener('click', openBookmarksPage);
bookmarksBack.addEventListener('click', closeBookmarksPage);

function openBookmarksPage() {
  renderBookmarks();
  bookmarksPage.classList.remove('hidden');
}

function closeBookmarksPage() {
  bookmarksPage.classList.add('hidden');
}

function renderBookmarks() {
  // Looks
  bookmarksLooksGrid.innerHTML = '';
  const savedLooks = looks.filter(l => bookmarkedLooks.includes(l.id));
  bookmarksLooksEmpty.classList.toggle('visible', savedLooks.length === 0);

  savedLooks.forEach(look => {
    const card = document.createElement('div');
    card.className = 'bookmarks-look-card';
    card.innerHTML = `
      <video src="${look.video}" muted loop playsinline autoplay></video>
      <div class="blc-info">
        <img src="${avatarSvg(look.creator)}" style="width:20px;height:20px;border-radius:50%;object-fit:cover">
        <span>${look.title}</span>
      </div>
    `;
    card.addEventListener('click', () => {
      closeBookmarksPage();
      const gi = looks.findIndex(l => l.id === look.id);
      openLook(look, gi);
    });
    bookmarksLooksGrid.appendChild(card);
  });

  // Products
  bookmarksProductsList.innerHTML = '';
  bookmarksProductsEmpty.classList.toggle('visible', bookmarkedProducts.length === 0);

  bookmarkedProducts.forEach(p => {
    const item = document.createElement('div');
    item.className = 'bookmarks-product-item';
    item.innerHTML = `
      <div class="bp-thumb" style="background: rgba(128,128,128,0.2);"></div>
      <div class="bp-info">
        <span class="bp-brand">${p.brand || ''}</span>
        <span class="bp-name">${p.name}</span>
        <span class="bp-price">${p.price}</span>
      </div>
      <button class="bp-remove" aria-label="Remove bookmark">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    `;
    item.querySelector('.bp-info').addEventListener('click', () => {
      if (p.url) {
        closeBookmarksPage();
        openInAppBrowser(p.url, p.name);
      }
    });
    item.querySelector('.bp-remove').addEventListener('click', (e) => {
      e.stopPropagation();
      toggleProductBookmark(p);
      renderBookmarks();
    });
    bookmarksProductsList.appendChild(item);
  });
}

// Landing page logic
function initLandingPage() {
  const landingPage = document.getElementById('landing-page');
  const landingNav = document.getElementById('landing-nav');

  // Nav scroll effect
  landingPage.addEventListener('scroll', () => {
    if (landingPage.scrollTop > 50) {
      landingNav.classList.add('scrolled');
    } else {
      landingNav.classList.remove('scrolled');
    }
  });

  // Scroll reveal for lp-reveal elements
  const lpRevealObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry, i) => {
      if (entry.isIntersecting) {
        // Stagger siblings
        const siblings = entry.target.parentElement.querySelectorAll('.lp-reveal');
        let delay = 0;
        siblings.forEach(sib => {
          if (sib === entry.target) {
            setTimeout(() => sib.classList.add('visible'), delay);
          }
        });
        entry.target.classList.add('visible');
        lpRevealObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1, rootMargin: '0px 0px -60px 0px' });

  landingPage.querySelectorAll('.lp-reveal').forEach((el, i) => {
    el.style.transitionDelay = `${(i % 3) * 0.15}s`;
    lpRevealObserver.observe(el);
  });

  // Nav link smooth scroll
  landingPage.querySelectorAll('.landing-nav-link').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const sectionId = link.dataset.section;
      const target = document.getElementById('landing-' + sectionId);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });

  // CTA buttons -> transition to main app
  function landingToApp() {
    landingPage.classList.remove('active');
    document.body.classList.remove('landing-mode', 'locked');

    // Show splash briefly
    splashScreen.classList.add('active');
    setTimeout(() => {
      splashScreen.classList.add('fade-out');
    }, 1200);
    setTimeout(() => {
      splashScreen.remove();
    }, 2000);
  }

  document.getElementById('landing-start-btn').addEventListener('click', landingToApp);
  document.getElementById('landing-hero-cta').addEventListener('click', landingToApp);
  document.getElementById('landing-cta-btn').addEventListener('click', landingToApp);

  // "See how it works" scrolls to features
  document.getElementById('landing-hero-secondary').addEventListener('click', () => {
    const features = document.getElementById('landing-features');
    if (features) {
      features.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
}

// Init
buildGrid();
