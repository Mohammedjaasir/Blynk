/*
 * "Install the Blynk Seller app" (the site is an installable web app, see public/manifest.webmanifest).
 *  - Chrome / Edge / Samsung Internet on Android fire `beforeinstallprompt`; we keep the event and
 *    show a button that calls it;
 *  - iPhone / iPad Safari has no such event: show the one-line hint "Tap Share, then Add to Home Screen";
 *  - hidden once installed (display-mode: standalone, navigator.standalone, `appinstalled`) or
 *    dismissed (remembered in localStorage, wrapped in try/catch: private windows block it).
 * Plain TypeScript with the browser injected, so the rules are unit tested.
 */

export type InstallMode = 'hidden' | 'prompt' | 'ios';

export const IOS_HINT = 'Tap Share, then Add to Home Screen.';

const DISMISSED_KEY = 'blynk.seller.installDismissed';

/** The non-standard event Chrome fires when the site can be installed. */
export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export interface InstallEnv {
  /** window-like: addEventListener / removeEventListener. */
  win: Pick<Window, 'addEventListener' | 'removeEventListener'>;
  isStandalone(): boolean;
  isIos(): boolean;
  readDismissed(): boolean;
  writeDismissed(): void;
}

/** True on an iPhone or iPad (iPadOS 13+ says "Macintosh" but has a touch screen). */
export function isIosDevice(nav: Pick<Navigator, 'userAgent' | 'maxTouchPoints'> = navigator): boolean {
  const ua = nav.userAgent ?? '';
  if (/iPhone|iPad|iPod/i.test(ua)) return true;
  return /Macintosh/i.test(ua) && (nav.maxTouchPoints ?? 0) > 1;
}

/** Running as the installed app (not in a browser tab). */
export function isStandaloneDisplay(): boolean {
  try {
    if (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches) return true;
  } catch {
    /* fall through */
  }
  return (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/** An iPhone / iPad browser tab: web push only works once the app is on the Home Screen. */
export function iosNeedsInstall(): boolean {
  return isIosDevice() && !isStandaloneDisplay();
}

export function browserInstallEnv(): InstallEnv {
  return {
    win: window,
    isStandalone: isStandaloneDisplay,
    isIos: () => isIosDevice(),
    readDismissed() {
      try {
        return localStorage.getItem(DISMISSED_KEY) === '1';
      } catch {
        return false;
      }
    },
    writeDismissed() {
      try {
        localStorage.setItem(DISMISSED_KEY, '1');
      } catch {
        /* the prompt may come back after a reload */
      }
    },
  };
}

export function createInstallController(env: InstallEnv) {
  let deferred: BeforeInstallPromptEvent | null = null;
  let installed = env.isStandalone();
  let dismissed = env.readDismissed();
  let listening = false;
  const listeners = new Set<() => void>();

  function mode(): InstallMode {
    if (installed || dismissed) return 'hidden';
    if (deferred) return 'prompt';
    if (env.isIos()) return 'ios';
    return 'hidden';
  }

  let snapshot: InstallMode = mode();
  const changed = () => {
    const next = mode();
    if (next === snapshot) return;
    snapshot = next;
    listeners.forEach((l) => l());
  };

  const onBeforeInstall = (e: Event) => {
    // Hold the event: the browser's own mini bar is replaced by our button.
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    changed();
  };
  const onInstalled = () => {
    installed = true;
    deferred = null;
    changed();
  };

  return {
    /** Start listening (idempotent). Call it as early as possible: the event fires once, soon after load. */
    start() {
      if (listening) return;
      listening = true;
      env.win.addEventListener('beforeinstallprompt', onBeforeInstall);
      env.win.addEventListener('appinstalled', onInstalled);
    },
    stop() {
      if (!listening) return;
      listening = false;
      env.win.removeEventListener('beforeinstallprompt', onBeforeInstall);
      env.win.removeEventListener('appinstalled', onInstalled);
    },
    getMode(): InstallMode {
      return snapshot;
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /** The Install button: show the browser's install dialog. */
    async install(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
      const event = deferred;
      if (!event) return 'unavailable';
      // The event can be used once, whatever the seller answers.
      deferred = null;
      try {
        await event.prompt();
        const choice = await event.userChoice;
        if (choice.outcome === 'accepted') installed = true;
        changed();
        return choice.outcome;
      } catch {
        changed();
        return 'dismissed';
      }
    },
    /** "Not now": hide it for good on this phone. */
    dismiss() {
      dismissed = true;
      env.writeDismissed();
      changed();
    },
  };
}

export type InstallController = ReturnType<typeof createInstallController>;
