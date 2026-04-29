// /admin/ui — UI customisation hub. Two subpages:
//   /admin/ui/brand       — typeface for the Catalog wordmark.
//   /admin/ui/search-bar  — animated beam variant for the bottom bar.
//
// The hub itself just renders the index card grid and the <Outlet />
// for nested subroutes. Black background per the design brief, soft
// inner gradients on the cards so the page reads as a control surface
// rather than a generic admin form.

import { useEffect } from 'react';
import { NavLink, Outlet } from '@remix-run/react';

export default function AdminUiHub() {
  // The /admin route layout already gates on a signed-in user; admin
  // status itself is driven by the is_admin flag on the profile (see
  // /admin/users), not the role text column. The previous role-string
  // check redirected legitimate admins whose primary role was still
  // 'shopper', leaving the UI page blank.

  // Pin a body-level class while this page is mounted so the sticky
  // admin topbar can pick a black opaque fill even on browsers / states
  // where :has() doesn't kick in reliably. Without this, scrolled page
  // content visibly bled through the topbar.
  useEffect(() => {
    document.documentElement.classList.add('admin-on-dark-canvas');
    return () => document.documentElement.classList.remove('admin-on-dark-canvas');
  }, []);

  return (
    <div className="admin-ui">
      <header className="admin-ui-header">
        <h1>UI</h1>
        <p className="admin-ui-sub">
          Customise how the app looks and feels. Changes apply
          everywhere instantly the moment you save.
        </p>
        <nav className="admin-ui-tabs" aria-label="UI sections">
          <NavLink end to="/admin/ui" className={({ isActive }) => `admin-ui-tab${isActive ? ' is-active' : ''}`}>
            Overview
          </NavLink>
          <NavLink to="/admin/ui/brand" className={({ isActive }) => `admin-ui-tab${isActive ? ' is-active' : ''}`}>
            Brand
          </NavLink>
          <NavLink to="/admin/ui/search-bar" className={({ isActive }) => `admin-ui-tab${isActive ? ' is-active' : ''}`}>
            Search bar
          </NavLink>
        </nav>
      </header>

      <Outlet />
    </div>
  );
}
