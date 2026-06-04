/* Comment thread deep-link: /comments/p/<slug> or /comments/l/<slug>.
 *
 * Re-exports _index (same as p.$slug / l.$slug) so a cold load mounts the
 * home component — which reads the /comments/ URL on mount and opens the
 * comment overlay on top. Avoids shipping a separate route chunk that a
 * deep cold-load would fail to fetch (the chunk request fell back to
 * index.html → "'text/html' is not a valid JavaScript MIME type"). */
export { default } from './_index';
