// /admin/governance/users — the user brain. The population as a radial
// constellation on the particle universe: users at the centre, one node
// per country, gender-split arcs, avatars in orbit. Toggles segment the
// whole brain live (All / Men / Women × age cohorts); click a country to
// drill into everyone inside it. Read-only: editing users stays in
// /admin/users.

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from '@remix-run/react';
import ParticleBackground from '~/components/ParticleBackground';
import UserBrainGraph, { type CountryCluster } from '~/components/admin/UserBrainGraph';
import {
  AGE_COHORTS, ageCohort, countryFlag, countryName, fetchGovernanceUsers,
  type AgeCohort, type GovernanceUser,
} from '~/services/user-governance';
import '~/styles/governance.css';

type GenderFilter = 'all' | 'male' | 'female';
type AgeFilter = 'all' | AgeCohort;

export default function AdminGovernanceUsers() {
  const navigate = useNavigate();
  const [users, setUsers] = useState<GovernanceUser[]>([]);
  const [gender, setGender] = useState<GenderFilter>('all');
  const [age, setAge] = useState<AgeFilter>('all');
  const [drill, setDrill] = useState<{ code: string | null } | null>(null);

  useEffect(() => { void fetchGovernanceUsers().then(setUsers); }, []);

  // Same blacked-out chrome as the type brain — this page is its own world.
  useEffect(() => {
    document.documentElement.classList.add('admin-on-dark-canvas', 'gov-void');
    return () => document.documentElement.classList.remove('admin-on-dark-canvas', 'gov-void');
  }, []);
  useEffect(() => {
    if (!drill) return;
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') setDrill(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drill]);

  const filtered = useMemo(() => users.filter(u =>
    (gender === 'all' || u.gender === gender)
    && (age === 'all' || ageCohort(u.age) === age)
  ), [users, gender, age]);

  // Country clusters, biggest first; profiles never geo-located pool in
  // the Unknown bucket so nobody silently disappears from the brain.
  const clusters = useMemo<CountryCluster[]>(() => {
    const byCode = new Map<string, GovernanceUser[]>();
    for (const u of filtered) {
      const k = u.country ?? '';
      byCode.set(k, [...(byCode.get(k) ?? []), u]);
    }
    return [...byCode.entries()]
      .map(([k, us]) => ({ code: k || null, users: us }))
      .sort((a, b) => b.users.length - a.users.length);
  }, [filtered]);

  const stats = useMemo(() => {
    const male = filtered.filter(u => u.gender === 'male').length;
    const female = filtered.filter(u => u.gender === 'female').length;
    const ages = filtered.map(u => u.age).filter((n): n is number => n !== null).sort((a, b) => a - b);
    const median = ages.length ? ages[Math.floor(ages.length / 2)] : null;
    const top = clusters.find(c => c.code !== null);
    return { male, female, median, top };
  }, [filtered, clusters]);

  const drillUsers = drill ? filtered.filter(u => (u.country ?? null) === drill.code) : [];

  return (
    <div className="gov-page gov-types">
      <div className="gov-universe" aria-hidden="true">
        <ParticleBackground />
      </div>

      <div className="gov-canvas">
        <div className="gov-controls-row gov-canvas-controls">
          {/* Gender toggles — the founder's lens: men / women */}
          <div className="gov-seg" role="group" aria-label="Gender">
            {([['all', 'Everyone'], ['male', 'Men'], ['female', 'Women']] as const).map(([k, label]) => (
              <button key={k} type="button" className={gender === k ? 'is-active' : ''}
                onClick={() => setGender(k)}>{label}</button>
            ))}
          </div>
          {/* Age cohorts */}
          <div className="gov-seg" role="group" aria-label="Age">
            <button type="button" className={age === 'all' ? 'is-active' : ''} onClick={() => setAge('all')}>All ages</button>
            {AGE_COHORTS.map(c => (
              <button key={c.key} type="button" className={age === c.key ? 'is-active' : ''}
                onClick={() => setAge(c.key)}>{c.label}</button>
            ))}
          </div>
          {/* Live read of the segment in view */}
          <span className="ub-stats">
            {filtered.length} in view · ♂ {stats.male} · ♀ {stats.female}
            {stats.median !== null && <> · median age {stats.median}</>}
            {stats.top && <> · top: {countryName(stats.top.code)}</>}
          </span>
        </div>

        <UserBrainGraph clusters={clusters} total={filtered.length} onDrill={code => setDrill({ code })} />
      </div>

      {/* Country drill — everyone inside, with the active toggles applied */}
      {drill && (
        <div className="gov-audit">
          <div className="gov-audit-head">
            <div>
              <h2>{countryFlag(drill.code)} {countryName(drill.code)}</h2>
              <span>
                {drillUsers.length} user{drillUsers.length === 1 ? '' : 's'}
                {gender !== 'all' || age !== 'all' ? ' in this segment' : ''}
                {drill.code === null && ' — no geo signal yet; they place themselves at next sign-in'}
              </span>
            </div>
            <button type="button" className="gov-ghost" onClick={() => setDrill(null)}>✕ Close</button>
          </div>
          <div className="gov-audit-list">
            {drillUsers.map(u => (
              <button key={u.id} type="button" className="gov-audit-row ub-user-row"
                onClick={() => navigate(`/admin/user/${u.id}`)}>
                <span className="gov-audit-thumb" style={{ borderRadius: '50%' }}>
                  {u.avatar ? <img src={u.avatar} alt="" loading="lazy" decoding="async" /> : <i>{u.name.slice(0, 2)}</i>}
                </span>
                <span className="gov-audit-prod">
                  <strong>{u.name}</strong>
                  {u.email && u.email !== u.name && <small>{u.email}</small>}
                </span>
                <span className="ub-user-meta">
                  <b className={`ub-g-${u.gender}`}>{u.gender === 'male' ? '♂ male' : u.gender === 'female' ? '♀ female' : '— gender unknown'}</b>
                  <i>{u.ageLabel ? `age ${u.ageLabel}` : 'age unknown'}</i>
                  {u.isAdmin && <em>admin</em>}
                  {u.isAi && <em>AI</em>}
                  <small>
                    {u.lastSeenAt ? `seen ${new Date(u.lastSeenAt).toLocaleDateString()}` : 'never signed in'}
                  </small>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
