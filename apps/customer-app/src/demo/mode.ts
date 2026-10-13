/**
 * Design-mock mode (owner, 2026-10-13): every screen shows the reference video's own
 * content from src/demo/*, and nothing is fetched. Build or start with EXPO_PUBLIC_DEMO=0
 * to switch the same screens to live Blynk data (GET /store, the catalogue), which Admin
 * and Ops control. Default (unset) stays the design mock.
 */
export const DEMO = process.env.EXPO_PUBLIC_DEMO !== '0';
