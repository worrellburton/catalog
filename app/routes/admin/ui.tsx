// /admin/ui — UI customisation hub. Two subpages:
//   /admin/ui/brand       — typeface for the Catalog wordmark.
//   /admin/ui/search-bar  — animated beam variant for the bottom bar.
//
// The hub itself just renders the index card grid and the <Outlet />
// for nested subroutes. Black background per the design brief, soft
// inner gradients on the cards so the page reads as a control surface
// rather than a generic admin form.

import { useEffect } from 'react';
import { NavLink, Outlet, useNavigate } from '@remix-run/react';
import { useAuth } from '~/hooks/useAuth';

export default function AdminUiHub() {
  const { user } = useAuth();
  const navigate = useNavigate();

  // Same admin gate the rest of the surfaces use.
  useEffect(() => {
    if (!user) return;
    if (user.role !== 'admin' && user.role !== 'super_admin') {
      navigate('/admin', { replace: true });
    }
  }, [user, navigate]);

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
