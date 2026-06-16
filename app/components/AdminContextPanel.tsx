// Super-admin context panel — opened by the invisible middle-left tap zone on
// the product & look detail heroes (mirrors the middle-right delete zone).
// Shows the item's editable taxonomy metadata (gender + type/subtype) and a
// conversational Kaizen that explains WHY the item is placed/shows where it is
// and proposes type/gender changes the admin applies with one tap.

import { useState, useRef, useEffect, useCallback } from 'react';
import { supabase } from '~/utils/supabase';
import '~/styles/admin-context.css';

type Kind = 'product' | 'look';

interface Props {
  kind: Kind;
  id: string;
  /** Title-only context (name/brand) for the panel header. */
  title?: string | null;
  subtitle?: string | null;
  onClose: () => void;
}

interface ChatMsg { role: 'user' | 'assistant'; content: string; changes?: Record<string, string> | null }

export default function AdminContextPanel({ kind, id, title, subtitle, onClose }: Props) {
  const table = kind === 'product' ? 'products' : 'looks';
  const [gender, setGender] = useState('');
  const [type, setType] = useState('');
  const [subtype, setSubtype] = useState('');
  const [typePath, setTypePath] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Pull the LIVE metadata on open (the consumer item object doesn't carry
  // type/gender), so the fields reflect the DB, not stale props.
  useEffect(() => {
    let cancelled = false;
    if (!supabase || !id) { setLoaded(true); return; }
    const apply = (data: unknown) => {
      if (cancelled) return;
      const d = (data ?? null) as Record<string, unknown> | null;
      if (d) {
        setGender((d.gender as string) ?? '');
        if (kind === 'product') {
          setType((d.type as string) ?? '');
          setSubtype((d.subtype as string) ?? '');
          setTypePath((d.type_path as string) ?? null);
        }
      }
      setLoaded(true);
    };
    // Literal selects (Supabase's typed client can't parse a dynamic column
    // string).
    if (kind === 'product') {
      void supabase.from('products').select('gender, type, subtype, type_path')
        .eq('id', id).single().then(({ data }) => apply(data));
    } else {
      void supabase.from('looks').select('gender')
        .eq('id', id).single().then(({ data }) => apply(data));
    }
    return () => { cancelled = true; };
  }, [id, kind]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, sending]);

  const saveMeta = useCallback(async () => {
    if (!supabase || !id) return;
    setSaving(true); setSaveMsg(null);
    const patch: Record<string, string | null> = { gender: gender || null };
    if (kind === 'product') {
      patch.type = type.trim() || null;
      patch.subtype = subtype.trim() || null;
    }
    const { error } = await supabase.from(table).update(patch).eq('id', id);
    setSaving(false);
    setSaveMsg(error ? `Failed: ${error.message}` : 'Saved ✓');
    window.setTimeout(() => setSaveMsg(null), 2500);
  }, [id, gender, type, subtype, kind, table]);

  const send = useCallback(async () => {
    const msg = input.trim();
    if (!msg || sending || !supabase) return;
    setInput('');
    const history = messages.map(m => ({ role: m.role, content: m.content }));
    setMessages(prev => [...prev, { role: 'user', content: msg }]);
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke('kaizen-chat', {
        body: { kind, id, message: msg, history },
      });
      if (error) throw error;
      const reply = (data as { reply?: string })?.reply ?? '(no reply)';
      const changes = (data as { changes?: Record<string, string> | null })?.changes ?? null;
      setMessages(prev => [...prev, { role: 'assistant', content: reply, changes }]);
    } catch (err) {
      setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${err instanceof Error ? err.message : 'failed'}` }]);
    } finally {
      setSending(false);
    }
  }, [input, sending, messages, kind, id]);

  const applyChanges = useCallback(async (changes: Record<string, string>) => {
    if (!supabase || !id) return;
    const patch: Record<string, string> = {};
    if (changes.gender) patch.gender = changes.gender;
    if (kind === 'product') {
      if (changes.type) patch.type = changes.type;
      if (changes.subtype) patch.subtype = changes.subtype;
    }
    if (Object.keys(patch).length === 0) return;
    const { error } = await supabase.from(table).update(patch).eq('id', id);
    if (error) {
      setMessages(prev => [...prev, { role: 'assistant', content: `Apply failed: ${error.message}` }]);
      return;
    }
    if (patch.gender) setGender(patch.gender);
    if (patch.type) setType(patch.type);
    if (patch.subtype) setSubtype(patch.subtype);
    setMessages(prev => [...prev, {
      role: 'assistant',
      content: `✓ Applied — ${Object.entries(patch).map(([k, v]) => `${k} → ${v}`).join(', ')}`,
    }]);
  }, [id, kind, table]);

  return (
    <div className="adminctx-backdrop" onClick={onClose}>
      <div className="adminctx-panel" onClick={e => e.stopPropagation()} role="dialog" aria-label="Super-admin context">
        <div className="adminctx-head">
          <div className="adminctx-titles">
            {subtitle && <span className="adminctx-sub">{subtitle}</span>}
            <span className="adminctx-title">{title ?? (kind === 'look' ? 'Look' : 'Product')}</span>
          </div>
          <button className="adminctx-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="adminctx-meta">
          <label className="adminctx-field">
            <span>Gender</span>
            <select value={gender} onChange={e => setGender(e.target.value)} disabled={!loaded}>
              <option value="">(unset)</option>
              <option value="male">male</option>
              <option value="female">female</option>
              <option value="unisex">unisex</option>
            </select>
          </label>
          {kind === 'product' && (
            <>
              <label className="adminctx-field">
                <span>Type</span>
                <input value={type} onChange={e => setType(e.target.value)} placeholder="e.g. Sandals" disabled={!loaded} />
              </label>
              <label className="adminctx-field">
                <span>Subtype</span>
                <input value={subtype} onChange={e => setSubtype(e.target.value)} placeholder="e.g. Slides" disabled={!loaded} />
              </label>
              {typePath && <div className="adminctx-path">path · {typePath}</div>}
            </>
          )}
          <div className="adminctx-saverow">
            <button className="adminctx-save" onClick={saveMeta} disabled={saving || !loaded}>{saving ? 'Saving…' : 'Save'}</button>
            {saveMsg && <span className="adminctx-savemsg">{saveMsg}</span>}
          </div>
        </div>

        <div className="adminctx-kaizen">
          <div className="adminctx-kaizen-head">改 Kaizen</div>
          <div className="adminctx-msgs" ref={scrollRef}>
            {messages.length === 0 && (
              <div className="adminctx-hint">
                Ask why this shows where it does, or tell it how to fix it — e.g. “these are women’s heels”, “move to Sandals / Slides”, “why is this unisex?”. It proposes type/gender changes you apply with a tap.
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`adminctx-msg adminctx-msg--${m.role}`}>
                <div className="adminctx-msg-body">{m.content}</div>
                {m.changes && (
                  <button className="adminctx-apply" onClick={() => applyChanges(m.changes!)}>
                    Apply {Object.entries(m.changes).map(([k, v]) => `${k} → ${v}`).join(', ')}
                  </button>
                )}
              </div>
            ))}
            {sending && (
              <div className="adminctx-msg adminctx-msg--assistant">
                <div className="adminctx-msg-body adminctx-typing">thinking…</div>
              </div>
            )}
          </div>
          <div className="adminctx-compose">
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void send(); }}
              placeholder="Ask Kaizen…"
            />
            <button onClick={() => void send()} disabled={sending || !input.trim()} aria-label="Send">↑</button>
          </div>
        </div>
      </div>
    </div>
  );
}
