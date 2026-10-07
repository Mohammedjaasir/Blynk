import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';

/**
 * Android's back button (owner, 2026-10-07: "back exits the app"). Capacitor
 * hands the button to @capacitor/app; without a listener Android simply
 * closed the app on every press.
 *
 * - On a screen opened from another one: back to it.
 * - On any other inner screen with nothing to go back to: the main screen.
 * - On the main, sign-in or welcome screen: "Press back again to exit"; a
 *   second press within EXIT_WINDOW_MS closes the app.
 */
export const EXIT_WINDOW_MS = 2000;
export const ROOT_PATHS: ReadonlySet<string> = new Set(['/', '/login', '/welcome']);

export type BackAction = 'back' | 'home' | 'hint' | 'exit';

export function backActionFor(pathname: string, canGoBack: boolean, lastPressAt: number, now: number): BackAction {
  if (ROOT_PATHS.has(pathname)) return now - lastPressAt < EXIT_WINDOW_MS ? 'exit' : 'hint';
  return canGoBack ? 'back' : 'home';
}

export function AndroidBackButton() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const path = useRef(pathname);
  path.current = pathname;
  const lastPress = useRef(0);
  const [hint, setHint] = useState(false);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return undefined;
    let hideHint: number | undefined;
    const listener = CapacitorApp.addListener('backButton', ({ canGoBack }) => {
      const now = Date.now();
      const action = backActionFor(path.current, canGoBack, lastPress.current, now);
      if (action === 'back') navigate(-1);
      else if (action === 'home') navigate('/', { replace: true });
      else if (action === 'exit') void CapacitorApp.exitApp();
      else {
        lastPress.current = now;
        setHint(true);
        window.clearTimeout(hideHint);
        hideHint = window.setTimeout(() => setHint(false), EXIT_WINDOW_MS);
      }
    });
    return () => {
      window.clearTimeout(hideHint);
      void listener.then((l) => l.remove());
    };
  }, [navigate]);

  return hint ? (
    <div className="back-hint" role="status">
      Press back again to exit
    </div>
  ) : null;
}
