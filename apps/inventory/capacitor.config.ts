import type { CapacitorConfig } from '@capacitor/cli';

// Blynk Inventory as an Android app (2026-09-28), wrapped like apps/operations and
// apps/rider. The web build in dist/ is the whole app; VITE_API_BASE_URL is
// baked in by `vite build`. Served from https://localhost inside the app, so
// the API's CORS_ORIGINS must include https://localhost.
const config: CapacitorConfig = {
  appId: 'lk.blynk.inventory',
  appName: 'Blynk Inventory',
  webDir: 'dist',
};

export default config;
