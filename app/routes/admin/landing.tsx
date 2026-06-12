// Admin → Landing. The retired marketing landing page, preserved here
// (founder's call): catalog.shop opens straight into the feed now, but
// the landing lives on at /admin/landing for reference / future reuse.
// It renders exactly as it shipped — full-screen over the admin chrome
// (the component is position:fixed by design); browser Back returns to
// the admin.

import { useNavigate } from '@remix-run/react';
import LandingPage from '~/components/LandingPage';

export default function AdminLanding() {
  const navigate = useNavigate();
  return <LandingPage onStartBrowsing={() => navigate('/')} />;
}
