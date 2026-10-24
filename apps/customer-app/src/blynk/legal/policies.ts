/*
 * The landing site's policy pages (Privacy /privacy, Terms /terms, Refunds /refunds), opened
 * in the browser: a new tab on the web (the app stays where it was), the system browser on a phone.
 */

import { localized } from '@/blynk/i18n/localized';

export const SITE = 'https://blynk.lk';

export type PolicyKind = 'privacy' | 'terms' | 'refunds';

/** The page of each policy on the landing site (not words: never translated). */
const POLICY_PATHS: Record<PolicyKind, string> = { privacy: '/privacy', terms: '/terms', refunds: '/refunds' };

export const POLICIES = localized<Record<PolicyKind, { label: string }>>(
  {
    privacy: { label: 'Privacy Policy' },
    terms: { label: 'Terms' },
    refunds: { label: 'Refund Policy' },
  },
  {
    si: {
      privacy: { label: 'රහස්‍යතා ප්‍රතිපත්තිය' },
      terms: { label: 'නියම සහ කොන්දේසි' },
      refunds: { label: 'ආපසු ගෙවීමේ ප්‍රතිපත්තිය' },
    },
    ta: {
      privacy: { label: 'தனியுரிமைக் கொள்கை' },
      terms: { label: 'விதிமுறைகள்' },
      refunds: { label: 'ரீஃபண்ட் கொள்கை' },
    },
  },
  'legal.POLICIES',
);

export const POLICY_ORDER: readonly PolicyKind[] = ['terms', 'privacy', 'refunds'];

export const policyUrl = (k: PolicyKind) => `${SITE}${POLICY_PATHS[k]}`;

export const LEGAL = localized(
  {
    agreePrefix: 'By continuing you agree to the ',
    and: ' and ',
    agreeSuffix: '.',
    policiesTitle: 'Policies',
  },
  {
    // the policy names are links in the middle of the sentence: "<Terms> සහ <Privacy Policy> වලට එකඟ වෙනවා."
    si: { agreePrefix: 'ඉදිරියට යාමෙන් ඔබ ', and: ' සහ ', agreeSuffix: ' වලට එකඟ වෙනවා.', policiesTitle: 'ප්‍රතිපත්ති' },
    ta: { agreePrefix: 'தொடர்வதன் மூலம் நீங்கள் ', and: ' மற்றும் ', agreeSuffix: ' ஆகியவற்றை ஏற்றுக்கொள்கிறீர்கள்.', policiesTitle: 'கொள்கைகள்' },
  },
  'legal.LEGAL',
);

export type Opener = {
  /** Platform.OS */
  os: string;
  /** window.open on the web. */
  open?: (url: string, target: string, features: string) => unknown;
  /** Linking.openURL on a phone. */
  openURL: (url: string) => Promise<unknown>;
};

/** Open a policy page (a new tab on the web, the browser on a phone); returns the URL. Pure: see open.ts for the wiring. */
export function openPolicyWith(k: PolicyKind, deps: Opener): string {
  const url = policyUrl(k);
  if (deps.os === 'web' && deps.open) {
    deps.open(url, '_blank', 'noopener,noreferrer');
    return url;
  }
  deps.openURL(url).catch(() => undefined);
  return url;
}
