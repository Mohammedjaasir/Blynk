import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { apiBaseUrlProblem } from './src/lib/build-env';

/*
 * Building the Android APK (or the web bundle) - the API address is baked in
 * at build time, so set it for the build:
 *
 *   VITE_API_BASE_URL=https://api.blynk.lk/api/v1 npm run build && npx cap sync android
 *   (PowerShell: $env:VITE_API_BASE_URL='https://api.blynk.lk/api/v1'; npm run build; npx cap sync android)
 *   then build the APK from android/ (./gradlew assembleRelease or Android Studio).
 *
 * Local development values belong in .env.development.local (read only by
 * `npm run dev`), never .env.local - Vite reads .env.local for production
 * builds too. A production build stops with an explanation if the address
 * is missing, not https, or points at localhost. The LAN test APK
 * (CAP_LAN_HTTP=1, scripts/lan-android-config.mjs) may use http to a private
 * LAN IPv4 only.
 */
export default defineConfig(({ command, mode }) => {
  if (command === 'build' && mode === 'production') {
    const env = loadEnv(mode, process.cwd(), 'VITE_');
    const problem = apiBaseUrlProblem(process.env.VITE_API_BASE_URL ?? env.VITE_API_BASE_URL, {
      lanHttp: process.env.CAP_LAN_HTTP === '1',
    });
    if (problem) throw new Error(`\n\nBlynk Operations build stopped: ${problem}\n`);
  }

  return {
    plugins: [react()],
    server: {
      // Admin runs on 5173, Inventory on 5174 and Rider on 5175; Operations is
      // a separate app on its own port.
      port: 5176,
      strictPort: true,
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test/setup.ts'],
    },
  };
});
