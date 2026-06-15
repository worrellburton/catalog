/* Null child for the persistent consumer-app shell (routes/_index.tsx).
 *
 * The real UI is the parent layout (Home). These stub children exist only so
 * the index ("/") and every shareable deep-link (/p/, /l/, /b/, /comments/,
 * /earnings, /my-looks) resolve to the SAME mounted parent — Home reads
 * location.pathname to open the matching overlay. Because the parent is shared,
 * back/forward navigation between these URLs swaps only this (null) child and
 * never remounts the shell, so the in-memory detail stack + layered overlays
 * survive. See vite.config.ts → routes() for the wiring. */
export default function AppShellStub() {
  return null;
}
