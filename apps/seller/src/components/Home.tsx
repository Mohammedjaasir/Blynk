import { Link } from 'react-router-dom';
import type { Seller } from '../api/types';
import type { Onboarding, StepState } from '../lib/onboarding';
import { greeting } from '../lib/onboarding';
import { STATUS_CHIP, initials, monthYear } from '../lib/status';
import { IconArrowRight, IconReceipt, IconStore } from './icons';
import { Illustration } from './Illustration';
import { Tagline } from './Tagline';

/** The welcome card at the top of My products: who you are and where the shop stands. */
export function WelcomeHero({ seller, complete }: { seller: Seller; complete: boolean }) {
  const chip = STATUS_CHIP[seller.status];
  const firstName = seller.contact_name?.trim().split(/\s+/)[0];
  const line =
    seller.status === 'APPROVED'
      ? complete
        ? 'Customers nearby can order from you on Blynk. Here is how the shop is doing.'
        : 'You are approved. Add your products and Blynk puts them in front of customers nearby.'
      : seller.status === 'PENDING'
        ? 'Your shop is set up. Finish the steps below and Blynk opens it to customers.'
        : seller.status === 'REJECTED'
          ? 'Blynk needs a small change before your shop can open.'
          : 'Your products are hidden from customers for now.';

  return (
    <div className="hero rise">
      <div className="hero__body">
        <div className="hero__top">
          <span className="hero__avatar" aria-hidden="true">
            {initials(seller.shop_name)}
          </span>
          <p className="hero__hello">
            {greeting()}
            {firstName ? `, ${firstName}` : ''}
          </p>
        </div>
        <p className="hero__shop">{seller.shop_name}</p>
        <Tagline className="tagline--hero" />
        <div className="hero__meta">
          <span className={`chip chip--${chip.tone} chip--onyellow`}>
            <span className="chip__dot" aria-hidden="true" />
            {chip.label}
          </span>
          {monthYear(seller.created_at) ? (
            <span className="hero__since">On Blynk since {monthYear(seller.created_at)}</span>
          ) : null}
        </div>
        <p className="hero__line">{line}</p>
        <div className="hero__links">
          <Link to="/shop" className="hero__link">
            <IconStore size={18} /> Shop profile
          </Link>
          <Link to="/statement" className="hero__link">
            <IconReceipt size={18} /> Your money
          </Link>
        </div>
      </div>
      <Illustration name="shopfront" className="hero__art" />
    </div>
  );
}

const STATE_LABEL: Record<StepState, string> = {
  done: 'Done',
  current: 'Your turn',
  waiting: 'Blynk is on it',
  problem: 'Needs a change',
  next: 'Later',
};

function Ring({ done, total }: { done: number; total: number }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  return (
    <div className="ring" role="img" aria-label={`${done} of ${total} steps done`}>
      <svg viewBox="0 0 64 64" width="64" height="64" aria-hidden="true">
        <circle cx="32" cy="32" r={r} className="ring__track" />
        <circle
          cx="32"
          cy="32"
          r={r}
          className="ring__bar"
          strokeDasharray={c}
          style={{ ['--ring-off' as string]: `${c * (1 - done / total)}`, ['--ring-full' as string]: `${c}` }}
        />
      </svg>
      <span className="ring__text" aria-hidden="true">
        {done}
        <small>/{total}</small>
      </span>
    </div>
  );
}

function StepMark({ state, n }: { state: StepState; n: number }) {
  if (state === 'done') {
    return (
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="m5.5 12.5 4 4 9-9" />
      </svg>
    );
  }
  if (state === 'problem') return <span aria-hidden="true">!</span>;
  return <span aria-hidden="true">{n}</span>;
}

/** The five getting-started steps, each done / your turn / Blynk's turn / later. */
export function Tracker({ data }: { data: Onboarding }) {
  return (
    <section className="bezel track rise" style={{ ['--i' as string]: 1 }} aria-labelledby="track-title">
      <div className="bezel__core track__core">
        <header className="track__head">
          <div className="track__titles">
            <p className="eyebrow">Getting started</p>
            <h2 id="track-title" className="track__title">
              Get selling on Blynk
            </h2>
            <p className="track__sub">
              {data.doneCount} of {data.total} steps done
            </p>
          </div>
          <Ring done={data.doneCount} total={data.total} />
        </header>
        <ol className="track__steps" data-testid="tracker">
          {data.steps.map((step, index) => (
            <li
              key={step.key}
              className={`step step--${step.state}`}
              data-state={step.state}
              aria-current={step.state === 'current' ? 'step' : undefined}
            >
              <span className="step__mark">
                <StepMark state={step.state} n={index + 1} />
              </span>
              <div className="step__body">
                <div className="step__row">
                  <p className="step__title">{step.title}</p>
                  <span className="step__state">{STATE_LABEL[step.state]}</span>
                </div>
                <p className="step__detail">{step.detail}</p>
                {step.action ? (
                  <Link to={step.action.to} className="step__action">
                    {step.action.label}
                    <span className="step__arrow" aria-hidden="true">
                      <IconArrowRight size={15} />
                    </span>
                  </Link>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
