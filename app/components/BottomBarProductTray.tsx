import { useEffect, useState } from 'react';
import { getHomeFeed, type ProductAd } from '~/services/product-creative';
import { withTransform } from '~/utils/supabase-image';

// A small grid of shoppable products shown in the TOP space of the mobile
// search overlay when the keyboard is down — otherwise that area is a big
// empty void above the catalog pills. Tapping a tile opens the product (open
// to guests too). Hidden while the keyboard is up (no room) and while the
// shopper is typing (the autocomplete takes over).

const MAX_TILES = 9;

// Module-level cache so reopening the search sheet doesn't refetch.
let cached: ProductAd[] | null = null;
let inflight: Promise<ProductAd[]> | null = null;

function loadTray(): Promise<ProductAd[]> {
  if (cached) return Promise.resolve(cached);
  if (inflight) return inflight;
  inflight = getHomeFeed({ ignoreGender: false })
    .then(list => {
      const withImg = list.filter(a =>
        a.product?.primary_image_url || a.product?.image_url || a.thumbnail_url || (a.product?.images && a.product.images[0]),
      );
      cached = withImg.slice(0, 24);
      return cached;
    })
    .catch(() => { inflight = null; return []; });
  return inflight;
}

function tileImage(ad: ProductAd): string {
  const raw =
    ad.product?.primary_image_url ||
    ad.product?.image_url ||
    ad.thumbnail_url ||
    (ad.product?.images && ad.product.images[0]) ||
    '';
  // SAME rendition params as the feed cards (CreativeCardV2's poster
  // transform), so these tiles are byte-identical URLs the feed already
  // fetched — instant HTTP-cache hits instead of cold full-res originals
  // trickling in one by one.
  return withTransform(raw, { width: 540, quality: 72, resize: 'contain' }) || raw;
}

export default function BottomBarProductTray({ onOpen }: { onOpen: (ad: ProductAd) => void }) {
  const [ads, setAds] = useState<ProductAd[]>(() => cached?.slice(0, MAX_TILES) ?? []);

  useEffect(() => {
    let cancelled = false;
    loadTray().then(list => { if (!cancelled) setAds(list.slice(0, MAX_TILES)); });
    return () => { cancelled = true; };
  }, []);

  if (ads.length === 0) return null;

  return (
    // preventDefault on mousedown so tapping a tile doesn't blur the search
    // input first (which would close the sheet before the click lands).
    <div className="bb-tray" onMouseDown={(e) => e.preventDefault()}>
      <div className="bb-tray-label">Shop the drop</div>
      <div className="bb-tray-grid">
        {ads.map(ad => {
          const img = tileImage(ad);
          return (
            <button
              key={ad.id}
              type="button"
              className="bb-tray-tile"
              onClick={() => onOpen(ad)}
              title={`${ad.product?.brand ? ad.product.brand + ' · ' : ''}${ad.product?.name || ''}`}
            >
              <span className="bb-tray-thumb">
                {img ? <img src={img} alt="" loading="eager" decoding="async" /> : null}
              </span>
              {ad.product?.brand && <span className="bb-tray-brand">{ad.product.brand}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
