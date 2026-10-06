import { orderingClock } from '../../src/utils/time.js';

// Orders are refused outside 8 AM - 9 PM Colombo time. Pin the checkout clock
// to midday Colombo (06:30 UTC) so order tests pass whatever hour they run;
// a test about the closed hours sets orderingClock.now itself and restores it.
orderingClock.now = () => new Date('2026-10-06T06:30:00.000Z');
