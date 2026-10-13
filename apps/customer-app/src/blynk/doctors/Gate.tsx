import type { ReactNode } from 'react';
import { useSession } from '@/blynk/auth/session';
import { useStore } from '@/blynk/store/StoreContext';
import { Page, StateView } from '@/blynk/ui/kit';
import { openSignIn } from '@/blynk/ui/signIn';
import { DEMO } from '@/demo/mode';
import { doctorsGate, DOCTORS_SIGN_IN } from './access';

/** The sign-in prompt, inside any doctors screen (also for a server SIGN_IN_REQUIRED). */
export const DoctorsSignInPrompt = ({ title = DOCTORS_SIGN_IN.title }: { title?: string }) => (
  <StateView title={title} message={DOCTORS_SIGN_IN.message} action={DOCTORS_SIGN_IN.action} onAction={openSignIn} />
);

/**
 * The clinic list, a clinic, a doctor and booking sit behind this (Flutter DentalSignInGate): a
 * guest sees "Sign in to see doctors" while Doctors need sign-in is on. The design mock shows a
 * preview note: it fetches nothing.
 */
export function DoctorsGate({ children }: { children: ReactNode }) {
  const signedIn = !!useSession();
  const store = useStore();
  if (DEMO) {
    return <Page title="Channel doctors"><StateView title="Channel doctors" message="Book a doctor here once the shop is live. This is a preview." /></Page>;
  }
  if (doctorsGate(signedIn, store) === 'sign-in') {
    return <Page title="Channel doctors"><DoctorsSignInPrompt /></Page>;
  }
  return <>{children}</>;
}
