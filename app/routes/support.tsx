// /support — the App Store Connect Support URL destination.
import { useNavigate } from '@remix-run/react';
import SupportPage from '~/components/SupportPage';

export default function SupportRoute() {
  const navigate = useNavigate();
  // Back into the app if we came from it; otherwise home (direct/external landing).
  const onClose = () => (window.history.length > 1 ? navigate(-1) : navigate('/'));
  return <SupportPage onClose={onClose} />;
}
