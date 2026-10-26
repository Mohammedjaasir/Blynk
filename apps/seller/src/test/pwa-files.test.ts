import { describe, it, expect, vi } from 'vitest';
// Raw text of the app's own files (the tests read them as the browser and nginx will).
import manifestRaw from '../../public/manifest.webmanifest?raw';
import swSource from '../../public/firebase-messaging-sw.js?raw';
import customerSwSource from '../../../customer-site/firebase-messaging-sw.js?raw';
import indexHtml from '../../index.html?raw';
import nginxConf from '../../nginx.conf?raw';
import dockerfile from '../../Dockerfile?raw';
// This app has no Node typings, but the tests run in Node: read the PNGs' real size from disk.
// @ts-ignore
const { readFileSync } = (await import('node:fs')) as { readFileSync: (path: string) => Uint8Array };

/** Width and height from a PNG's header; undefined when the file is missing. */
function pngSize(src: string): { width: number; height: number } | undefined {
  let bytes: Uint8Array;
  try {
    // vitest runs from the app folder (apps/seller)
    const path = `${(globalThis as unknown as { process: { cwd(): string } }).process.cwd()}/public${src}`;
    bytes = readFileSync(path);
  } catch {
    return undefined;
  }
  expect(String.fromCharCode(...bytes.subarray(1, 4)), `${src} is a PNG`).toBe('PNG');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

describe('the installable app files', () => {
  const manifest = JSON.parse(manifestRaw) as {
    name: string;
    short_name: string;
    start_url: string;
    scope: string;
    display: string;
    theme_color: string;
    background_color: string;
    icons: { src: string; sizes: string; type: string; purpose: string }[];
  };

  it('has the manifest the owner asked for', () => {
    expect(manifest.name).toBe('Blynk Seller');
    expect(manifest.short_name).toBe('Seller');
    expect(manifest.start_url).toBe('/');
    expect(manifest.scope).toBe('/');
    expect(manifest.display).toBe('standalone');
    // the site's own yellow (the header and <meta name="theme-color">)
    expect(manifest.theme_color.toLowerCase()).toBe('#ffe141');
    expect(manifest.background_color.toLowerCase()).toBe('#ffe141');
  });

  it('lists real PNG icons at 192 and 512, including maskable ones', () => {
    const purposes = (size: string) => manifest.icons.filter((i) => i.sizes === size).map((i) => i.purpose);
    expect(purposes('192x192')).toEqual(expect.arrayContaining(['any', 'maskable']));
    expect(purposes('512x512')).toEqual(expect.arrayContaining(['any', 'maskable']));
    for (const icon of manifest.icons) {
      expect(icon.type).toBe('image/png');
      expect(icon.src.startsWith('/')).toBe(true);
      const [w, h] = icon.sizes.split('x').map(Number);
      expect(pngSize(icon.src), `${icon.src} exists with the size the manifest says`).toEqual({ width: w, height: h });
    }
  });

  it('has the Home Screen icon for iPhones', () => {
    expect(pngSize('/icons/apple-touch-icon.png')).toEqual({ width: 180, height: 180 });
  });

  it('links the manifest, the icon and the iOS tags from index.html', () => {
    const html = indexHtml;
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest" />');
    expect(html).toContain('<meta name="theme-color" content="#FFE141" />');
    expect(html).toContain('rel="apple-touch-icon"');
    expect(html).toContain('name="apple-mobile-web-app-capable" content="yes"');
    expect(html).toContain('name="apple-mobile-web-app-title" content="Blynk Seller"');
    expect(html).toContain('name="mobile-web-app-capable"');
  });

  it('serves the service worker and the manifest with no-cache and the security headers (nginx.conf)', () => {
    const conf = nginxConf;
    for (const path of ['/firebase-messaging-sw.js', '/manifest.webmanifest']) {
      const start = conf.indexOf(`location = ${path} {`);
      expect(start, path).toBeGreaterThan(-1);
      const block = conf.slice(start, conf.indexOf('}', start));
      expect(block).toContain('add_header Cache-Control "no-cache";');
      expect(block).toContain('add_header X-Frame-Options "DENY" always;');
      expect(block).toContain('add_header X-Content-Type-Options "nosniff" always;');
      expect(block).toContain('add_header Referrer-Policy "strict-origin-when-cross-origin" always;');
      expect(block).toContain('try_files $uri =404;');
    }
    expect(conf).toContain('default_type application/javascript;');
    expect(conf).toMatch(/application\/manifest\+json\s+webmanifest;/);
  });

  it('makes the Docker build fail if the public files are missing from the build', () => {
    for (const path of ['dist/manifest.webmanifest', 'dist/firebase-messaging-sw.js', 'dist/icons/icon-192.png', 'dist/icons/icon-512.png']) {
      expect(dockerfile).toContain(`test -f ${path}`);
    }
  });
});

describe('the push service worker', () => {
  const ORIGIN = 'https://blynk-seller.valgrowlabs.com';

  /** Run public/firebase-messaging-sw.js against a stand-in worker scope. */
  function boot(clientList: { url: string; focus?: () => Promise<unknown>; navigate?: (u: string) => Promise<unknown> }[] = []) {
    const listeners: Record<string, (e: any) => void> = {};
    const shown: { title: string; options: any }[] = [];
    const openWindow = vi.fn(async (_url: string) => ({}));
    let background: ((p: any) => unknown) | null = null;
    const self_ = {
      location: { origin: ORIGIN },
      addEventListener: (type: string, fn: (e: any) => void) => {
        listeners[type] = fn;
      },
      registration: {
        showNotification: (title: string, options: unknown) => {
          shown.push({ title, options });
          return Promise.resolve();
        },
      },
      clients: { matchAll: vi.fn(async () => clientList), openWindow },
    };
    const imported: string[] = [];
    const firebase = {
      initializeApp: vi.fn(),
      messaging: () => ({
        onBackgroundMessage: (fn: (p: unknown) => unknown) => {
          background = fn;
        },
      }),
    };
    const sandbox = { self: self_, firebase, importScripts: (u: string) => void imported.push(u), URL };
    new Function('self', 'firebase', 'importScripts', 'URL', swSource)(sandbox.self, sandbox.firebase, sandbox.importScripts, sandbox.URL);
    return { listeners, shown, openWindow, imported, firebase, self_, background: () => background! };
  }

  function click(w: ReturnType<typeof boot>, data: unknown) {
    const waits: Promise<unknown>[] = [];
    const notification = { data, close: vi.fn() };
    const event = { notification, stopImmediatePropagation: vi.fn(), waitUntil: (p: Promise<unknown>) => void waits.push(p) };
    w.listeners.notificationclick!(event);
    return { event, notification, done: Promise.all(waits) };
  }

  it('loads the same pinned Firebase SDK as the customer site and the same web config', () => {
    const w = boot();
    const customer = customerSwSource;
    expect(w.imported).toEqual([
      'https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js',
      'https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js',
    ]);
    for (const url of w.imported) expect(customer).toContain(url);
    const config = w.firebase.initializeApp.mock.calls[0]![0] as Record<string, string>;
    for (const value of Object.values(config)) expect(customer).toContain(value);
    expect(config.projectId).toBe('blynk-15cd4');
  });

  it('opens the seller site root when a notification is tapped and no tab is open', async () => {
    const w = boot();
    const { event, notification, done } = click(w, { type: 'SELLER_PRODUCT_APPROVED', url: '/' });
    await done;
    expect(notification.close).toHaveBeenCalled();
    // the SDK's own handler must not run as well
    expect(event.stopImmediatePropagation).toHaveBeenCalled();
    expect(w.openWindow).toHaveBeenCalledWith(`${ORIGIN}/`);
  });

  it('opens data.url when it is a page of this site, and the home page when there is no link', async () => {
    const w = boot();
    await click(w, { url: '/statement' }).done;
    expect(w.openWindow).toHaveBeenLastCalledWith(`${ORIGIN}/statement`);
    await click(w, {}).done;
    expect(w.openWindow).toHaveBeenLastCalledWith(`${ORIGIN}/`);
    await click(w, undefined).done;
    expect(w.openWindow).toHaveBeenLastCalledWith(`${ORIGIN}/`);
  });

  it('finds the link inside the SDK payload too', async () => {
    const w = boot();
    await click(w, { FCM_MSG: { data: { url: '/products' } } }).done;
    expect(w.openWindow).toHaveBeenLastCalledWith(`${ORIGIN}/products`);
    await click(w, { FCM_MSG: { fcmOptions: { link: `${ORIGIN}/shop` } } }).done;
    expect(w.openWindow).toHaveBeenLastCalledWith(`${ORIGIN}/shop`);
  });

  it('never opens another site, whatever the message says', async () => {
    const w = boot();
    await click(w, { url: 'https://evil.example/login' }).done;
    expect(w.openWindow).toHaveBeenLastCalledWith(`${ORIGIN}/`);
    await click(w, { url: '//evil.example/login' }).done;
    expect(w.openWindow).toHaveBeenLastCalledWith(`${ORIGIN}/`);
    await click(w, { url: 'javascript:alert(1)' }).done;
    expect(w.openWindow).toHaveBeenLastCalledWith(`${ORIGIN}/`);
  });

  it('focuses an open seller tab instead of opening another one', async () => {
    const focus = vi.fn(async () => ({ url: `${ORIGIN}/products`, focus, navigate: undefined }));
    const w = boot([{ url: `${ORIGIN}/products`, focus }]);
    await click(w, { url: '/' }).done;
    expect(focus).toHaveBeenCalled();
    expect(w.openWindow).not.toHaveBeenCalled();
  });

  it('moves a focused tab to a deeper link', async () => {
    const navigate = vi.fn(async () => ({}));
    const client = { url: `${ORIGIN}/products`, navigate };
    const focus = vi.fn(async () => client);
    const w = boot([{ ...client, focus }]);
    await click(w, { url: '/statement' }).done;
    expect(navigate).toHaveBeenCalledWith(`${ORIGIN}/statement`);
    expect(w.openWindow).not.toHaveBeenCalled();
  });

  it('ignores tabs of other sites', async () => {
    const focus = vi.fn(async () => ({}));
    const w = boot([{ url: 'https://other.example/', focus }]);
    await click(w, { url: '/' }).done;
    expect(focus).not.toHaveBeenCalled();
    expect(w.openWindow).toHaveBeenCalledWith(`${ORIGIN}/`);
  });

  it('gives every notification the Blynk icon unless the server sent one', async () => {
    const w = boot();
    await w.self_.registration.showNotification('Payment sent', { body: 'We paid you LKR 1,500.00 (bank transfer).' });
    await w.self_.registration.showNotification('Own icon', { icon: '/x.png' });
    expect(w.shown[0]!.options.icon).toBe('/icons/icon-192.png');
    expect(w.shown[0]!.options.body).toBe('We paid you LKR 1,500.00 (bank transfer).');
    expect(w.shown[1]!.options.icon).toBe('/x.png');
  });

  it('shows a data-only message itself, and leaves messages with a notification block to the SDK', async () => {
    const w = boot();
    await w.background()({ data: { title: 'Mango Jam is live', body: 'Customers can order it now.', url: '/' } });
    expect(w.shown).toHaveLength(1);
    expect(w.shown[0]!.title).toBe('Mango Jam is live');
    expect(w.shown[0]!.options.data.url).toBe('/');
    await w.background()({ notification: { title: 'x', body: 'y' }, data: { title: 'x' } });
    expect(w.shown).toHaveLength(1);
    await w.background()({ data: { type: 'SELLER_APPROVED' } });
    expect(w.shown).toHaveLength(1);
  });
});
