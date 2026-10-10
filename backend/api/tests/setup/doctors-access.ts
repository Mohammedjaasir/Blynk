import { doctorsAccess } from '../../src/modules/configuration/doctors-access.js';

// "Doctors need sign-in" (owner, 2026-10-10) is on by default: a guest gets
// 401 SIGN_IN_REQUIRED from the customer dental discovery routes. Suites
// written before it browse clinics and doctors as guests, so pin it off here;
// tests/doctors-access.test.ts switches back to doctorsAccess.realRead to test
// the stored setting and the default.
doctorsAccess.read = async () => ({ require_sign_in: false });
