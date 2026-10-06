import type { CapacitorConfig } from '@capacitor/cli';

// Blynk Admin as an Android app (2026-09-28), wrapped like apps/operations and
// apps/rider. The web build in dist/ is the whole app; VITE_API_BASE_URL is
// baked in by `vite build`. Served from https://localhost inside the app, so
// the API's CORS_ORIGINS must include https://localhost.
// The app's pages are served inside the APK under this name (Capacitor's
// default is https://localhost). It is only a label: no website is needed
// there, but the API's CORS_ORIGINS must list it, because requests made from
// the app's WebView carry it as their Origin.
const config: CapacitorConfig = {
  appId: 'lk.blynk.admin',
  appName: 'Blynk Admin',
  webDir: 'dist',
  server: { hostname: 'admin.app.blynk.lk', androidScheme: 'https' },
};

export default config;
