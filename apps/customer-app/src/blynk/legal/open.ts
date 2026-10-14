import { Linking, Platform } from 'react-native';
import { openPolicyWith, type PolicyKind } from './policies';

/** Open Privacy / Terms / Refunds on blynk.lk in the browser. */
export function openPolicy(k: PolicyKind): string {
  const w = typeof window !== 'undefined' && typeof window.open === 'function' ? window : null;
  return openPolicyWith(k, { os: Platform.OS, open: w ? (u, t, f) => w.open(u, t, f) : undefined, openURL: (u) => Linking.openURL(u) });
}
