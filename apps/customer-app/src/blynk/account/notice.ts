import { useSyncExternalStore } from 'react';

/*
 * One short app-wide message (Flutter's snackbar after a session ends or an account is deleted),
 * shown by <SessionEffects /> at the bottom of the screen for a few seconds.
 */
export type Notice = { id: number; text: string; tone: 'info' | 'problem' };

let current: Notice | null = null;
let seq = 0;
const listeners = new Set<() => void>();

export function showNotice(text: string, tone: Notice['tone'] = 'info') {
  current = { id: ++seq, text, tone };
  listeners.forEach((l) => l());
}

export function clearNotice(id?: number) {
  if (!current || (id !== undefined && current.id !== id)) return;
  current = null;
  listeners.forEach((l) => l());
}

export const getNotice = () => current;

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => { listeners.delete(l); };
};

export const useNotice = () => useSyncExternalStore(subscribe, getNotice, getNotice);
