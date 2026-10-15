import { useIsFocused } from 'expo-router';
import { useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';

/** Focused screen, visible tab, foreground app: only then do idle loops run. */
export function useActive(): boolean {
  const focused = useIsFocused();
  const [fg, setFg] = useState(true);
  useEffect(() => {
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      const on = () => setFg(document.visibilityState !== 'hidden');
      on();
      document.addEventListener('visibilitychange', on);
      return () => document.removeEventListener('visibilitychange', on);
    }
    const sub = AppState.addEventListener('change', (s) => setFg(s === 'active'));
    return () => sub.remove();
  }, []);
  return focused && fg;
}
