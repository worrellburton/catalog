// /privacy — dedicated, shareable URL for the Privacy Policy.
// Same content as the in-profile overlay; reuses LegalPage verbatim.
import { useNavigate } from '@remix-run/react';
import LegalPage from '~/components/LegalPage';

export default function PrivacyRoute() {
  const navigate = useNavigate();
  // Back into the app if we came from it; otherwise home (direct/external landing).
  const onClose = () => (window.history.length > 1 ? navigate(-1) : navigate('/'));
  return <LegalPage kind="privacy" onClose={onClose} />;
}
