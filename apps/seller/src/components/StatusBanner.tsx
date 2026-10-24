import { Link } from 'react-router-dom';
import type { Seller } from '../api/types';

/**
 * Where the shop stands with Blynk, shown on every screen. Only an APPROVED
 * shop can add or change products.
 */
export function StatusBanner({ seller }: { seller: Seller }) {
  switch (seller.status) {
    case 'PENDING':
      return (
        <div className="banner banner--wait" role="status" data-status="PENDING">
          <strong>Waiting for Blynk to approve your shop.</strong>
          <span>
            You can look around and fill in your <Link to="/shop">shop details</Link>. You can add products once Blynk
            approves you.
          </span>
        </div>
      );
    case 'REJECTED':
      return (
        <div className="banner banner--bad" role="status" data-status="REJECTED">
          <strong>Blynk could not approve your shop.</strong>
          {seller.rejection_reason ? <span>Reason: {seller.rejection_reason}</span> : null}
          <span>
            You can update your <Link to="/shop">shop details</Link>. You cannot add products until you are approved.
          </span>
        </div>
      );
    case 'SUSPENDED':
      return (
        <div className="banner banner--bad" role="status" data-status="SUSPENDED">
          <strong>Your shop is switched off by Blynk.</strong>
          <span>Your products are hidden from customers and you cannot add or change products. Please contact Blynk.</span>
        </div>
      );
    case 'APPROVED':
      return (
        <div className="banner banner--ok" role="status" data-status="APPROVED">
          <strong>Your shop is approved.</strong>
          <span>Add products below. Blynk checks each one and sets the customer price before it goes live.</span>
        </div>
      );
  }
}
