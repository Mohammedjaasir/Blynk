import { defineConfig } from 'vitest/config';

export default defineConfig(({ mode }) => {
  // Every run pauses the outbox worker's polling loop so a development API
  // sharing the database never races the tests; `npm run test:hygiene`
  // (vitest --mode hygiene) also fails the run if it leaves the database
  // different from how it found it (tests/setup/db-hygiene.ts).
  if (mode === 'hygiene') process.env.DB_HYGIENE = '1';
  return {
    test: {
      testTimeout: 15000,
      hookTimeout: 15000,
      fileParallelism: false,
      environment: 'node',
      globalSetup: ['./tests/setup/db-hygiene.ts'],
    },
  };
});
