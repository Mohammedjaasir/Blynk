import type { Seller, SellerProduct } from '../api/types';
import { shopLocation } from './location';

/**
 * The getting-started tracker on My products: five steps from "shop created"
 * to "selling". Pure, so it is tested on its own (src/test/onboarding.test.ts).
 *
 *  done     - finished
 *  current  - the seller's turn: there is something to do now
 *  waiting  - Blynk's turn: nothing to do but wait
 *  problem  - Blynk turned it down: fix and send again
 *  next     - later, after an earlier step
 */
export type StepState = 'done' | 'current' | 'waiting' | 'problem' | 'next';
export type StepKey = 'created' | 'pin' | 'checked' | 'first-product' | 'selling';

export interface OnboardingStep {
  key: StepKey;
  title: string;
  state: StepState;
  detail: string;
  action: { label: string; to: string } | null;
}

export interface Onboarding {
  steps: OnboardingStep[];
  doneCount: number;
  total: number;
  /** Every step finished: the tracker gives way to the shop's numbers. */
  complete: boolean;
}

export function onboarding(seller: Seller, products: SellerProduct[] | null): Onboarding {
  const location = shopLocation(seller);
  const approved = seller.status === 'APPROVED';
  const list = products ?? [];
  const hasProduct = list.length > 0;
  const anyLive = list.some((p) => p.live && p.is_active);

  const pin: OnboardingStep =
    location.status === 'APPROVED'
      ? {
          key: 'pin',
          title: 'Pin your shop - Blynk approves the location',
          state: 'done',
          detail: 'Location approved. Delivery charges are worked out from here.',
          action: { label: 'View on map', to: '/shop#location' },
        }
      : location.status === 'PENDING'
        ? {
            key: 'pin',
            title: 'Pin your shop - Blynk approves the location',
            state: 'waiting',
            detail: 'Pin sent. Blynk is checking the location.',
            action: { label: 'See your pin', to: '/shop#location' },
          }
        : location.status === 'REJECTED'
          ? {
              key: 'pin',
              title: 'Pin your shop - Blynk approves the location',
              state: 'problem',
              detail: location.rejectReason
                ? `Location not approved: ${location.rejectReason}`
                : 'Location not approved. Move the pin and send it again.',
              action: { label: 'Move the pin', to: '/shop#location' },
            }
          : {
              key: 'pin',
              title: 'Pin your shop - Blynk approves the location',
              state: 'current',
              detail: 'Put the pin on your shop so riders can find it.',
              action: { label: 'Pin your shop', to: '/shop#location' },
            };

  const checked: OnboardingStep =
    seller.status === 'APPROVED'
      ? { key: 'checked', title: 'Blynk checks your shop', state: 'done', detail: 'Your shop is open on Blynk.', action: null }
      : seller.status === 'REJECTED'
        ? {
            key: 'checked',
            title: 'Blynk checks your shop',
            state: 'problem',
            detail: 'Blynk needs a change before it can approve you.',
            action: { label: 'Update and resend', to: '/shop' },
          }
        : seller.status === 'SUSPENDED'
          ? {
              key: 'checked',
              title: 'Blynk checks your shop',
              state: 'problem',
              detail: 'Your shop is switched off. Please contact Blynk.',
              action: null,
            }
          : {
              key: 'checked',
              title: 'Blynk checks your shop',
              state: 'waiting',
              detail: 'Usually within a day or two. We will let you know.',
              action: null,
            };

  const first: OnboardingStep = hasProduct
    ? {
        key: 'first-product',
        title: 'Add your first product',
        state: 'done',
        detail: `${list.length} product${list.length === 1 ? '' : 's'} sent to Blynk.`,
        action: null,
      }
    : approved
      ? {
          key: 'first-product',
          title: 'Add your first product',
          state: 'current',
          detail: 'A photo, a name and your price. It takes a minute.',
          action: { label: 'Add it now', to: '/products/new' },
        }
      : {
          key: 'first-product',
          title: 'Add your first product',
          state: 'next',
          detail: 'Opens as soon as your shop is approved.',
          action: null,
        };

  const selling: OnboardingStep = anyLive
    ? { key: 'selling', title: 'Start selling', state: 'done', detail: 'Customers can order your products.', action: null }
    : hasProduct && approved
      ? {
          key: 'selling',
          title: 'Start selling',
          state: 'waiting',
          detail: 'Blynk checks each product and sets the customer price.',
          action: null,
        }
      : {
          key: 'selling',
          title: 'Start selling',
          state: 'next',
          detail: 'Your products go live in the Blynk app.',
          action: null,
        };

  const steps: OnboardingStep[] = [
    {
      key: 'created',
      title: 'Shop created',
      state: 'done',
      detail: 'Your Blynk seller account is ready.',
      action: null,
    },
    pin,
    checked,
    first,
    selling,
  ];
  const doneCount = steps.filter((s) => s.state === 'done').length;
  return { steps, doneCount, total: steps.length, complete: doneCount === steps.length };
}

/** "Good morning" by the time in Colombo. */
export function greeting(now = new Date()): string {
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: 'Asia/Colombo' }).format(now)
  );
  if (hour >= 4 && hour < 12) return 'Good morning';
  if (hour >= 12 && hour < 17) return 'Good afternoon';
  return 'Good evening';
}
