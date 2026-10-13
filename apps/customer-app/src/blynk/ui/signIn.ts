import { router } from 'expo-router';

/**
 * Where a guest goes to log in or sign up from these screens. Today sign-in lives in the cart's
 * phone sheet (My orders says "Log in from your cart" the same way); when the app gets its own
 * login route, change it here only.
 */
export const SIGN_IN_PATH = '/cart';

export const openSignIn = () => router.push(SIGN_IN_PATH);
