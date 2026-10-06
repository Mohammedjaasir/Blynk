import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { assertProductionEnv } from './src/build-env';

export default defineConfig(({ command, mode }) => {
  // A production bundle must never fall back to a localhost or plain-http API.
  if (command === 'build' && mode === 'production') {
    // loadEnv also reads VITE_* from the shell (CI), which win over .env files.
    assertProductionEnv(loadEnv(mode, process.cwd(), 'VITE_'));
  }
  return {
    plugins: [react()],
    server: {
      // Admin runs on 5173 and Inventory on 5174; Rider is a separate app.
      port: 5175,
      strictPort: true,
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test/setup.ts'],
    },
  };
});

