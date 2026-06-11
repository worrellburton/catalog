// /admin/governance — the data-governance hub. Each card is a governed
// structure that updates every product it touches; Types (the type brain)
// is the first. New governance areas land here as more cards.

import { useEffect, useState } from 'react';
import { Link } from '@remix-run/react';
import { fetchGovernanceProducts, fetchTypeTree } from '~/services/type-governance';
import { fetchGovernanceUsers } from '~/services/user-governance';
import '~/styles/governance.css';

export default function AdminGovernance() {
  const [counts, setCounts] = useState<{ types: number; products: number; users: number; countries: number } | null>(null);
  useEffect(() => {
    void (async () => {
      const [tree, products, users] = await Promise.all([
        fetchTypeTree(), fetchGovernanceProducts(), fetchGovernanceUsers(),
      ]);
      setCounts({
        types: tree.length, products: products.length, users: users.length,
        countries: new Set(users.map(u => u.country).filter(Boolean)).size,
      });
    })();
  }, []);

  return (
    <div className="gov-page gov-hub">
      {/* div, not <header> — the consumer header.css styles the header ELEMENT
          globally (position:fixed), which would yank this out of flow. */}
      <div className="gov-head">
        <div>
          <p className="gov-kicker">Governance</p>
          <h1>Data governance</h1>
          <p className="gov-sub">
            The structures behind the catalog. Edit a structure here and every product
            attached to it updates with it — one source of truth, governed in one place.
          </p>
        </div>
      </div>

      <div className="gov-cards">
        <Link to="/admin/governance/types" className="gov-card">
          <svg viewBox="0 0 48 48" aria-hidden="true">
            <circle cx="24" cy="24" r="5" />
            <circle cx="10" cy="12" r="3.4" /><circle cx="38" cy="10" r="3.4" />
            <circle cx="8" cy="34" r="3.4" /><circle cx="40" cy="36" r="3.4" />
            <circle cx="24" cy="6" r="2.4" />
            <path d="M24 19v-9M20 21 13 14M28 21l7-9M20 27 11 33M28 27l9 7" fill="none" />
          </svg>
          <h2>Types — set up for more possibilities</h2>
          <p>
            The type brain: catalog at the centre, fashion and electronics branching out,
            gender lanes color-coded. Drag to restructure — every attached product follows.
          </p>
          <span className="gov-card-meta">
            {counts ? `${counts.types} types · ${counts.products} products governed` : '…'}
          </span>
        </Link>

        <Link to="/admin/governance/users" className="gov-card">
          <svg viewBox="0 0 48 48" aria-hidden="true">
            <circle cx="24" cy="24" r="6" />
            <circle cx="9" cy="14" r="3.4" /><circle cx="39" cy="14" r="3.4" />
            <circle cx="9" cy="36" r="3.4" /><circle cx="39" cy="36" r="3.4" />
            <path d="M19 21 12 16M29 21l7-5M19 27l-7 7M29 27l7 7" fill="none" />
          </svg>
          <h2>Users — the population as a constellation</h2>
          <p>
            The user brain: everyone orbiting by country, gender-split rings, age cohorts.
            Toggle men / women / age and drill into any country.
          </p>
          <span className="gov-card-meta">
            {counts ? `${counts.users} users · ${counts.countries} countr${counts.countries === 1 ? 'y' : 'ies'} located` : '…'}
          </span>
        </Link>

        <div className="gov-card is-ghost" aria-disabled="true">
          <h2>More structures</h2>
          <p>Brands, materials, sizes — future governance areas land here.</p>
        </div>
      </div>
    </div>
  );
}
