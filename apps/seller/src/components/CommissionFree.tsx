import { useSeller } from '../auth/SellerContext';
import { freePeriodView } from '../lib/commission';
import { IconCheckCircle, IconSpark } from './icons';

/**
 * The commission-free month on the home screen and My shop: a countdown with a bar of the days
 * used, "Last commission-free day" on the last one, and a short "it is over" note for a week
 * after. Nothing at all when the shop has no free period.
 */
export function CommissionFreeCard({ now }: { now?: Date }) {
  const { seller } = useSeller();
  if (!seller) return null;
  const view = freePeriodView(seller, now);
  if (!view) return null;

  if (view.kind === 'ended') {
    return (
      <p className="free free--ended notice notice--row" role="status" data-testid="commission-free" data-kind="ended">
        <span className="notice__icon" aria-hidden="true">
          <IconCheckCircle size={20} />
        </span>
        <span className="notice__body">{view.message}</span>
      </p>
    );
  }

  return (
    <section
      className={`free free--${view.kind} rise`}
      aria-label="Commission-free month"
      data-testid="commission-free"
      data-kind={view.kind}
    >
      <span className="free__icon" aria-hidden="true">
        <IconSpark size={22} />
      </span>
      <div className="free__body">
        <p className="free__text">
          {view.lead ? <span className="free__lead">{view.lead} </span> : null}
          <strong className="free__days">{view.emphasis}</strong>
        </p>
        <p className="free__sub">Blynk takes no commission on what you sell during your first month.</p>
        {view.percent !== null && view.total !== null && view.used !== null ? (
          <div
            className="free__bar"
            role="progressbar"
            aria-label="Days of the commission-free month used"
            aria-valuemin={0}
            aria-valuemax={view.total}
            aria-valuenow={view.used}
            aria-valuetext={`${view.used} of ${view.total} days used`}
          >
            <span style={{ width: `${view.percent}%` }} />
          </div>
        ) : null}
      </div>
    </section>
  );
}
