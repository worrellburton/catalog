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

import { Link } from '@remix-run/react';
import DailyFeedSettings from '~/components/admin/DailyFeedSettings';
import DailyFeedPreview from '~/components/admin/DailyFeedPreview';

export default function AdminDailyFeed() {
  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <h1>Daily Feed</h1>
        <p className="admin-page-subtitle">
          Each signed-in shopper&apos;s own custom feed, re-ranked to their taste and
          refreshed once per day. Tune it here, and preview any shopper&apos;s feed
          (today or on a past day).
        </p>
      </div>

      <div
        style={{
          fontSize: 12.5, color: '#475569', background: '#fffbeb',
          border: '1px solid #fde68a', borderRadius: 10, padding: '10px 14px',
          marginBottom: 18, maxWidth: 1100,
        }}
      >
        The <strong>candidate pool &amp; baseline order</strong> (what a brand-new
        shopper sees, and the starting point every Daily Feed re-ranks from) is the{' '}
        <strong>home</strong> catalog —{' '}
        <Link to="/admin/catalogs/home" style={{ color: '#1d4ed8', fontWeight: 600 }}>
          curate it on the Catalogs page →
        </Link>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 1100 }}>
        <DailyFeedSettings />
        <DailyFeedPreview />
      </div>
    </div>
  );
}
