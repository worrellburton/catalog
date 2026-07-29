// Admin · Pipeline — settings hub for the scrape → verify → creative →
// publish pipeline. Placeholder: Task 11 replaces this with the real
// settings form (kill-switch, per-stage toggles, budget caps).

import { Link } from '@remix-run/react';

export default function Pipeline() {
  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <h1>Pipeline</h1>
        <p className="admin-page-subtitle">Settings arrive in a later task.</p>
      </div>
      <Link to="/admin/pipeline/health" className="admin-btn admin-btn-primary">
        View pipeline health →
      </Link>
    </div>
  );
}
