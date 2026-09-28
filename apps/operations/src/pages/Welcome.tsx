import { Bike, Boxes, ClipboardList, Tags } from 'lucide-react';
import { useLocation, useNavigate, type Location } from 'react-router-dom';

/**
 * The Ops welcome screen, after the owner's reference design.
 *
 * - Shown on EVERY launch (2026-09-27, owner's request), signed in or not:
 *   the flag lives in memory, so each cold start of the app shows it once.
 *   `IntroGate` in App.tsx sends every first navigation here.
 * - Layout: the delivery scene fills the top; a white panel rises over it
 *   with the headline, the four areas of the app and the button pinned to
 *   the bottom - no dead space on a phone, no scrolling.
 * - "Get Started" and "Skip" both continue to where the operator was going
 *   (sign-in when signed out, Home when signed in).
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

// Lucide icons (2026-09-27): the hand-drawn set read as improvised. One
// stroke weight, one colour - four areas of one tool, not four toys.
const ICON = { size: 20, strokeWidth: 1.9, 'aria-hidden': true } as const;
const FEATURES = [
  { title: 'Orders', text: 'Accept, pack and hand over', icon: <ClipboardList {...ICON} /> },
  { title: 'Deliveries', text: 'Assign riders, track trips', icon: <Bike {...ICON} /> },
  { title: 'Catalog', text: 'Products, prices, banners', icon: <Tags {...ICON} /> },
  { title: 'Stock', text: 'Levels, suppliers, sourcing', icon: <Boxes {...ICON} /> },
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
    <main className="welcome">
      <div className="welcome__hero">
        <img className="welcome__scene" src="/intro-scooter.jpg" alt="" />
        <div className="welcome__bar">
          <span className="welcome__badge">
            <img src="/blynk-mark.png" alt="" />
            <span>
              Blynk <b>Operations</b>
            </span>
          </span>
          <button type="button" className="welcome__skip" onClick={go}>
            Skip
          </button>
        </div>
      </div>

      <section className="welcome__sheet">
        <p className="welcome__eyebrow">For Blynk store teams</p>
        <h1 className="welcome__title">
          Run your store,{' '}
          <br />
          deliver <em>faster</em>
        </h1>
        <p className="welcome__lead">Everything the store runs on, in one app.</p>

        <ul className="welcome__features">
          {FEATURES.map((f) => (
            <li key={f.title}>
              <span className="welcome__icon">{f.icon}</span>
              <span className="welcome__feature-text">
                <strong>{f.title}</strong>
                <span>{f.text}</span>
              </span>
            </li>
          ))}
        </ul>

        <div className="welcome__actions">
          <button type="button" className="welcome__cta" onClick={go}>
            Get Started <span aria-hidden="true">→</span>
          </button>
          <p className="welcome__note">Operator accounts are created by an admin.</p>
        </div>
      </section>
    </main>
  );
}
