import { checkoutSettings } from '../../src/modules/configuration/settings.service.js';

// The checkout switches (owner, 2026-10-08) default to coupons off and two
// free deliveries for new customers. Suites written before them place orders
// with coupons and expect the full delivery fee, so pin the switches to the
// earlier behaviour here; tests/checkout-settings.test.ts restores the real
// reader to test the switches themselves.
checkoutSettings.read = async () => ({
  coupons_enabled: true,
  new_customer_free_deliveries: { enabled: false, count: 0, since: '2026-10-08T18:30:00.000Z' },
});
