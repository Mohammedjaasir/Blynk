import { AppState } from 'react-native';
import { documentHidden } from './catalogLive';

/** Hidden = a background browser tab (web) or a backgrounded app (native). */
export const appHidden = (): boolean => documentHidden() || (AppState.currentState != null && AppState.currentState !== 'active');

/** Calls `cb` whenever the page/app comes back to the foreground. Returns an unsubscribe. */
export function onVisible(cb: () => void): () => void {
  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    const vis = () => { if (document.visibilityState === 'visible') cb(); };
    document.addEventListener('visibilitychange', vis);
    return () => document.removeEventListener('visibilitychange', vis);
  }
  const sub = AppState.addEventListener('change', (s) => { if (s === 'active') cb(); });
  return () => sub.remove();
}
