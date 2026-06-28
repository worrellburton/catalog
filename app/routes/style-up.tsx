// /style-up — the full StyleUp experience: the whole stylist roster + chat.
// The implementation lives in a shared component so the /style landing page can
// reuse it (scoped to its two featured stylists). See StyleUpExperience.
import { StyleUpExperience } from '~/components/style-up/StyleUpExperience';

export default function StyleUpRoute() {
  return <StyleUpExperience />;
}
