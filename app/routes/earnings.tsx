/* Insights / Earnings URL: /earnings.
 *
 * Re-exports the home Index component so the entire feed renders just
 * like / does. Index detects window.location.pathname === '/earnings'
 * and opens the wallet (insights + earnings) overlay on top. Browser
 * back pops the history entry, returning the user to whatever in-app
 * screen they came from — never bouncing to an external site. */
export { default } from './_index';
