// /style — the StyleUp landing page (catalog.shop/style).
//
// A focused landing that features StyleUp as the headline experience: sign in,
// then chat with one of two stylists — Lena, who styles you head-to-toe from
// our own catalog, and Theo, who hunts the open web for exactly what you want.
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
      landingSubtitle="Two stylists, one chat. Lena pulls head-to-toe from the Catalog collection; Theo hunts the whole web. Tell them your vibe — they put the look on you."
    />
  );
}
