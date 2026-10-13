import { router } from 'expo-router';

/*
 * In-memory state of one sign-in attempt. The development-only code from a non-production
 * backend (dev_otp) is kept here, never in the URL, and only for the number it was sent to.
 */
let pending: { phone: string; devOtp?: string } | null = null;

export const setPendingOtp = (phone: string, devOtp?: string) => { pending = { phone, devOtp }; };
export const devOtpFor = (phone: string) => (pending?.phone === phone ? pending.devOtp : undefined);

/** Design-mock mode: the first mock sign-in on this page load previews registration. */
export const demoFlow = { registered: false };

/** Back to the cart the customer came from (or to it, when the page was reloaded). */
export const returnToCart = () => (router.canGoBack() ? router.back() : router.replace('/cart'));
