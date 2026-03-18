// Password gate
const pwInput = document.getElementById('pw-input');
const pwError = document.getElementById('pw-error');
const pwGate = document.getElementById('password-gate');
const splashScreen = document.getElementById('splash-screen');
const PASSWORD = '123';

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

  if (val === PASSWORD) {
    pwError.textContent = '';
    pwGate.classList.add('dismissed');

    // Show splash
    splashScreen.classList.add('active');

    // After splash animations play, fade out and reveal app
    setTimeout(() => {
      splashScreen.classList.add('fade-out');
      document.body.classList.remove('locked');
    }, 3800);

    // Remove splash from DOM after fade
    setTimeout(() => {
      splashScreen.remove();
      pwGate.remove();
    }, 4600);
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

// Creator profiles with avatar colors (will use generated SVG avatars)
const creators = {
  '@lilywittman': { name: '@lilywittman', displayName: 'Lily Wittman', color: '#e8c4a0', initials: 'L' },
  '@garrett':     { name: '@garrett',     displayName: 'Garrett',      color: '#7ea8c4', initials: 'G' },
};

function avatarSvg(creator) {
  const c = creators[creator];
  if (!c) return '';
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 44 44"><circle cx="22" cy="22" r="22" fill="${c.color}"/><text x="22" y="23" text-anchor="middle" dominant-baseline="central" font-family="sans-serif" font-size="18" font-weight="600" fill="#fff">${c.initials}</text></svg>`)}`;
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
  if (activeFilter === 'all') return looks;
  return looks.filter(l => l.gender === activeFilter);
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

  // Let CSS auto-fill handle columns, but set minmax based on slider
  gridContainer.style.gridTemplateColumns = `repeat(auto-fill, minmax(${cardWidth}px, 1fr))`;

  const filtered = getFilteredLooks();
  if (filtered.length === 0) return;

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

// Open look detail
function openLook(look, index) {
  // Creator row
  const cInfo = creators[look.creator];
  detailCreator.innerHTML = `
    <div class="detail-creator-row" data-creator="${look.creator}">
      <img class="detail-creator-avatar" src="${avatarSvg(look.creator)}" alt="${look.creator}">
      <span class="detail-creator-name">${cInfo ? cInfo.displayName : look.creator}</span>
    </div>
  `;

  detailCreator.querySelector('.detail-creator-row').addEventListener('click', () => {
    closeLook();
    openCreatorPage(look.creator);
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
      <svg class="product-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
    </div>
  `).join('');

  // Make product items clickable
  detailProducts.querySelectorAll('.product-item').forEach(item => {
    item.addEventListener('click', (e) => {
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
  bottomSearchInput.value = '';
  bottomSearchInput.blur();
}

searchBackdrop.addEventListener('click', closeSearch);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && bottomBar.classList.contains('search-open')) {
    closeSearch();
  }
});

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

// View toggle (grid / feed)
const viewToggle = document.getElementById('view-toggle');
viewToggle.addEventListener('click', () => {
  document.body.classList.toggle('feed-mode');
});

// Theme toggle
const themeToggle = document.getElementById('theme-toggle');
themeToggle.addEventListener('click', () => {
  document.body.classList.toggle('light-mode');
});

// Deck: See MVP button → show app with back-to-deck
document.getElementById('deck-mvp-btn').addEventListener('click', () => {
  document.getElementById('deck-view').classList.remove('active');
  document.body.classList.remove('deck-mode');
  document.body.classList.remove('locked');
  document.body.classList.add('from-deck');
});

document.getElementById('back-to-deck').addEventListener('click', () => {
  document.getElementById('deck-view').classList.add('active');
  document.body.classList.add('deck-mode');
  document.body.classList.remove('from-deck');
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

// Init
buildGrid();
