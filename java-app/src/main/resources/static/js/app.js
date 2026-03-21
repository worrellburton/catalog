document.addEventListener('DOMContentLoaded', function () {

    // --- IntersectionObserver for lazy-load and auto-play/pause ---
    const videoObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
            const video = entry.target;
            if (entry.isIntersecting) {
                if (video.preload === 'none') {
                    video.preload = 'metadata';
                    video.load();
                }
                video.play().catch(function () {});
            } else {
                video.pause();
            }
        });
    }, { threshold: 0.3 });

    document.querySelectorAll('.card-video').forEach(function (video) {
        videoObserver.observe(video);
    });

    // --- Scale slider ---
    var scaleSlider = document.getElementById('scaleSlider');
    var gridContainer = document.getElementById('gridContainer');

    scaleSlider.addEventListener('input', function () {
        var val = scaleSlider.value;
        gridContainer.style.setProperty('--grid-min', val + 'px');
    });

    // --- Search ---
    var searchInput = document.getElementById('searchInput');
    var cards = document.querySelectorAll('.look-card');

    searchInput.addEventListener('input', function () {
        var query = searchInput.value.toLowerCase().trim();
        cards.forEach(function (card) {
            var title = (card.getAttribute('data-title') || '').toLowerCase();
            var desc = (card.getAttribute('data-description') || '').toLowerCase();
            var creator = (card.getAttribute('data-creator-name') || '').toLowerCase();
            var gender = (card.getAttribute('data-gender') || '').toLowerCase();

            if (!query || title.indexOf(query) !== -1 || desc.indexOf(query) !== -1 ||
                creator.indexOf(query) !== -1 || gender.indexOf(query) !== -1) {
                card.classList.remove('hidden');
            } else {
                card.classList.add('hidden');
            }
        });
    });

    // --- Detail overlay ---
    var overlay = document.getElementById('detailOverlay');
    var overlayVideo = document.getElementById('overlayVideo');
    var overlayTitle = document.getElementById('overlayTitle');
    var overlayDescription = document.getElementById('overlayDescription');
    var overlayCreatorAvatar = document.getElementById('overlayCreatorAvatar');
    var overlayCreatorName = document.getElementById('overlayCreatorName');
    var productList = document.getElementById('productList');
    var overlayClose = document.getElementById('overlayClose');

    function openOverlay(card) {
        var title = card.getAttribute('data-title');
        var description = card.getAttribute('data-description');
        var creatorName = card.getAttribute('data-creator-name');
        var creatorAvatar = card.getAttribute('data-creator-avatar');
        var video = card.getAttribute('data-video');

        overlayTitle.textContent = title;
        overlayDescription.textContent = description;
        overlayCreatorAvatar.src = creatorAvatar;
        overlayCreatorName.textContent = creatorName;

        var videoSrc = '/videos/' + video;
        overlayVideo.src = videoSrc;
        overlayVideo.load();
        overlayVideo.play().catch(function () {});

        // Parse products from embedded JSON
        var productsHtml = '';
        var productDataEl = card.querySelector('.product-data');
        if (productDataEl) {
            try {
                var products = JSON.parse(productDataEl.textContent);
                products.forEach(function (p) {
                    productsHtml +=
                        '<div class="product-item">' +
                        '<a href="' + p.url + '" target="_blank" rel="noopener">' +
                        '<div><div class="product-name">' + p.name + '</div>' +
                        '<div class="product-brand">' + p.brand + '</div></div>' +
                        '<div class="product-price">' + p.price + '</div>' +
                        '</a></div>';
                });
            } catch (e) {
                console.error('Failed to parse product data', e);
            }
        }
        productList.innerHTML = productsHtml;

        overlay.classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    function closeOverlay() {
        overlay.classList.remove('active');
        overlayVideo.pause();
        overlayVideo.removeAttribute('src');
        document.body.style.overflow = '';
    }

    cards.forEach(function (card) {
        card.addEventListener('click', function () {
            openOverlay(card);
        });
    });

    overlayClose.addEventListener('click', function (e) {
        e.stopPropagation();
        closeOverlay();
    });

    overlay.addEventListener('click', function (e) {
        if (e.target === overlay) {
            closeOverlay();
        }
    });

    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && overlay.classList.contains('active')) {
            closeOverlay();
        }
    });
});
