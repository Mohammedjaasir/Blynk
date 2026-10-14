import type { CheckoutForm } from './form';

/*
 * The in-app PayHere browser. On the web the checkout form is posted in the same tab instead
 * (submitWebForm), so this renders nothing; PayHereBrowser.native.tsx is the phone version.
 */
export type PayHereBrowserProps = {
  form: CheckoutForm;
  entries: [string, string][];
  /** PayHere sent the customer back (return_url or cancel_url): close and check the order. */
  onBack: (kind: 'return' | 'cancel') => void;
  /** The customer closed the browser themselves. */
  onClose: () => void;
};

export function PayHereBrowser(_props: PayHereBrowserProps) {
  return null;
}
