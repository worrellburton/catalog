// imports
import { useEffect, useMemo, useState } from 'react';
import DirectoryPage from './DirectoryPage';
import GenderLens from './GenderLens';
import TypeIcon from './TypeIcon';
import { listDirectoryTypes, type DirectoryGender, type DirectoryType } from '~/services/directory';

// types
interface ProductsDirectoryProps {
  gender: DirectoryGender;
  onChangeGender: (g: DirectoryGender) => void;
  onOpenType: (type: DirectoryType) => void;
  onClose: () => void;
}

// helpers
export function groupByDepartment(types: DirectoryType[], lens: DirectoryGender): Array<{ department: string; types: DirectoryType[] }> {
  const groups: Array<{ department: string; types: DirectoryType[] }> = [];
  for (const t of types) {
    if (t.counts[lens] === 0) continue;
    let g = groups.find(x => x.department === t.department);
    if (!g) { g = { department: t.department, types: [] }; groups.push(g); }
    g.types.push(t);
  }
  return groups;
}

// main logic
export default function ProductsDirectory({ gender, onChangeGender, onOpenType, onClose }: ProductsDirectoryProps) {
  const [types, setTypes] = useState<DirectoryType[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    listDirectoryTypes().then(t => { if (!cancelled) setTypes(t); });
    return () => { cancelled = true; };
  }, []);

  const groups = useMemo(() => groupByDepartment(types ?? [], gender), [types, gender]);
  const total = useMemo(() => (types ?? []).reduce((n, t) => n + t.counts[gender], 0), [types, gender]);
  const lensCounts = useMemo(() => ({
    all: (types ?? []).reduce((n, t) => n + t.counts.all, 0),
    women: (types ?? []).reduce((n, t) => n + t.counts.women, 0),
    men: (types ?? []).reduce((n, t) => n + t.counts.men, 0),
  }), [types]);

  return (
    <DirectoryPage
      eyebrow="Directory"
      title="Products"
      meta={types ? `${total} ${total === 1 ? 'product' : 'products'} across ${groups.reduce((n, g) => n + g.types.length, 0)} types` : 'Loading…'}
      aside={<GenderLens value={gender} onChange={onChangeGender} counts={types ? lensCounts : undefined} />}
      onClose={onClose}
    >
      {types === null ? (
        <div className="dir-grid dir-grid--types" aria-hidden="true">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="dir-type dir-skeleton" />)}
        </div>
      ) : groups.map(g => (
        <section key={g.department} className="dir-section">
          <h2 className="dir-section-title">{g.department}</h2>
          <div className="dir-grid dir-grid--types">
            {g.types.map(t => (
              <button key={t.id} type="button" className="dir-type" onClick={() => onOpenType(t)}>
                <span className="dir-type-icon"><TypeIcon path={t.iconPath} size={36} /></span>
                <span className="dir-name">{t.name}</span>
                <span className="dir-soft">{t.counts[gender]} {t.counts[gender] === 1 ? 'product' : 'products'}</span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </DirectoryPage>
  );
}
