// Governance-aware TYPE cell for the /admin/data products table.
// The cell IS the connection to /admin/governance/types: a product type
// that matches a governance node renders as a governed pill (gender color
// dot, full path on hover); anything else — 'Other', legacy strings —
// flags amber as "not in governance". Clicking opens a searchable picker
// of the live tree; assigning writes the SAME cascade the brain writes
// (products.type + gender + type_path), so the two screens never drift.

import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '~/utils/supabase';
import {
  computeEffectiveGenders,
  computeTypePaths,
  fetchTypeTree,
  normalizeTypeName,
  type TypeNode,
} from '~/services/type-governance';

const GENDER_COLORS: Record<string, string> = {
  male: '#60a5fa', female: '#f472b6', unisex: '#34d399',
};

// One tree fetch shared by every cell on the page (hundreds of rows).
let treePromise: Promise<TypeNode[]> | null = null;
function getTree(): Promise<TypeNode[]> {
  if (!treePromise) treePromise = fetchTypeTree();
  return treePromise;
}

export interface GovernanceTypePatch {
  type: string;
  gender: 'male' | 'female' | 'unisex' | null;
  type_path: string | null;
}

interface Props {
  productId: string;
  type: string | null;
  /** Local-row sync after a successful write. */
  onAssigned: (patch: GovernanceTypePatch) => void;
  showToast: (msg: string) => void;
}

export default function GovernanceTypeCell({ productId, type, onAssigned, showToast }: Props) {
  const [tree, setTree] = useState<TypeNode[]>([]);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => { void getTree().then(setTree); }, []);
  useEffect(() => {
    if (!open) return;
    const onDoc = (ev: MouseEvent) => {
      if (!wrapRef.current?.contains(ev.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const paths = useMemo(() => computeTypePaths(tree), [tree]);
  const genders = useMemo(() => computeEffectiveGenders(tree), [tree]);
  const match = useMemo(() => {
    if (!type) return null;
    const norm = normalizeTypeName(type);
    return tree.find(n => normalizeTypeName(n.name) === norm) ?? null;
  }, [tree, type]);

  const assign = async (node: TypeNode) => {
    if (!supabase || saving) return;
    setSaving(true);
    const patch: GovernanceTypePatch = {
      type: node.name,
      // The effective-gender map widens to string; values originate from
      // TypeNode.gender, so the narrow union is safe.
      gender: (genders.get(node.id) ?? null) as GovernanceTypePatch['gender'],
      type_path: paths.get(node.id) ?? null,
    };
    const { error } = await supabase.from('products').update(patch).eq('id', productId);
    setSaving(false);
    setOpen(false);
    setQuery('');
    if (error) { showToast(`Type update failed: ${error.message}`); return; }
    showToast(`Type → ${node.name}`);
    onAssigned(patch);
  };

  const q = query.trim().toLowerCase();
  const options = tree.filter(n =>
    !q || n.name.toLowerCase().includes(q) || (paths.get(n.id) ?? '').toLowerCase().includes(q));

  return (
    <div ref={wrapRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        title={match
          ? `${paths.get(match.id)} — click to change`
          : type
            ? `“${type}” is not in governance — click to assign a real type`
            : 'No type — click to assign'}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '2px 8px', borderRadius: 999, cursor: 'pointer',
          border: '1px solid transparent', fontWeight: 500, fontSize: 11, fontFamily: 'inherit',
          background: match ? '#f1f5f9' : type ? '#fef3c7' : '#fafafa',
          color: match ? '#334155' : type ? '#92400e' : '#cbd5e1',
        }}
      >
        {match && (
          <i style={{
            width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
            background: GENDER_COLORS[genders.get(match.id) ?? ''] ?? '#cbd5e1',
          }} />
        )}
        {match ? match.name : type ? `⚠ ${type}` : ' - '}
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 60,
          width: 260, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10,
          boxShadow: '0 12px 32px rgba(0,0,0,0.16)', padding: 8,
        }}>
          <input
            autoFocus
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Find a governance type…"
            style={{
              width: '100%', boxSizing: 'border-box', padding: '7px 10px', marginBottom: 6,
              borderRadius: 7, border: '1px solid #e5e7eb', fontSize: 12.5, fontFamily: 'inherit',
            }}
          />
          <div style={{ maxHeight: 220, overflowY: 'auto' }}>
            {options.map(n => (
              <button
                key={n.id}
                type="button"
                disabled={saving}
                onClick={() => { void assign(n); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 7, width: '100%',
                  textAlign: 'left', padding: '6px 8px', borderRadius: 6,
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  fontSize: 12.5, color: '#111', fontFamily: 'inherit',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = '#f3f4f6')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <i style={{
                  width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                  background: GENDER_COLORS[genders.get(n.id) ?? ''] ?? '#cbd5e1',
                }} />
                <span style={{ fontWeight: 600, textTransform: 'capitalize' }}>{n.name}</span>
                <span style={{
                  marginLeft: 'auto', fontSize: 10, color: '#9ca3af',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 120,
                }}>{paths.get(n.id)}</span>
              </button>
            ))}
            {options.length === 0 && (
              <p style={{ margin: 0, padding: '8px 6px', fontSize: 12, color: '#9ca3af' }}>
                No matching type — add it on the governance page first.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
