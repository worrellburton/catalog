// /style — the StyleUp landing page (catalog.shop/style), and the LAYOUT for
// every /style/* sub-page.
//
// A focused landing that features StyleUp as the headline experience: sign in,
// then chat with one of two stylists: Lena, who styles you head-to-toe from the
// Catalog collection, and Theo, who tracks down whatever you're picturing.
// Reuses the shared StyleUpExperience, scoped to the two landing stylists.
//
// The sub-pages (settings / apply / showroom / inbox) are CHILD routes, and
// deliberately so. They used to be `style_.settings.tsx` etc., where Remix v2's
// trailing `_` opts a flat route OUT of nesting — which made them siblings of
// this route, so opening Settings unmounted the whole experience and coming
// back re-ran the entire boot: ~13 Supabase round trips, a re-created WebGL
// context, and a stretch of "No conversations yet." before the list reappeared.
// That is the "getting back refreshing again" the app was reported for.
//
// As children they render into the <Outlet/> below while this route stays
// mounted, so Back costs nothing: the roster, the open thread, the transcript
// and the shopper's context are all still in memory. The experience is hidden
// rather than unmounted while a child is open — `display: none` keeps React
// state and the GL context alive, which is the entire point.
//
// (The previous AI-look studio that lived here now lives at /studio.)
import { Outlet, useLocation } from '@remix-run/react';
import { StyleUpExperience } from '~/components/style-up/StyleUpExperience';

export default function StyleLayoutRoute() {
  const { pathname } = useLocation();
  // Trailing slashes are stripped so `/style/` doesn't read as a child route.
  const childOpen = pathname.replace(/\/+$/, '') !== '/style';

  return (
    <>
      <div style={childOpen ? { display: 'none' } : undefined}>
        <StyleUpExperience
          landing
          landingOnly
          suspended={childOpen}
          landingTitle="Your AI stylist, on call"
          landingSubtitle="Two stylists, one chat. Lena pulls head-to-toe from the Catalog collection; Theo tracks down whatever you're picturing. Tell them your vibe and they put the look on you."
        />
      </div>
      <Outlet />
    </>
  );
}
