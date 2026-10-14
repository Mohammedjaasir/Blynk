/*
 * The landing site's policy pages (Privacy /privacy, Terms /terms, Refunds /refunds), opened
 * in the browser: a new tab on the web (the app stays where it was), the system browser on a phone.
 */

export const SITE = 'https://blynk.lk';

export type PolicyKind = 'privacy' | 'terms' | 'refunds';

export const POLICIES: Record<PolicyKind, { label: string; path: string }> = {
  privacy: { label: 'Privacy Policy', path: '/privacy' },
  terms: { label: 'Terms', path: '/terms' },
  refunds: { label: 'Refund Policy', path: '/refunds' },
};

export const POLICY_ORDER: readonly PolicyKind[] = ['terms', 'privacy', 'refunds'];

export const policyUrl = (k: PolicyKind) => `${SITE}${POLICIES[k].path}`;

export const LEGAL = {
  agreePrefix: 'By continuing you agree to the ',
  and: ' and ',
  agreeSuffix: '.',
  policiesTitle: 'Policies',
};

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
