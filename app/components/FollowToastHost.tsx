import { useEffect, useRef, useState } from 'react';
import ConsumerAvatar from './ConsumerAvatar';

// Mounts once at the app root and shows a transient "You're now following
// <name>" toast (with the creator's avatar) whenever a follow happens
// anywhere in the app. CreatorAvatarFollow dispatches the
// `catalog:followed` CustomEvent on a NEW follow (not on unfollow).

interface FollowToast {
  id: number;
  name: string;
  avatarUrl: string | null;
}

const VISIBLE_MS = 3000;

export default function FollowToastHost() {
  const [toast, setToast] = useState<FollowToast | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    const onFollowed = (e: Event) => {
      const detail = (e as CustomEvent).detail as { name?: string; avatarUrl?: string | null } | undefined;
      if (!detail) return;
      setToast({
        id: Date.now(),
        name: detail.name || 'this creator',
        avatarUrl: detail.avatarUrl ?? null,
      });
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setToast(null), VISIBLE_MS);
    };
    window.addEventListener('catalog:followed', onFollowed);
    return () => {
      window.removeEventListener('catalog:followed', onFollowed);
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, []);

  if (!toast) return null;

  return (
    <div className="follow-toast" role="status" key={toast.id}>
      <ConsumerAvatar className="follow-toast-avatar" name={toast.name} url={toast.avatarUrl} size={34} />
      <span className="follow-toast-text">You&rsquo;re now following <strong>{toast.name}</strong></span>
    </div>
  );
}
