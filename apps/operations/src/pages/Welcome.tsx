import { Bike, Package, ShoppingCart, Stethoscope } from 'lucide-react';
import { useLocation, useNavigate, type Location } from 'react-router-dom';

/**
 * The welcome screen: the Blynk mark tagged OPS, a two-line headline, an
 * illustrated order board, the feature cards and "Sign in". Since 2026-10-07
 * it is dark, like Ops sign-in, and no longer shares the Rider app's scooter
 * scene (owner: "ops and rider both look the same").
 *
 * - Shown on EVERY launch: the flag lives in memory, so each cold start shows
 *   it once (`IntroGate` in App.tsx).
 * - "Sign in" continues to where the launch was headed: sign-in when signed
 *   out, the app when signed in. Staff accounts are created by an admin.
 */
let seenThisLaunch = false;

export function hasSeenIntro(): boolean {
  return seenThisLaunch;
}

export function markIntroSeen() {
  seenThisLaunch = true;
}

/** Tests only: behave like a fresh launch. */
export function resetIntroForTests() {
  seenThisLaunch = false;
}

const ICON = { size: 24, strokeWidth: 2, 'aria-hidden': true } as const;
const FEATURES = [
  { title: 'Manage Orders', text: 'Track and process all orders in real time.', tone: 'yellow', icon: <ShoppingCart {...ICON} /> },
  { title: 'Handle Deliveries', text: 'Follow riders and delivery progress on the map.', tone: 'green', icon: <Bike {...ICON} /> },
  { title: 'Control Inventory', text: 'Keep stock updated and never run out.', tone: 'purple', icon: <Package {...ICON} /> },
  { title: 'Channel Doctors', text: 'Handle clinics, doctors and appointments.', tone: 'blue', icon: <Stethoscope {...ICON} /> },
] as const;

export function Welcome() {
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: Location } | null)?.from;

  function go() {
    markIntroSeen();
    const target = from && from.pathname !== '/welcome' ? from.pathname + from.search : '/';
    navigate(target, { replace: true });
  }

  // The Ops welcome (owner, 2026-10-07): its own dark "control room" look,
  // matching Ops sign-in, so it is never mistaken for the Rider app (which
  // keeps the scooter scene). The board is an illustration, not live data.
  return (
    <main className="intro intro--ops">
      <header className="intro__top">
        <span className="intro__brand">
          <img src="/blynk-mark.png" alt="" />
          <span>
            blynk <small className="intro__tag">OPS</small>
          </span>
        </span>
      </header>

      <h1 className="intro__title">
        Run Blynk.{' '}
        <br />
        <em>From One Place.</em>
      </h1>
      <p className="intro__lead">Manage orders, deliveries, inventory, riders and channel doctors from a single workspace.</p>

      <div className="ops-board" aria-hidden="true">
        <div className="ops-board__row ops-board__row--packed">
          <span className="ops-board__dot" />
          <span className="ops-board__main">
            <b>New order packed</b>
            <small>Assign a rider</small>
          </span>
          <span className="ops-board__chip ops-board__chip--yellow">Packed</span>
        </div>
        <div className="ops-board__row ops-board__row--road">
          <span className="ops-board__dot" />
          <span className="ops-board__main">
            <b>Rider on the way</b>
            <small>Live on the map</small>
          </span>
          <span className="ops-board__chip ops-board__chip--green">On the road</span>
        </div>
        <div className="ops-board__row ops-board__row--low">
          <span className="ops-board__dot" />
          <span className="ops-board__main">
            <b>Running low</b>
            <small>Restock before it runs out</small>
          </span>
          <span className="ops-board__chip ops-board__chip--red">Low stock</span>
        </div>
      </div>

      <ul className="intro__features intro__features--4">
        {FEATURES.map((f) => (
          <li key={f.title}>
            <span className={`intro__icon intro__icon--${f.tone}`}>{f.icon}</span>
            <strong>{f.title}</strong>
            <span>{f.text}</span>
          </li>
        ))}
      </ul>

      <div className="intro__actions">
        {/* Staff accounts are made by an admin: there is nothing to "get started" with. */}
        <button type="button" className="intro__cta" onClick={go}>
          Sign in <span aria-hidden="true">→</span>
        </button>
      </div>
    </main>
  );
}
