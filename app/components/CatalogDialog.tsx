// Catalog dialog system — the in-brand replacement for EVERY native
// window.confirm / window.alert / window.prompt in the codebase (those are
// banned; this is the only popup). One provider mounts at the app root and
// renders a single centered glass dialog: dark glass, fade in/out, spring
// scale (the Catalog UI spring), Esc/Enter keyboard handling.
//
// Two ways to call it:
//   • useCatalogDialog() — hook, for components that want the context.
//   • catalogConfirm / catalogAlert / catalogPrompt — module-level, for
//     deep callbacks and non-component code. They route to the mounted
//     provider and fall back to the native dialogs only if the provider
//     isn't mounted (SSR/tests).
// All three accept a plain string (first line = title, rest = message) or
// a full options object.

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import '~/styles/catalog-dialog.css';

export interface CatalogDialogOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Destructive treatment on the confirm button. */
  danger?: boolean;
  /** Prompt only. */
  placeholder?: string;
  defaultValue?: string;
}

type DialogInput = string | CatalogDialogOptions;

interface ContextValue {
  confirm: (opts: DialogInput) => Promise<boolean>;
  alert: (opts: DialogInput) => Promise<void>;
  prompt: (opts: DialogInput) => Promise<string | null>;
}

type Kind = 'confirm' | 'alert' | 'prompt';

interface PendingDialog {
  kind: Kind;
  options: CatalogDialogOptions;
  resolve: (result: boolean | string | null) => void;
}

/** String shorthand: first line becomes the title, the rest the message. */
function normalize(input: DialogInput): CatalogDialogOptions {
  if (typeof input !== 'string') return input;
  const [title, ...rest] = input.split('\n');
  const message = rest.join('\n').trim();
  return { title: title.trim(), message: message || undefined };
}

const CatalogDialogContext = createContext<ContextValue | null>(null);

// Module-level bridge so non-component code can open dialogs. The provider
// registers itself on mount; native dialogs are the last-resort fallback.
let activeDialogs: ContextValue | null = null;

export const catalogConfirm = (opts: DialogInput): Promise<boolean> => {
  if (activeDialogs) return activeDialogs.confirm(opts);
  const o = normalize(opts);
  return Promise.resolve(typeof window !== 'undefined'
    && window.confirm(o.message ? `${o.title}\n\n${o.message}` : o.title));
};
export const catalogAlert = (opts: DialogInput): Promise<void> => {
  if (activeDialogs) return activeDialogs.alert(opts);
  const o = normalize(opts);
  if (typeof window !== 'undefined') window.alert(o.message ? `${o.title}\n\n${o.message}` : o.title);
  return Promise.resolve();
};
export const catalogPrompt = (opts: DialogInput): Promise<string | null> => {
  if (activeDialogs) return activeDialogs.prompt(opts);
  const o = normalize(opts);
  return Promise.resolve(typeof window !== 'undefined'
    ? window.prompt(o.message ? `${o.title}\n\n${o.message}` : o.title, o.defaultValue ?? '')
    : null);
};

export function useCatalogDialog(): ContextValue {
  const ctx = useContext(CatalogDialogContext);
  // Provider mounts at the root, so this only trips in isolated tests —
  // route through the module bridge (which has its own native fallback).
  return ctx ?? { confirm: catalogConfirm, alert: catalogAlert, prompt: catalogPrompt };
}

const EXIT_MS = 170;

export function CatalogDialogProvider({ children }: { children: React.ReactNode }) {
  // FIFO queue: a dialog requested while one is open shows right after it.
  const [queue, setQueue] = useState<PendingDialog[]>([]);
  const [closing, setClosing] = useState(false);
  const current = queue[0] ?? null;
  const inputRef = useRef<HTMLInputElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);

  const push = useCallback((d: PendingDialog) => setQueue(prev => [...prev, d]), []);

  const value = useRef<ContextValue>({
    confirm: (opts) => new Promise<boolean>(resolve => push({
      kind: 'confirm', options: normalize(opts), resolve: r => resolve(r === true),
    })),
    alert: (opts) => new Promise<void>(resolve => push({
      kind: 'alert', options: normalize(opts), resolve: () => resolve(),
    })),
    prompt: (opts) => new Promise<string | null>(resolve => push({
      kind: 'prompt', options: normalize(opts), resolve: r => resolve(typeof r === 'string' ? r : null),
    })),
  }).current;

  useEffect(() => {
    activeDialogs = value;
    return () => { if (activeDialogs === value) activeDialogs = null; };
  }, [value]);

  // Resolve immediately (callers shouldn't wait on the exit animation),
  // then fade out before advancing the queue.
  const respond = useCallback((result: boolean | string | null) => {
    setQueue(prev => {
      prev[0]?.resolve(result);
      return prev;
    });
    setClosing(true);
    window.setTimeout(() => {
      setClosing(false);
      setQueue(prev => prev.slice(1));
    }, EXIT_MS);
  }, []);

  // Focus + keyboard. Esc cancels; Enter confirms (the prompt's input has
  // its own Enter handling so typing is unaffected).
  useEffect(() => {
    if (!current || closing) return;
    if (current.kind === 'prompt') inputRef.current?.focus();
    else primaryRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        respond(current.kind === 'prompt' ? null : false);
      } else if (e.key === 'Enter' && current.kind !== 'prompt') {
        e.preventDefault();
        respond(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [current, closing, respond]);

  const opts = current?.options;

  return (
    <CatalogDialogContext.Provider value={value}>
      {children}
      {current && opts && (
        <div
          className={`cat-dialog-overlay${closing ? ' is-closing' : ''}`}
          role="presentation"
          onClick={() => respond(current.kind === 'prompt' ? null : false)}
        >
          <div
            className="cat-dialog"
            role={current.kind === 'alert' ? 'alertdialog' : 'dialog'}
            aria-modal="true"
            aria-labelledby="cat-dialog-title"
            onClick={e => e.stopPropagation()}
          >
            <h2 id="cat-dialog-title">{opts.title}</h2>
            {opts.message && <p>{opts.message}</p>}
            {current.kind === 'prompt' && (
              <input
                ref={inputRef}
                className="cat-dialog-input"
                type="text"
                defaultValue={opts.defaultValue ?? ''}
                placeholder={opts.placeholder}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    respond(e.currentTarget.value);
                  }
                }}
              />
            )}
            <div className="cat-dialog-actions">
              {current.kind !== 'alert' && (
                <button
                  type="button"
                  className="cat-dialog-btn"
                  onClick={() => respond(current.kind === 'prompt' ? null : false)}
                >
                  {opts.cancelLabel || 'Cancel'}
                </button>
              )}
              <button
                ref={primaryRef}
                type="button"
                className={`cat-dialog-btn is-primary${opts.danger ? ' is-danger' : ''}`}
                onClick={() => respond(current.kind === 'prompt' ? (inputRef.current?.value ?? '') : true)}
              >
                {opts.confirmLabel || (current.kind === 'alert' ? 'OK' : opts.danger ? 'Delete' : 'Confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </CatalogDialogContext.Provider>
  );
}
