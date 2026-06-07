import { useEffect, useRef, useState } from 'react';
import ConsumerAvatar from './ConsumerAvatar';

// Mounts once at the app root and shows transient top-of-screen toasts for
// two engagement events, sharing one visual language (dark glass pill):
//
//  • `catalog:followed` — "You're now following <name>" with the creator's
//    avatar. Dispatched by CreatorAvatarFollow on a NEW follow.
//  • `catalog:saved` — "Added/Removed <name> to/from your saved" with a small
//    thumbnail of the saved look/product. Dispatched anywhere a look or
//    product is bookmarked or un-bookmarked.

interface FollowToast {
  id: number;
  kind: 'follow';
  name: string;
  avatarUrl: string | null;
}

interface SavedToast {
  id: number;
  kind: 'saved';
  name: string;
  imageUrl: string | null;
  saved: boolean;
}

type Toast = FollowToast | SavedToast;

const VISIBLE_MS = 3000;

export default function FollowToastHost() {
  const [toast, setToast] = useState<Toast | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    const show = (next: Toast) => {
      setToast(next);
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setToast(null), VISIBLE_MS);
    };

    const onFollowed = (e: Event) => {
      const detail = (e as CustomEvent).detail as { name?: string; avatarUrl?: string | null } | undefined;
      if (!detail) return;
      show({
        id: Date.now(),
        kind: 'follow',
        name: detail.name || 'this creator',
        avatarUrl: detail.avatarUrl ?? null,
      });
    };

    const onSaved = (e: Event) => {
      const detail = (e as CustomEvent).detail as
        | { name?: string; imageUrl?: string | null; saved?: boolean }
        | undefined;
      if (!detail) return;
      show({
        id: Date.now(),
        kind: 'saved',
        name: detail.name || 'this item',
        imageUrl: detail.imageUrl ?? null,
        saved: detail.saved !== false,
      });
    };

    window.addEventListener('catalog:followed', onFollowed);
    window.addEventListener('catalog:saved', onSaved);
    return () => {
      window.removeEventListener('catalog:followed', onFollowed);
      window.removeEventListener('catalog:saved', onSaved);
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, []);

  if (!toast) return null;

  if (toast.kind === 'saved') {
    return (
      <div className="follow-toast follow-toast--saved" role="status" key={toast.id}>
        {toast.imageUrl ? (
          <img className="follow-toast-thumb" src={toast.imageUrl} alt="" />
        ) : (
          <span className="follow-toast-thumb follow-toast-thumb--blank" aria-hidden="true">♥</span>
        )}
        <span className="follow-toast-text">
          {toast.saved ? 'Added ' : 'Removed '}
          <strong>{toast.name}</strong>
          {toast.saved ? ' to your saved' : ' from your saved'}
        </span>
      </div>
    );
  }

  return (
    <div className="follow-toast" role="status" key={toast.id}>
      <ConsumerAvatar className="follow-toast-avatar" name={toast.name} url={toast.avatarUrl} size={34} />
      <span className="follow-toast-text">You&rsquo;re now following <strong>{toast.name}</strong></span>
    </div>
  );
}
