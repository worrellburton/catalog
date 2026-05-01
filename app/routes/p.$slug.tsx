/* Product share URL: /p/<slug>.
 *
 * Re-exports the home Index component so the entire feed renders
 * exactly as it does at /. Index reads useParams().slug and opens
 * the product detail modal on top. In-app navigation uses
 * history.pushState to avoid a full remount; this route is only
 * hit on fresh loads / pastes / external links. */
export { default } from './_index';
