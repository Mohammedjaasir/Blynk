import { MapPin, Package, Wallet } from 'lucide-react';
import { useLocation, useNavigate, type Location } from 'react-router-dom';

/**
 * The Rider welcome screen (2026-09-28), after the owner's reference: the
 * brand, "Deliver Happiness / Earn More", the delivery scene, three feature
 * cards and the actions.
 *
 * - Shown on EVERY launch, like Blynk Ops' welcome: the flag lives in memory,
 *   so each cold start shows it once (`IntroGate` in App.tsx).
 * - "Get Started", "I Already Have an Account" and "Skip" all continue to
 *   where the launch was headed - sign-in when signed out, the queue when
 *   signed in. Rider accounts are created by the store, so there is no
 *   separate sign-up.
 * - "Good Earnings" wears a wallet, not a currency sign: Blynk prices are in
 *   LKR, and the reference's rupee symbol is India's.
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

const ICON = { size: 22, strokeWidth: 2, 'aria-hidden': true } as const;
const FEATURES = [
  { title: 'Good Earnings', text: 'Earn with every delivery', tone: 'yellow', icon: <Wallet {...ICON} /> },
  { title: 'Flexible Hours', text: 'Ride when it suits you', tone: 'green', icon: <MapPin {...ICON} /> },
  { title: 'Be Part of the Community', text: 'Get people their essentials on time', tone: 'blue', icon: <Package {...ICON} /> },
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
    <main className="rwelcome">
      <header className="rwelcome__top">
        <span className="rwelcome__brand">
          <img src="/blynk-mark.png" alt="" />
          <span>blynk</span>
        </span>
        <button type="button" className="rwelcome__skip" onClick={go}>
          Skip
        </button>
      </header>

      <h1 className="rwelcome__title">
        Deliver Happiness{' '}
        <br />
        <em>Earn More</em>
      </h1>
      <p className="rwelcome__lead">
        Join the Blynk rider team and start delivering groceries and essentials in your area.
      </p>

      <div className="rwelcome__art" aria-hidden="true">
        <img src="/intro-scooter.jpg" alt="" />
      </div>

      <ul className="rwelcome__features">
        {FEATURES.map((f) => (
          <li key={f.title}>
            <span className={`rwelcome__icon rwelcome__icon--${f.tone}`}>{f.icon}</span>
            <strong>{f.title}</strong>
            <span>{f.text}</span>
          </li>
        ))}
      </ul>

      <div className="rwelcome__actions">
        <button type="button" className="rwelcome__cta" onClick={go}>
          Get Started <span aria-hidden="true">→</span>
        </button>
        <button type="button" className="rwelcome__secondary" onClick={go}>
          I Already Have an Account
        </button>
      </div>
    </main>
  );
}
