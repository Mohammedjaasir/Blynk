import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { productionApiUrlProblem } from './src/lib/apiBaseUrl';

export default defineConfig(({ mode }) => {
  // A production bundle has the API address compiled in. Refuse to build one
  // without a public https address, so a localhost or plain-http value can
  // never ship. Development values belong in .env.development.local only.
  if (mode === 'production') {
    const env = loadEnv(mode, process.cwd(), 'VITE_');
    const problem = productionApiUrlProblem(process.env.VITE_API_BASE_URL ?? env.VITE_API_BASE_URL);
    if (problem) throw new Error(`[blynk-inventory] ${problem}`);
  }

  return {
    plugins: [react()],
    server: {
      // Admin runs on 5173; Inventory is a separate app on its own port.
      port: 5174,
      strictPort: true,
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test/setup.ts'],
    },
  };
});
