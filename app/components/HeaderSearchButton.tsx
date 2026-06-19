// Mobile-only header search button. On phones the resting bottom search pill
// is removed from the searched feed (it frosted a white strip behind the iOS
// Safari toolbar and crowded the results), so search moves up into the header,
// taking the slot the Activity pill used to occupy.
//
// Tapping it opens the BottomBar search sheet by dispatching the
// `catalog:open-search` event — the mirror of the existing
// `catalog:close-search` bridge. BottomBar keeps owning all the search state,
// so nothing has to be lifted into _index.

export default function HeaderSearchButton() {
  const openSearch = () => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent('catalog:open-search'));
  };

  return (
    <button
      type="button"
      className="header-search-btn"
      onClick={openSearch}
      aria-label="Search"
      title="Search"
    >
      <svg
        width="17"
        height="17"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="11" cy="11" r="7" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
    </button>
  );
}
