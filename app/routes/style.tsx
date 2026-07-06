// /style — the StyleUp landing page (catalog.shop/style).
//
// A focused landing that features StyleUp as the headline experience: sign in,
// then chat with one of two stylists: Lena, who styles you head-to-toe from the
// Catalog collection, and Theo, who tracks down whatever you're picturing.
// Reuses the shared StyleUpExperience, scoped to the two landing stylists.
//
// (The previous AI-look studio that lived here now lives at /studio.)
import { StyleUpExperience } from '~/components/style-up/StyleUpExperience';

export default function StyleLandingRoute() {
  return (
    <StyleUpExperience
      landing
      landingOnly
      landingTitle="Your AI stylist, on call"
      landingSubtitle="Two stylists, one chat. Lena pulls head-to-toe from the Catalog collection; Theo tracks down whatever you're picturing. Tell them your vibe and they put the look on you."
    />
  );
}
