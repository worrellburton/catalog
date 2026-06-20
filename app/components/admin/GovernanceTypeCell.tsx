// Governance-aware TYPE · SUBTYPE cell for the /admin/data products table.
// The cell IS the connection to /admin/governance/types: a product type
// that matches a governance node renders as a governed pill (gender color
// dot, full path on hover); anything else — 'Other', legacy strings —
// flags amber as "not in governance". Clicking opens a panel that:
//   1. shows HOW the type was constructed (the derivation map) — what's
//      stored, the governance node it maps to, what the NAME infers (and
//      the exact keyword it matched), and what the image (Haiku) reads —
//      so a mis-type like "Premier Low Top → Top" is self-explaining;
//   2. lets you CHANGE the type (searchable tree picker, writes the same
//      type + gender + type_path cascade the brain writes) and the subtype.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { supabase } from '~/utils/supabase';
import {
  computeEffectiveGenders,
  computeTypePaths,
  fetchTypeTree,
  normalizeTypeName,
  type TypeNode,
} from '~/services/type-governance';
import { explainProductTypeInference } from '~/services/product-types';
import { haikuIdentity } from '~/utils/haiku';

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
  /** Finer classifier under the type — shown inline and editable here. */
  subtype?: string | null;
  /** Product name + image read — drive the derivation map (read-only). */
  name?: string | null;
  gender?: string | null;
  haikuContext?: string | null;
  /** Local-row sync after a successful type write. */
  onAssigned: (patch: GovernanceTypePatch) => void;
  /** Local-row sync after a successful subtype write. */
  onAssignedSubtype?: (subtype: string | null) => void;
  showToast: (msg: string) => void;
}

export default function GovernanceTypeCell({
  productId, type, subtype = null, name = null, gender = null, haikuContext = null,
  onAssigned, onAssignedSubtype, showToast,
}: Props) {
  const [tree, setTree] = useState<TypeNode[]>([]);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [subtypeDraft, setSubtypeDraft] = useState(subtype ?? '');
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => { void getTree().then(setTree); }, []);
  useEffect(() => { setSubtypeDraft(subtype ?? ''); }, [subtype]);
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

  // Derivation signals — what each source thinks this product is.
  const inference = useMemo(() => explainProductTypeInference(name), [name]);
  const haikuId = useMemo(() => haikuIdentity(haikuContext), [haikuContext]);

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
    if (error) { showToast(`Type update failed: ${error.message}`); return; }
    showToast(`Type → ${node.name}`);
    onAssigned(patch);
  };

  const saveSubtype = async () => {
    if (!supabase || saving) return;
    const v = subtypeDraft.trim() || null;
    if (v === (subtype ?? null)) return;
    setSaving(true);
    const { error } = await supabase.from('products').update({ subtype: v }).eq('id', productId);
    setSaving(false);
    if (error) { showToast(`Subtype update failed: ${error.message}`); return; }
    showToast(v ? `Subtype → ${v}` : 'Subtype cleared');
    onAssignedSubtype?.(v);
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
          ? `${paths.get(match.id)} — click for the derivation map`
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
        <span>{match ? match.name : type ? `⚠ ${type}` : ' - '}</span>
        {subtype && (
          <span style={{ color: '#0e7490', fontWeight: 600, fontSize: 10.5 }}>· {subtype}</span>
        )}
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 60,
          width: 320, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10,
          boxShadow: '0 12px 32px rgba(0,0,0,0.16)', padding: 10,
        }}>
          {/* ── Derivation map: how this type was constructed ── */}
          <div style={{
            fontSize: 9.5, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase',
            color: '#94a3b8', marginBottom: 6,
          }}>How this type was built</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginBottom: 4 }}>
            <DerivationRow label="Stored">
              <span style={{ fontWeight: 600, color: '#0f172a' }}>{type || '—'}</span>
              {subtype && <span style={{ color: '#0e7490' }}> · {subtype}</span>}
              {gender && <span style={{ color: '#64748b' }}> · {gender}</span>}
            </DerivationRow>
            <DerivationRow label="Governance">
              {match ? (
                <span style={{ color: '#334155' }}>{paths.get(match.id)}</span>
              ) : type ? (
                <span style={{ color: '#b45309' }}>⚠ “{type}” isn’t a governance node</span>
              ) : (
                <span style={{ color: '#cbd5e1' }}>—</span>
              )}
            </DerivationRow>
            <DerivationRow label="From name">
              {inference ? (
                <span style={{ color: '#334155' }}>
                  {inference.type}{inference.subtype ? ` / ${inference.subtype}` : ''}
                  <span style={{ color: '#94a3b8' }}>
                    {' '}— matched “<span style={{ color: '#dc2626', fontWeight: 600 }}>{inference.matchedText}</span>”
                  </span>
                </span>
              ) : (
                <span style={{ color: '#cbd5e1' }}>no keyword matched</span>
              )}
            </DerivationRow>
            <DerivationRow label="From image">
              {haikuId ? (
                <span style={{ color: '#334155', textTransform: 'capitalize' }}>{haikuId}</span>
              ) : (
                <span style={{ color: '#cbd5e1' }}>no Haiku read yet</span>
              )}
            </DerivationRow>
          </div>

          <div style={{ borderTop: '1px solid #f1f5f9', margin: '10px 0 8px' }} />

          {/* ── Change the type ── */}
          <div style={{ fontSize: 11, fontWeight: 700, color: '#0f172a', marginBottom: 6 }}>Change type</div>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Find a governance type…"
            style={{
              width: '100%', boxSizing: 'border-box', padding: '7px 10px', marginBottom: 6,
              borderRadius: 7, border: '1px solid #e5e7eb', fontSize: 12.5, fontFamily: 'inherit',
            }}
          />
          <div style={{ maxHeight: 180, overflowY: 'auto' }}>
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
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 140,
                }}>{paths.get(n.id)}</span>
              </button>
            ))}
            {options.length === 0 && (
              <p style={{ margin: 0, padding: '8px 6px', fontSize: 12, color: '#9ca3af' }}>
                No matching type — add it on the governance page first.
              </p>
            )}
          </div>

          {/* ── Subtype editor ── */}
          <div style={{ borderTop: '1px solid #f1f5f9', margin: '8px 0' }} />
          <div style={{ fontSize: 11, fontWeight: 700, color: '#0f172a', marginBottom: 6 }}>Subtype</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              value={subtypeDraft}
              onChange={e => setSubtypeDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void saveSubtype(); }}
              placeholder="e.g. Sneakers"
              style={{
                flex: 1, minWidth: 0, boxSizing: 'border-box', padding: '7px 10px',
                borderRadius: 7, border: '1px solid #e5e7eb', fontSize: 12.5, fontFamily: 'inherit',
              }}
            />
            <button
              type="button"
              disabled={saving || subtypeDraft.trim() === (subtype ?? '')}
              onClick={() => { void saveSubtype(); }}
              style={{
                padding: '0 12px', borderRadius: 7, border: 'none',
                background: subtypeDraft.trim() === (subtype ?? '') ? '#e2e8f0' : '#0e7490',
                color: subtypeDraft.trim() === (subtype ?? '') ? '#94a3b8' : '#fff',
                fontSize: 12, fontWeight: 700,
                cursor: subtypeDraft.trim() === (subtype ?? '') ? 'default' : 'pointer',
              }}
            >Save</button>
          </div>
        </div>
      )}
    </div>
  );
}

function DerivationRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 8, fontSize: 11.5, lineHeight: 1.35 }}>
      <span style={{ flexShrink: 0, width: 78, color: '#94a3b8', fontWeight: 600 }}>{label}</span>
      <span style={{ flex: 1, minWidth: 0 }}>{children}</span>
    </div>
  );
}
