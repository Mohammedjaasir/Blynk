import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { useSession } from '@/blynk/auth/session';
import { useStore } from '@/blynk/store/StoreContext';
import { Page, StateView } from '@/blynk/ui/kit';
import { openSignIn } from '@/blynk/ui/signIn';
import { DEMO } from '@/demo/mode';
import { DOCTORS_OFF } from '@/blynk/ui/strings';
import { doctorsGate, doctorsVisible, DOCTORS_SIGN_IN } from './access';
import { DOCTOR_UI as W } from './words';

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
    return <Page title={W.title}><StateView title={W.title} message={W.preview} /></Page>;
  }
  // switched off in Admin / Ops (GET /store doctors_enabled false): a deep link lands here, not on a 404
  if (store && !doctorsVisible(store)) {
    return (
      <Page title={W.title}>
        <StateView
          title={DOCTORS_OFF.title}
          message={signedIn ? DOCTORS_OFF.message : null}
          action={signedIn ? DOCTORS_OFF.myAppointments : DOCTORS_OFF.goToShop}
          onAction={() => (signedIn ? router.replace('/doctors/appointments') : router.dismissTo('/home'))}
        />
      </Page>
    );
  }
  if (doctorsGate(signedIn, store) === 'sign-in') {
    return <Page title={W.title}><DoctorsSignInPrompt /></Page>;
  }
  return <>{children}</>;
}
