import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { settings } from '../api/resources';
import { Field } from './ui';
import { catalogErrorMessage } from '../lib/catalog';
import { isOpenNow, productHoursProblem, productWindow, windowsPayload, withProductWindow } from '../lib/availability';

/**
 * A product's own available hours on its edit form (owner's brother, 2026-10-24: "I can't find
 * the time setting thing in the Ops app for category or products"). The hours live in one list
 * (GET|PUT /admin/settings/availability-windows, which a PUT replaces whole), so saving reads the
 * current list again, changes only this product's entry and sends everything back. The product
 * itself is saved first (ProductForm); a failure here never loses that. Admin has its own copy.
 */
export interface ProductHours {
  productId: string | undefined;
  state: 'off' | 'loading' | 'ready' | 'failed';
  from: string;
  until: string;
  setFrom: (v: string) => void;
  setUntil: (v: string) => void;
  /** The stored hours, for the "orderable now" line. */
  stored: { from: string; until: string };
  /** What is wrong with the typed times; null = fine (or nothing loaded). */
  problem: string | null;
  changed: boolean;
  /** Saves the hours when they changed; returns the error text, or null when saved / nothing to save. */
  save: () => Promise<string | null>;
}

export function useProductHours(productId: string | undefined): ProductHours {
  const [state, setState] = useState<ProductHours['state']>(productId ? 'loading' : 'off');
  const [stored, setStored] = useState({ from: '', until: '' });
  const [from, setFrom] = useState('');
  const [until, setUntil] = useState('');

  useEffect(() => {
    if (!productId) return;
    let cancelled = false;
    settings.availabilityWindows
      .get()
      .then((s) => {
        if (cancelled) return;
        const w = productWindow(s.windows, productId);
        const own = { from: w?.from ?? '', until: w?.until ?? '' };
        setStored(own);
        setFrom(own.from);
        setUntil(own.until);
        setState('ready');
      })
      .catch(() => {
        if (!cancelled) setState('failed');
      });
    return () => {
      cancelled = true;
    };
  }, [productId]);

  const ready = state === 'ready';
  const changed = ready && (from !== stored.from || until !== stored.until);
  const problem = ready ? productHoursProblem(from, until) : null;

  async function save(): Promise<string | null> {
    if (!productId || !changed) return null;
    try {
      const fresh = await settings.availabilityWindows.get();
      const saved = await settings.availabilityWindows.update(windowsPayload(withProductWindow(fresh.windows, productId, from, until)));
      const w = productWindow(saved.windows, productId);
      const own = { from: w?.from ?? '', until: w?.until ?? '' };
      setStored(own);
      setFrom(own.from);
      setUntil(own.until);
      return null;
    } catch (err) {
      return catalogErrorMessage(err).replace(/ Nothing was saved.$/, '');
    }
  }

  return { productId, state, from, until, setFrom, setUntil, stored, problem, changed, save };
}

export function ProductHoursSection({ hours }: { hours: ProductHours }) {
  if (hours.state === 'off') return null;
  return (
    <section className="form__section" aria-label="Available hours">
      <h2 className="form__section-title">Available hours</h2>
      <p className="form__note">
        Customers can only order it between these times; outside them it shows greyed with the hours. A category can have hours
        too (<Link to="/catalog/available-hours">Available hours page</Link>).
      </p>
      {hours.state === 'loading' ? <p className="form__note">Loading the hours...</p> : null}
      {hours.state === 'failed' ? (
        <p className="field__error" role="alert">
          Could not load the available hours, so they cannot be changed here. Save the product as usual, or set them on the Available hours page.
        </p>
      ) : null}
      {hours.state === 'ready' ? (
        <>
          <div className="form__row">
            <Field label="From" hint="Empty = any time">
              <input className="input" type="time" aria-label="Available from" value={hours.from} onChange={(e) => hours.setFrom(e.target.value)} />
            </Field>
            <Field label="Until" hint="Later than From, or past midnight">
              <input className="input" type="time" aria-label="Available until" value={hours.until} onChange={(e) => hours.setUntil(e.target.value)} />
            </Field>
          </div>
          {hours.from || hours.until ? (
            <button
              type="button"
              className="button button--ghost button--sm"
              onClick={() => {
                hours.setFrom('');
                hours.setUntil('');
              }}
            >
              Any time (clear the hours)
            </button>
          ) : null}
          {hours.stored.from && hours.stored.until && !hours.changed ? (
            <p className="form__note" role="status">
              {isOpenNow(hours.stored) ? 'Orderable now.' : 'Greyed out now (outside its hours).'}
            </p>
          ) : null}
          {hours.problem ? (
            <p className="field__error" role="alert">
              {hours.problem}
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
