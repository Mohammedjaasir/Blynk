import type { CapacitorConfig } from '@capacitor/cli';

// Blynk Ops as an Android app (2026-09-27), wrapped the same way as
// apps/rider. The web build in dist/ is the whole app; VITE_API_BASE_URL is
// baked in by `vite build`.
//
// CAP_LAN_HTTP=1 is ONLY for a phone-on-the-same-Wi-Fi test against a backend
// on a PC over plain http. It serves the app from http://localhost so the
// WebView does not block calls to an http API as mixed content. A normal
// build leaves Capacitor's https default untouched.
const lanHttp = process.env.CAP_LAN_HTTP === '1';

const config: CapacitorConfig = {
  appId: 'lk.blynk.ops',
  appName: 'Blynk Ops',
  webDir: 'dist',
  // Required by @capacitor-community/background-geolocation (as in apps/rider):
  // otherwise location updates halt ~5 min into the background (issue #89).
  // Unlike Rider, plugins.CapacitorHttp stays OFF here - global native HTTP
  // would also carry the multipart image uploads; only the location POSTs go
  // native, explicitly (src/api/native-client.ts).
  android: {
    useLegacyBridge: true,
  },
  ...(lanHttp ? { server: { androidScheme: 'http' } } : {}),
};

export default config;
