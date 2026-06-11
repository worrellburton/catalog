// User-governance data layer — feeds the user brain
// (/admin/governance/users): every profile with the segmentation
// attributes the brain filters on (gender, age cohort, country).

import { supabase } from '~/utils/supabase';

export interface GovernanceUser {
  id: string;
  name: string;
  email: string | null;
  avatar: string | null;
  gender: 'male' | 'female' | 'unknown';
  /** Free-text label ('25', 'mid 30s') — parsed into `age`. */
  ageLabel: string | null;
  age: number | null;
  /** ISO alpha-2, uppercase, or null when never inferred. */
  country: string | null;
  isAdmin: boolean;
  isAi: boolean;
  createdAt: string | null;
  lastSeenAt: string | null;
}

export type AgeCohort = 'under25' | '25to34' | '35plus' | 'unknown';

export const AGE_COHORTS: { key: AgeCohort; label: string }[] = [
  { key: 'under25', label: 'Under 25' },
  { key: '25to34', label: '25–34' },
  { key: '35plus', label: '35+' },
  { key: 'unknown', label: 'Age unknown' },
];

/** 'mid 30s' → 35, 'early 30s' → 32, 'late 30s' → 38, '25' → 25. */
export function parseAgeLabel(label: string | null): number | null {
  if (!label) return null;
  const m = label.match(/\d+/);
  if (!m) return null;
  const n = parseInt(m[0], 10);
  if (!Number.isFinite(n)) return null;
  const l = label.toLowerCase();
  if (l.includes('early')) return n + 2;
  if (l.includes('mid')) return n + 5;
  if (l.includes('late')) return n + 8;
  return n;
}

export function ageCohort(age: number | null): AgeCohort {
  if (age === null) return 'unknown';
  if (age < 25) return 'under25';
  if (age < 35) return '25to34';
  return '35plus';
}

export function countryName(code: string | null): string {
  if (!code) return 'Unknown';
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code;
  } catch { return code; }
}

/** 'US' → 🇺🇸 via regional-indicator code points. */
export function countryFlag(code: string | null): string {
  if (!code || !/^[A-Z]{2}$/i.test(code)) return '🌐';
  return String.fromCodePoint(...[...code.toUpperCase()].map(c => 0x1f1e6 + c.charCodeAt(0) - 65));
}

export async function fetchGovernanceUsers(): Promise<GovernanceUser[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, email, avatar_url, gender, age_label, country, is_admin, is_ai, created_at, last_sign_in_at')
    .order('created_at', { ascending: true })
    .limit(5000);
  if (error || !data) return [];
  return (data as Array<{
    id: string; full_name: string | null; email: string | null; avatar_url: string | null;
    gender: string | null; age_label: string | null; country: string | null;
    is_admin: boolean | null; is_ai: boolean | null; created_at: string | null; last_sign_in_at: string | null;
  }>).map(r => {
    const age = parseAgeLabel(r.age_label);
    return {
      id: r.id,
      name: r.full_name || r.email || r.id.slice(0, 8),
      email: r.email,
      avatar: r.avatar_url,
      gender: r.gender === 'male' || r.gender === 'female' ? r.gender : 'unknown',
      ageLabel: r.age_label,
      age,
      country: r.country ? r.country.toUpperCase() : null,
      isAdmin: !!r.is_admin,
      isAi: !!r.is_ai,
      createdAt: r.created_at,
      lastSeenAt: r.last_sign_in_at,
    };
  });
}
