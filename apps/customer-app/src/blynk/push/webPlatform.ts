import type { PushPermission, PushPlatform } from './manager';
import { clickedPushData } from './target';

/*
 * Firebase Cloud Messaging web push for the PWA, like the Flutter web build
 * (lib/Services/push/push_platform_web.dart, web_push_config.dart). The Firebase compat SDK is
 * loaded from gstatic at run time - the same 10.14.1 build the site's service worker
 * (apps/customer-site/firebase-messaging-sw.js) imports - so nothing is bundled. getToken()
 * registers that worker at its default URL, /firebase-messaging-sw.js on this origin, which the
 * site serves at its root; while the app is closed or in the background the worker shows the
 * notification and a tap opens the server's link (WEB_APP_URL) and posts a
 * "notification-clicked" message to the page, which opens the order.
 *
 * The settings are the public "Blynk web" app config: they identify the project, they do not
 * grant access to it.
 */
export const FIREBASE_VERSION = '10.14.1';
export const FIREBASE_APP_JS = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-app-compat.js`;
export const FIREBASE_MESSAGING_JS = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-messaging-compat.js`;

export const BLYNK_WEB_FIREBASE = {
  apiKey: 'AIzaSyBSK7UiiWrtclBOljgIhmS7kAd41ZLBMG4',
  authDomain: 'blynk-15cd4.firebaseapp.com',
  projectId: 'blynk-15cd4',
  storageBucket: 'blynk-15cd4.firebasestorage.app',
  messagingSenderId: '806613943275',
  appId: '1:806613943275:web:42f4e52efa0c0973760fae',
};

/** Cloud Messaging > Web Push certificates: the public key browsers use to accept pushes. */
export const BLYNK_WEB_PUSH_VAPID_KEY =
  'BH_CahMoL5q43dTHUV9XIxhGgfEyTTsd2BqYXIZ_fzdfBQeiD6gK_XEyKnKDUCUUV5VRIT_j9b_doR-j15Su_Tk';

type Messaging = {
  getToken(o: { vapidKey: string }): Promise<string>;
  deleteToken(): Promise<boolean>;
  onMessage(cb: (p: unknown) => void): () => void;
};
type FirebaseCompat = {
  apps: unknown[];
  initializeApp(o: Record<string, string>): unknown;
  messaging: { (): Messaging; isSupported(): boolean | Promise<boolean> };
};

type G = typeof globalThis & {
  firebase?: FirebaseCompat;
  document?: Document;
  Notification?: { permission: NotificationPermission; requestPermission(): Promise<NotificationPermission> };
  navigator?: Navigator;
};

function loadScript(doc: Document, src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = doc.querySelector(`script[src="${src}"]`) as HTMLScriptElement | null;
    if (existing?.dataset.loaded === '1') { resolve(); return; }
    const s = existing ?? doc.createElement('script');
    s.addEventListener('load', () => { s.dataset.loaded = '1'; resolve(); });
    s.addEventListener('error', () => { s.remove(); reject(new Error(`could not load ${src}`)); });
    if (!existing) {
      s.src = src;
      s.async = true;
      doc.head.appendChild(s);
    }
  });
}

let loading: Promise<FirebaseCompat> | null = null;

function loadFirebase(): Promise<FirebaseCompat> {
  const g = globalThis as G;
  if (g.firebase?.messaging) return Promise.resolve(g.firebase);
  if (loading) return loading;
  const doc = g.document;
  if (!doc) return Promise.reject(new Error('no document'));
  loading = loadScript(doc, FIREBASE_APP_JS)
    .then(() => loadScript(doc, FIREBASE_MESSAGING_JS))
    .then(() => {
      if (!g.firebase?.messaging) throw new Error('firebase messaging did not load');
      return g.firebase;
    })
    .catch((e) => { loading = null; throw e; });
  return loading;
}

/** The browser's notification permission, without asking. */
export function browserPermission(): PushPermission {
  const N = (globalThis as G).Notification;
  if (!N) return 'unsupported';
  return N.permission === 'granted' || N.permission === 'denied' ? N.permission : 'default';
}

/** Whether this browser can do web push at all (an iPhone needs iOS 16.4+ and Blynk on the Home Screen). */
export function webPushPossible(): boolean {
  const g = globalThis as G;
  return !!g.document && !!g.Notification && !!g.navigator && 'serviceWorker' in g.navigator && typeof g.PushManager !== 'undefined';
}

export function createWebPushPlatform(): PushPlatform | null {
  if (!webPushPossible()) return null;
  let messaging: Messaging | null = null;
  const g = globalThis as G;

  return {
    name: 'web',
    async initialize() {
      const fb = await loadFirebase();
      if (!(await fb.messaging.isSupported())) throw new Error('This browser cannot receive web push');
      if (!fb.apps.length) fb.initializeApp(BLYNK_WEB_FIREBASE);
      messaging = fb.messaging();
    },
    permission: browserPermission,
    async requestPermission() {
      const N = g.Notification;
      if (!N) return 'unsupported';
      const r = await N.requestPermission();
      return r === 'granted' || r === 'denied' ? r : 'default';
    },
    async getToken() {
      if (!messaging || browserPermission() !== 'granted') return null;
      const t = await messaging.getToken({ vapidKey: BLYNK_WEB_PUSH_VAPID_KEY });
      return t || null;
    },
    async deleteToken() {
      if (messaging) await messaging.deleteToken();
    },
    onTap(cb) {
      const sw = g.navigator?.serviceWorker;
      if (!sw) return () => undefined;
      const handler = (e: MessageEvent) => {
        const data = clickedPushData(e.data);
        if (data) cb(data);
      };
      sw.addEventListener('message', handler);
      try { sw.startMessages?.(); } catch { /* older browsers start on their own */ }
      return () => sw.removeEventListener('message', handler);
    },
  };
}
