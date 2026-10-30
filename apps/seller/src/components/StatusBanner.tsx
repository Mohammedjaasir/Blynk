import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Seller } from '../api/types';
import { IconAlert, IconClock, IconPause } from './icons';

function Banner({
  tone,
  status,
  icon,
  children,
}: {
  tone: 'wait' | 'bad';
  status: Seller['status'];
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={`banner banner--${tone}`} role="status" data-status={status}>
      <span className="banner__icon" aria-hidden="true">
        {icon}
      </span>
      <div className="banner__text">{children}</div>
    </div>
  );
}

/**
 * Where the shop stands with Blynk, shown on every screen while it is waiting, not approved or
 * switched off. An APPROVED shop sees nothing here (it was "Your shop is approved." on every screen).
 */
export function StatusBanner({ seller }: { seller: Seller }): JSX.Element | null {
  switch (seller.status) {
    case 'PENDING':
      return (
        <Banner tone="wait" status="PENDING" icon={<IconClock size={22} />}>
          <strong>Waiting for Blynk to approve your shop.</strong>
          <span>
            You can look around and fill in your <Link to="/shop">shop details</Link>. You can add products once Blynk
            approves you.
          </span>
        </Banner>
      );
    case 'REJECTED':
      return (
        <Banner tone="bad" status="REJECTED" icon={<IconAlert size={22} />}>
          <strong>Blynk could not approve your shop.</strong>
          {seller.rejection_reason ? <span>Reason: {seller.rejection_reason}</span> : null}
          <span>
            You can update your <Link to="/shop">shop details</Link>. You cannot add products until you are approved.
          </span>
        </Banner>
      );
    case 'SUSPENDED':
      return (
        <Banner tone="bad" status="SUSPENDED" icon={<IconPause size={22} />}>
          <strong>Your shop is switched off by Blynk.</strong>
          <span>Your products are hidden from customers and you cannot add or change products. Please contact Blynk.</span>
        </Banner>
      );
    case 'APPROVED':
      // Nothing to tell an approved shop: the banner is only for a shop that needs attention.
      return null;
  }
}
