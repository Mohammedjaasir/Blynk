import { useEffect } from 'react';
import { Platform } from 'react-native';
import { appColor } from '@/blynk/lib/appTexts';
import { useStore } from '@/blynk/store/StoreContext';
import { BANNER_TOP } from '@/components/Banner';

/**
 * The phone's status-bar colour on the web app (<meta name="theme-color">, public/index.html) follows
 * Admin / Ops' Home banner top colour, so changing the violet changes it too (owner, 2026-10-22:
 * "give the colors changing option for that voilet"). Draws nothing.
 */
export function ThemeColor() {
  const top = appColor(useStore(), 'hero_bg_top', BANNER_TOP);
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', top);
  }, [top]);
  return null;
}
