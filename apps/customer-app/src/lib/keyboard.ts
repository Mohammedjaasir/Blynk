import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

/**
 * How much of the bottom of the window the on-screen keyboard covers, for screens that keep
 * a form above it.
 * Web: the keyboard shrinks the visual viewport but not the layout one (Chrome's default), so
 * this is the difference. Android (native) resizes the window itself: 0. iOS: the keyboard frame.
 */
export function useKeyboardInset(): number {
  const [h, setH] = useState(0);
  useEffect(() => {
    if (Platform.OS === 'web') {
      const vv = typeof window !== 'undefined' ? window.visualViewport : null;
      if (!vv || typeof document === 'undefined') return;
      const on = () => {
        const d = document.documentElement.clientHeight - vv.height * vv.scale;
        setH(d > 80 ? Math.round(d) : 0);
      };
      on();
      vv.addEventListener('resize', on);
      return () => vv.removeEventListener('resize', on);
    }
    if (Platform.OS !== 'ios') return;
    const show = Keyboard.addListener('keyboardWillShow', (e) => setH(e.endCoordinates.height));
    const hide = Keyboard.addListener('keyboardWillHide', () => setH(0));
    return () => { show.remove(); hide.remove(); };
  }, []);
  return h;
}
