import { Look, Product } from '~/data/looks';
import { type ProductAd } from '~/services/product-creative';
import SavedScreen from './SavedScreen';

interface BookmarksInterface {
  bookmarkedLooks: number[];
  bookmarkedProducts: Product[];
  followedCreators: string[];
  isLookBookmarked: (lookId: number) => boolean;
  toggleLookBookmark: (lookId: number) => void;
  isProductBookmarked: (p: Product) => boolean;
  toggleProductBookmark: (p: Product) => void;
  isCreatorFollowed: (handle: string) => boolean;
  toggleCreatorFollow: (handle: string) => void;
}

interface BookmarksPageProps {
  bookmarks: BookmarksInterface;
  onClose: () => void;
  onOpenLook: (look: Look) => void;
  onOpenBrowser: (url: string, title: string) => void;
  onOpenProduct?: (product: Product) => void;
  onOpenCreative?: (creative: ProductAd) => void;
  onOpenCreator?: (handle: string) => void;
  onOpenBrand?: (brandName: string) => void;
  savedLooks?: Look[];
}

/**
 * The saved button opens this full-page surface. The UI now lives in the
 * shared SavedScreen component (also embedded in My Account + My Catalog);
 * this adapter just maps the overlay-router props onto it.
 */
export default function BookmarksPage({ savedLooks = [], ...props }: BookmarksPageProps) {
  return <SavedScreen {...props} savedLooks={savedLooks} />;
}
