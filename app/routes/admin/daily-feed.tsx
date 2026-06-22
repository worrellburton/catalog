// /admin/daily-feed — the home for the Daily Feed (each shopper's own
// custom, once-per-day personalized feed and everything that controls it).
//
// Everything it needs in one place:
//   • Settings & dials — master toggle, frequency, refresh hour, holdout %,
//     history window, min signal, and the ten weighted Feed Rules.
//   • Preview — pick a user to see their live feed, pick a past date to see
//     the feed they were served then, or view a cohort baseline.
//   • A pointer to the candidate pool / baseline (curated on /admin/catalogs).
//
// "Daily Feed" is the canonical name for this concept — see docs/daily-feed.md.

import DailyFeedSettings from '~/components/admin/DailyFeedSettings';
import DailyFeedPreview from '~/components/admin/DailyFeedPreview';

export default function AdminDailyFeed() {
  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <h1>Daily Feed</h1>
        <p className="admin-page-subtitle">
          Each signed-in shopper&apos;s own custom feed, re-ranked to their taste and
          refreshed once per day. Preview any shopper&apos;s feed (today or on a past
          day), then tune it below.
        </p>
      </div>

      {/* Preview first — it's the primary thing the admin reaches for; the
          dials live below it. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 1100 }}>
        <DailyFeedPreview />
        <DailyFeedSettings />
      </div>
    </div>
  );
}
