import { useEffect, useState, type FormEvent } from 'react';
import { settings } from '../../api/resources';
import type { Category } from '../../api/types';
import { Field, Spinner } from '../../components/ui';
import { windowsPayload, windowText, type AvailabilitySetting, type AvailabilityView } from '../../lib/availability';
import { catalogErrorMessage } from '../../lib/catalog';
import { hoursById, parseHoursInput, withCategoryHours } from '../../lib/categoryHours';

/**
 * "Available hours" for one category or sub-category (owner's brother, 2026-10-24): From / Until, both empty =
 * orderable at any time. Outside the hours the customer app greys the category's products with its hours.
 * The API keeps one list for the whole shop (GET/PUT /admin/settings/availability-windows, PUT replaces it),
 * so Save reads the list fresh, changes only this category's entry and sends all of it back.
 */
export function CategoryHoursDialog({
  category,
  categories,
  onClose,
  onSaved,
}: {
  category: Category;
  /** Every category, to name the main category a sub-category follows. */
  categories: Category[];
  onClose(): void;
  /** The list as saved - the page refreshes its hours from it. */
  onSaved(windows: AvailabilityView[]): void;
}) {
  const [loaded, setLoaded] = useState<AvailabilitySetting | null>(null);
  const [from, setFrom] = useState('');
  const [until, setUntil] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    settings.availabilityWindows
      .get()
      .then((s) => {
        if (!live) return;
        const own = hoursById(s.windows).get(category.id);
        setFrom(own?.from ?? '');
        setUntil(own?.until ?? '');
        setLoaded(s);
      })
      .catch((err) => live && setError(catalogErrorMessage(err)));
    return () => {
      live = false;
    };
  }, [category.id]);

  const parent = category.parent_id ? categories.find((c) => c.id === category.parent_id) ?? null : null;
  const parentHours = parent && loaded ? hoursById(loaded.windows).get(parent.id) : undefined;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!loaded) return;
    const parsed = parseHoursInput(from, until);
    if ('problem' in parsed) {
      setError(parsed.problem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const next = await settings.availabilityWindows.update(
        windowsPayload(withCategoryHours(loaded.windows, category.id, parsed.hours))
      );
      onSaved(next.windows);
    } catch (err) {
      setError(catalogErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Available hours">
      <form className="modal__panel" onSubmit={submit} noValidate>
        <h2 className="modal__title">{`Available hours: ${category.name}`}</h2>
        <p className="modal__message">
          Customers can order from this category only between these times (Sri Lanka time). Outside them its products
          show greyed out with the hours. Leave both empty for any time.
        </p>
        {!loaded && !error ? <Spinner label="Loading the hours" /> : null}
        {loaded ? (
          <>
            <div className="form__row">
              <Field label="From">
                <input className="input" type="time" aria-label="From" value={from} onChange={(e) => setFrom(e.target.value)} />
              </Field>
              <Field label="Until" hint="Later than From, or past midnight">
                <input className="input" type="time" aria-label="Until" value={until} onChange={(e) => setUntil(e.target.value)} />
              </Field>
            </div>
            {from !== '' || until !== '' ? (
              <button
                type="button"
                className="button button--ghost button--sm"
                onClick={() => {
                  setFrom('');
                  setUntil('');
                  setError(null);
                }}
              >
                Any time
              </button>
            ) : null}
            {parent && parentHours ? (
              <p className="field__hint">{`${parent.name} (its main category) is limited to ${windowText(parentHours)}. Hours set here win for ${category.name}.`}</p>
            ) : null}
            {!parent && categories.some((c) => c.parent_id === category.id) ? (
              <p className="field__hint">Its sub-categories follow these hours unless they have their own.</p>
            ) : null}
          </>
        ) : null}
        {error ? (
          <p className="field__error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="modal__actions">
          <button type="button" className="button button--ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button" disabled={busy || !loaded}>
            {busy ? <Spinner label="Saving" /> : 'Save hours'}
          </button>
        </div>
      </form>
    </div>
  );
}
