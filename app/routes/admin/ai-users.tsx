import { useEffect } from 'react';
import { useNavigate } from '@remix-run/react';

/**
 * Legacy /admin/ai-users → redirects to /admin/users?tab=ai.
 *
 * AI personas used to live on their own page; they're now a 4th tab
 * inside /admin/users so admins see the full user surface in one
 * place. Keeping the route around so existing bookmarks and the
 * cmd-K search alias still land on the right place.
 */
export default function AdminAiUsersRedirect() {
  const navigate = useNavigate();
  useEffect(() => {
    navigate('/admin/users?tab=ai', { replace: true });
  }, [navigate]);
  return (
    <div className="admin-page">
      <p className="admin-empty">Redirecting to the AI tab in Users…</p>
    </div>
  );
}
