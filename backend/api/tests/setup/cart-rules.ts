import { cartRulesService } from '../../src/modules/configuration/cart-rules.js';

// "One seller per order" (owner's brother, 2026-10-27) is ON by default: POST /orders refuses a cart that
// mixes sellers (or a seller and Blynk's own products). Suites written before it order such carts
// (pickup-point fees, seller statements and payouts, purchase orders), so pin it off here;
// tests/cart-rules.test.ts removes this pin (delete cartRulesService.read) to test the setting, the
// default and the refusal itself.
cartRulesService.read = async () => ({ one_seller_per_order: { enabled: false } });
