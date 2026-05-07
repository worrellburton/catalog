// Branded confirm modal. Replaces the native browser confirm() dialog
// with one that matches the rest of the app's dark-glass aesthetic.
//
// Usage:
//   const [open, setOpen] = useState(false);
//   <ConfirmModal
//     open={open}
//     title="Delete this look?"
//     body="This can't be undone."
//     confirmLabel="Delete"
//     destructive
//     onConfirm={async () => { await deleteLook(); }}
//     onCancel={() => setOpen(false)}
//   />
//
// Promise/imperative variant via useConfirm() further below for sites
// that just want a drop-in replacement of `if (!confirm(...)) return;`.

import { useEffect, useRef, useState, useCallback, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface ConfirmModalProps {
  open: boolean;
  title: string;
  body?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** When true the confirm button gets the danger tone. */
  destructive?: boolean;
  /** Disabled while an in-flight onConfirm is awaiting. */
  busy?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

export function ConfirmModal({
  open,
  title,
  body,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  // Internal busy guard so the parent can pass `busy={false}` and we
  // still block double-clicks during an in-flight onConfirm() promise.
  const [internalBusy, setInternalBusy] = useState(false);
  const isBusy = busy || internalBusy;

  // Close on Escape; trap basic mouse-outside via the backdrop click
  // handler. We deliberately don't trap focus aggressively - the
  // confirm button is auto-focused which is enough for keyboard.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isBusy) onCancel();
      if (e.key === 'Enter' && !isBusy) {
        e.preventDefault();
        void runConfirm();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isBusy]);

  const runConfirm = useCallback(async () => {
    if (isBusy) return;
    try {
      setInternalBusy(true);
      await onConfirm();
    } finally {
      setInternalBusy(false);
    }
  }, [isBusy, onConfirm]);

  const confirmRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (open) confirmRef.current?.focus();
  }, [open]);

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="confirm-modal-backdrop"
      onClick={() => { if (!isBusy) onCancel(); }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
    >
      <div
        className={`confirm-modal${destructive ? ' is-destructive' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-modal-title" className="confirm-modal-title">{title}</h2>
        {body && <div className="confirm-modal-body">{body}</div>}
        <div className="confirm-modal-actions">
          <button
            type="button"
            className="confirm-modal-cancel"
            onClick={onCancel}
            disabled={isBusy}
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            className={`confirm-modal-confirm${destructive ? ' is-destructive' : ''}`}
            onClick={runConfirm}
            disabled={isBusy}
          >
            {isBusy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// Imperative drop-in for `if (!confirm(...)) return;` call sites.
// Returns { confirm, modal } - render `modal` once near the top of
// your component tree, call `await confirm({ title, body, ... })`
// anywhere a yes/no decision is needed. Resolves true on confirm,
// false on cancel.
export function useConfirm() {
  const [state, setState] = useState<{
    open: boolean;
    title: string;
    body?: ReactNode;
    confirmLabel?: string;
    cancelLabel?: string;
    destructive?: boolean;
  }>({ open: false, title: '' });
  const resolverRef = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback(
    (opts: {
      title: string;
      body?: ReactNode;
      confirmLabel?: string;
      cancelLabel?: string;
      destructive?: boolean;
    }) =>
      new Promise<boolean>((resolve) => {
        resolverRef.current = resolve;
        setState({ ...opts, open: true });
      }),
    [],
  );

  const close = useCallback((value: boolean) => {
    setState((s) => ({ ...s, open: false }));
    const r = resolverRef.current;
    resolverRef.current = null;
    if (r) r(value);
  }, []);

  const modal = (
    <ConfirmModal
      open={state.open}
      title={state.title}
      body={state.body}
      confirmLabel={state.confirmLabel}
      cancelLabel={state.cancelLabel}
      destructive={state.destructive}
      onConfirm={() => close(true)}
      onCancel={() => close(false)}
    />
  );

  return { confirm, modal };
}
