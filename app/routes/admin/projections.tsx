import { useEffect } from 'react';
import { useNavigate } from '@remix-run/react';

// Projections moved under the financial Model page as its first tab.
// This route is kept as a redirect so old bookmarks, the deck's
// "/admin/projections" references and cmd-K muscle memory still resolve.
export default function AdminProjectionsRedirect() {
  const navigate = useNavigate();
  useEffect(() => {
    navigate('/admin/model', { replace: true });
  }, [navigate]);
  return null;
}
