/**
 * Postgres advisory lock key that pauses the outbox worker's polling loop.
 *
 * While any session holds this lock exclusively (`pg_advisory_lock`), a
 * polling worker's claim finds it cannot take the lock in shared mode and
 * claims nothing; workers never block each other, because they only ever take
 * it shared. Direct `processBatch()` calls ignore it. Nothing in the
 * application takes it: the backend test suite holds it for the length of a
 * run (tests/setup/db-hygiene.ts) so that a development API sharing the
 * database never races the tests.
 */
export const OUTBOX_PAUSE_LOCK_KEY = 482_615_019;
