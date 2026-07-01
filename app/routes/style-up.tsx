// /style-up — retired. The full StyleUp experience now lives entirely at
// /style (the "Find a stylist" picker replaces the old standalone roster).
// This route just redirects any old links there.
import { useEffect } from 'react';
import { useNavigate } from '@remix-run/react';

export default function StyleUpRedirect() {
  const navigate = useNavigate();
  useEffect(() => { navigate('/style', { replace: true }); }, [navigate]);
  return null;
}
