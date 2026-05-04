import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

/* In-platform confirm modal for admin pages.
 *
 * Replaces window.confirm() so the prompts can carry our own
 * styling, tone, and danger affordances. Provider mounts at the
 * admin layout root and renders a single shared modal; consumer
 * pages call useAdminConfirm().confirm(opts) which returns a
 * Promise<boolean>. */

export interface AdminConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** When true, the confirm button uses the destructive red treatment. */
  danger?: boolean;
}

interface ResolverState {
  options: AdminConfirmOptions;
  resolve: (ok: boolean) => void;
}

interface ContextValue {
  confirm: (options: AdminConfirmOptions) => Promise<boolean>;
}

const AdminConfirmContext = createContext<ContextValue | null>(null);

export function useAdminConfirm(): ContextValue {
  const ctx = useContext(AdminConfirmContext);
  if (!ctx) {
    // Provider missing - fall back to the native confirm so the
    // caller still gets a result. Logged once so it's debuggable.
    if (typeof window !== 'undefined') {
      console.warn('[useAdminConfirm] No <AdminConfirmProvider> in tree, falling back to window.confirm.');
    }
    return {
      confirm: async (opts) => {
        if (typeof window === 'undefined') return false;
        return window.confirm(opts.message ? `${opts.title}\n\n${opts.message}` : opts.title);
      },
    };
  }
  return ctx;
}

export function AdminConfirmProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<ResolverState | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  const confirm = useCallback((options: AdminConfirmOptions) => {
    return new Promise<boolean>(resolve => {
      setPending({ options, resolve });
    });
  }, []);

  const respond = useCallback((ok: boolean) => {
    setPending(curr => {
      curr?.resolve(ok);
      return null;
    });
  }, []);

  // Focus + Esc support. We only wire these while the modal is open
  // so the listener doesn't intercept keystrokes when nothing's
  // pending (and notably doesn't fight TypeAnywhere).
  useEffect(() => {
    if (!pending) return;
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        respond(false);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        respond(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pending, respond]);

  const opts = pending?.options;
  const danger = !!opts?.danger;

  return (
    <AdminConfirmContext.Provider value={{ confirm }}>
      {children}
      {pending && opts && (
        <div
          role="presentation"
          onClick={() => respond(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 12000,
            background: 'rgba(0, 0, 0, 0.55)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 20,
            backdropFilter: 'blur(4px)',
            WebkitBackdropFilter: 'blur(4px)',
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="admin-confirm-title"
            onClick={e => e.stopPropagation()}
            style={{
              background: '#fff',
              borderRadius: 14,
              width: 440,
              maxWidth: '92vw',
              padding: 22,
              boxShadow: '0 24px 64px rgba(0, 0, 0, 0.32)',
              border: '1px solid rgba(0, 0, 0, 0.05)',
            }}
          >
            <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
              <div
                aria-hidden
                style={{
                  width: 36, height: 36, flexShrink: 0,
                  borderRadius: '50%',
                  background: danger ? '#fef2f2' : '#eef2ff',
                  color: danger ? '#dc2626' : '#4f46e5',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                {danger ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 9v4M12 17h.01" />
                    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  </svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                )}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <h2
                  id="admin-confirm-title"
                  style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#0f172a', lineHeight: 1.35 }}
                >
                  {opts.title}
                </h2>
                {opts.message && (
                  <p style={{ margin: '8px 0 0', fontSize: 13, color: '#475569', lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
                    {opts.message}
                  </p>
                )}
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 22 }}>
              <button
                ref={cancelRef}
                type="button"
                className="admin-btn admin-btn-secondary"
                onClick={() => respond(false)}
              >
                {opts.cancelLabel || 'Cancel'}
              </button>
              <button
                type="button"
                className="admin-btn admin-btn-primary"
                style={danger ? { background: '#dc2626', borderColor: '#dc2626' } : undefined}
                onClick={() => respond(true)}
              >
                {opts.confirmLabel || (danger ? 'Delete' : 'Confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminConfirmContext.Provider>
  );
}
