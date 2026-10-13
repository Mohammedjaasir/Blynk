import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { assertProductionEnv } from './src/build-env';

export default defineConfig(({ command, mode }) => {
  if (command === 'build' && mode === 'production') {
    assertProductionEnv(loadEnv(mode, process.cwd(), 'VITE_'));
  }
  return {
    base: '/app/',
    plugins: [react()],
    server: { port: 5177, strictPort: true },
    test: { environment: 'jsdom', globals: true, setupFiles: ['./src/test/setup.ts'] },
  };
});
