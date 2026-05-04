import { useEffect, useState } from 'react';

// Super-admin "delete mode". When on, the consumer feed shows a trash
// icon over every creative tile so a super-admin can nuke products
// directly from the public surface. Off by default - toggled from the
// account menu and persisted to localStorage so it survives reloads.

const STORAGE_KEY = 'admin:deleteMode';

type Listener = (on: boolean) => void;
const listeners = new Set<Listener>();

function read(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function write(on: boolean) {
  try {
    window.localStorage.setItem(STORAGE_KEY, on ? '1' : '0');
  } catch { /* quota / private mode */ }
}

export function setDeleteMode(on: boolean) {
  write(on);
  listeners.forEach(l => l(on));
}

export function useDeleteMode(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState<boolean>(() => read());

  useEffect(() => {
    const listener: Listener = next => setOn(next);
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, []);

  // Cross-tab sync - flipping the toggle in one tab updates every other
  // tab on the same origin too.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setOn(read());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  return [on, setDeleteMode];
}
