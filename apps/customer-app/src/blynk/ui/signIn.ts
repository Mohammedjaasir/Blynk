import { router } from 'expo-router';

/**
 * Where a guest goes to log in or sign up from these screens (orders, an order, tracking,
 * doctors, refer, points, notify me): the login screen (Flutter's '/login'). It is pushed, so
 * once the code is verified (/otp goes back, or /register -> /birthday for a new account) the
 * customer lands back on the screen they tapped "Log in" on. The cart keeps its own phone sheet.
 */
export const SIGN_IN_PATH = '/login';

export const openSignIn = () => router.push(SIGN_IN_PATH);
