import { defineConfig } from 'vitest/config';

// Pure-logic tests only (pricing, money, cart, store text, API client): no React Native in Node.
export default defineConfig({
  test: { include: ['src/blynk/**/*.test.ts'], environment: 'node' },
});
