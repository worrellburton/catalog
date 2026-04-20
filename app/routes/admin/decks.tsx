import { Outlet } from '@remix-run/react';

// Layout shell for /admin/decks and /admin/decks/:version. Remix flat routes
// require this file to exist whenever decks._index.tsx or decks.$version.tsx
// are present — otherwise those children don't resolve and /admin/decks 404s.
export default function AdminDecksLayout() {
  return <Outlet />;
}
