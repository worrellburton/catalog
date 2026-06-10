/* My Catalog URL: /my-looks.
 *
 * Re-exports the home Index component so the whole feed renders like /
 * does. Index detects window.location.pathname.startsWith('/my-looks')
 * on cold load and opens the My Catalog overlay on top — so refreshing
 * or deep-linking here no longer 404s to a blank page. */
export { default } from './_index';
