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
      // Pins the checkout clock inside ordering hours (8 AM - 9 PM Colombo).
      // Pins the checkout switches to coupons on, no free deliveries.
      // Pins the store timing to the defaults (store-schedule.ts).
      setupFiles: ['./tests/setup/ordering-clock.ts', './tests/setup/checkout-settings.ts', './tests/setup/store-schedule.ts'],
    },
  };
});
