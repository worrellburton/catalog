// Public, fixed link for the short deck: catalog.shop/quickdeck.
//
// Unlike /admin/decks/:version (which exposes a version param a viewer could
// edit to reach other decks), this route is hard-wired to DeckViewV2 only -
// there's nothing in the URL to change, so a shared link can never be
// modified to surface another deck.
import '~/styles/deck-view.css';
import '~/styles/deck-v6.css';
import '~/styles/deck-v2.css';
import DeckViewV2 from '~/components/DeckViewV2';

export default function QuickDeck() {
  const noop = () => { /* the deck renders no back / theme / app CTAs */ };
  return (
    <DeckViewV2
      onSeeApp={noop}
      onVisitWebsite={noop}
      onBack={noop}
      isLightMode={false}
      onToggleTheme={noop}
    />
  );
}
