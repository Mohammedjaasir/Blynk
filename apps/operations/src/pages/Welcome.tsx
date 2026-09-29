import { Bike, Package, ShoppingCart, Stethoscope } from 'lucide-react';
import { useLocation, useNavigate, type Location } from 'react-router-dom';

/**
 * The welcome screen (2026-09-28), after the owner's reference design: the
 * Blynk mark, a two-line headline (second line in Blynk green), the scene
 * (public/intro-art.jpg - replace that file to change the picture), the
 * feature cards and the actions.
 *
 * - Shown on EVERY launch: the flag lives in memory, so each cold start shows
 *   it once (`IntroGate` in App.tsx).
 * - Every action continues to where the launch was headed: sign-in when signed
 *   out, the app when signed in. Staff accounts are created by an admin, so
 *   "Get Started" and "I Already Have an Account" both lead to sign-in.
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

  return (
    <main className="intro">
      <header className="intro__top">
        <span className="intro__brand">
          <img src="/blynk-mark.png" alt="" />
          <span>blynk</span>
        </span>
        <button type="button" className="intro__skip" onClick={go}>
          Skip
        </button>
      </header>

      <h1 className="intro__title">
        Run Blynk.{' '}
        <br />
        <em>From One Place.</em>
      </h1>
      <p className="intro__lead">Manage orders, deliveries, inventory, riders and channel doctors from a single workspace.</p>

      <div className="intro__art" aria-hidden="true">
        <img src="/intro-art.jpg" alt="" />
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
        <button type="button" className="intro__cta" onClick={go}>
          Get Started <span aria-hidden="true">→</span>
        </button>
        <button type="button" className="intro__secondary" onClick={go}>
          I Already Have an Account
        </button>
      </div>
    </main>
  );
}
