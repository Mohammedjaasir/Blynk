import { DEFAULT_STORED_SCHEDULE, storeSchedule } from '../../src/modules/configuration/store-schedule.js';

// Store timing (owner, 2026-10-10) is set by Ops and Admin and stored in
// system_configurations. Suites written before it assume the default
// 08:00 - 21:00 every day, open, slots off - pin that here so hours someone
// edited in the local database cannot break them. tests/store-schedule.test.ts
// switches back to storeSchedule.realRead to test the stored settings.
storeSchedule.read = async () => DEFAULT_STORED_SCHEDULE;
