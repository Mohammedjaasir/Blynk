import { useEffect, useState, type FormEvent } from 'react';
import { settings } from '../api/resources';
import type { DefaultMarkupSetting } from '../api/types';
import { catalogErrorMessage } from '../lib/catalog';
import { formatDateTime } from '../lib/inventory';
import { parseMarkupPercent, percentText } from '../lib/pricing';
import { Spinner } from './ui';

/**
 * Global default markup (migration 044; owner, 2026-10-13): `GET|PATCH
 * /admin/settings/default-markup`, ADMIN and OPERATIONS. MARKUP-priced
 * products with no markup of their own and none on their category (or
 * parent category) use it; saving reprices them all at once on the server
 * (orders already placed keep their prices). Audited server-side.
 */
export function DefaultMarkupCard() {
  const [current, setCurrent] = useState<DefaultMarkupSetting | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function show(s: DefaultMarkupSetting) {
    setCurrent(s);
    setValue(String(Number(Number(s.markup_percent).toFixed(2))));
  }

  useEffect(() => {
    settings.defaultMarkup
      .get()
      .then(show)
      .catch((err) => setLoadError(catalogErrorMessage(err)));
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    setNotice(null);
    const parsed = parseMarkupPercent(value);
    if ('error' in parsed || parsed.value === null) {
      setError('error' in parsed ? parsed.error : 'Enter a markup from 0 to 999.99.');
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const saved = await settings.defaultMarkup.update(parsed.value);
      show(saved);
      setNotice(`Global default markup saved: ${percentText(Number(saved.markup_percent))}.`);
    } catch (err) {
      setError(catalogErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const using = current?.products_using ?? null;

  return (
    <section className="card" id="default-markup" aria-labelledby="default-markup-title">
      <h2 className="section-label" id="default-markup-title">
        Global default markup
      </h2>
      {loadError ? (
        <p className="field__error">{loadError}</p>
      ) : !current ? (
        <Spinner label="Loading global default markup" />
      ) : (
        <>
          <p className="card__row">
            <span className="card__label">Current markup</span>
            <span className="card__value mono">{percentText(Number(current.markup_percent))}</span>
          </p>
          {using !== null ? (
            <p className="card__row">
              <span className="card__label">Products using it</span>
              <span className="card__value mono">{using}</span>
            </p>
          ) : null}
          <form className="fee-form" onSubmit={save} noValidate>
            <label className="field">
              <span className="field__label">Global default markup %</span>
              <input
                className="input"
                inputMode="decimal"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                aria-invalid={error ? true : undefined}
              />
            </label>
            <button type="submit" className="button" disabled={saving}>
              {saving ? <Spinner label="Saving" /> : 'Save'}
            </button>
          </form>
        </>
      )}
      {error ? <p className="field__error" role="alert">{error}</p> : null}
      {notice ? <p className="quiet quiet--ok" role="status">{notice}</p> : null}
      {current?.updated_at ? <p className="quiet">Last changed {formatDateTime(current.updated_at)}</p> : null}
      <p className="page__note">
        Used by products with no markup of their own and none on their category.
        {using !== null ? ` ${using} ${using === 1 ? 'product uses' : 'products use'} it.` : ''} Changing it reprices them at once;
        orders already placed keep their prices.
      </p>
    </section>
  );
}
