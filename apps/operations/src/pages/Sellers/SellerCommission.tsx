import { useEffect, useState } from 'react';
import { sellerCommission } from '../../api/sellers';
import { PageHeader } from '../../components/Layout';
import { Spinner } from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { categoryTree, commissionBody, notReady, type CommissionSettings } from '../../lib/sellers';
import { parseFreeDays } from '../../lib/sellerShop';
import { BackToMore, TextField } from './parts';
import './sellers.css';

/**
 * More -> Seller commission (owner, 2026-10-24/25): what Blynk keeps from seller sales: a default %,
 * and an optional % per main category and sub-category (a sub-category without one uses its main
 * category's). A seller's own rate (on their page) beats both. Category rates need migration 057;
 * before it the default alone can be edited and the table says so.
 */
export function SellerCommission() {
  const [settings, setSettings] = useState<CommissionSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [defaultText, setDefaultText] = useState('');
  const [freeDaysText, setFreeDaysText] = useState('');
  const [rates, setRates] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const adopt = (s: CommissionSettings) => {
    setSettings(s);
    setDefaultText(String(s.default_percent));
    setFreeDaysText(typeof s.free_days === 'number' ? String(s.free_days) : '');
    setRates(Object.fromEntries((s.categories ?? []).map((c) => [c.category_id, c.percent === null ? '' : String(c.percent)])));
  };

  useEffect(() => {
    let live = true;
    sellerCommission
      .get()
      .then((s) => live && adopt(s))
      .catch((err) => live && setLoadError(errorMessage(err, 'Could not load the commission settings.')));
    return () => {
      live = false;
    };
  }, []);

  async function save() {
    const read = commissionBody(defaultText, rates);
    if ('error' in read) {
      setError(read.error);
      return;
    }
    // The free month needs migration 065 / the new API: an older API sends no free_days, so none is sent.
    let freeDays: number | undefined;
    if (hasFreeDays) {
      const days = parseFreeDays(freeDaysText);
      if ('error' in days) {
        setError(`Free month: ${days.error}`);
        return;
      }
      freeDays = days.value;
    }
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      adopt(await sellerCommission.save(freeDays === undefined ? read.body : { ...read.body, free_days: freeDays }));
      setNotice('Seller commission saved.');
    } catch (err) {
      setError(notReady(err) ? 'Category rates can be saved after the next database update.' : errorMessage(err, 'Could not save the commission.'));
    } finally {
      setBusy(false);
    }
  }

  const hasFreeDays = typeof settings?.free_days === 'number';
  const tree = settings ? categoryTree(settings.categories ?? []) : [];

  return (
    <div className="page">
      <BackToMore to="/more/sellers" label="← Sellers" />
      <PageHeader
        title="Seller commission"
        description="The % Blynk keeps from the seller's price on each sale: the seller's own rate if they have one, else the category's (a sub-category without one uses its main category's), else the default."
      />
      {loadError ? (
        <p className="field__error" role="alert">
          {loadError}
        </p>
      ) : !settings ? (
        <Spinner label="Loading the commission settings" />
      ) : (
        <form
          className="card"
          noValidate
          aria-label="Seller commission settings"
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy) void save();
          }}
        >
          <TextField label="Default (%)">
            <input
              className="input"
              inputMode="decimal"
              aria-label="Default commission percent"
              value={defaultText}
              onChange={(e) => {
                setDefaultText(e.target.value);
                setError(null);
              }}
            />
          </TextField>
          {hasFreeDays ? (
            <TextField label="Free month for new sellers (days)" hint="A newly approved seller pays no commission for this many days. 0 = none.">
              <input
                className="input"
                inputMode="numeric"
                aria-label="Free month for new sellers (days)"
                value={freeDaysText}
                onChange={(e) => {
                  setFreeDaysText(e.target.value);
                  setError(null);
                }}
              />
            </TextField>
          ) : null}
          {settings.ready === false ? <p className="sellers-card__meta">Category rates can be set after the next database update.</p> : null}
          {tree.length > 0 ? (
            <div aria-label="Category commission">
              {tree.map(({ row, depth }) => (
                <div key={row.category_id} className={depth ? 'rate-row rate-row--sub' : 'rate-row'}>
                  <span>{row.name}</span>
                  <input
                    className="input"
                    inputMode="decimal"
                    aria-label={`Commission for ${row.name}`}
                    placeholder={depth ? 'Main category' : 'Default'}
                    disabled={settings.ready === false}
                    value={rates[row.category_id] ?? ''}
                    onChange={(e) => {
                      const v = e.target.value;
                      setRates((r) => ({ ...r, [row.category_id]: v }));
                      setError(null);
                    }}
                  />
                </div>
              ))}
            </div>
          ) : null}
          {error ? (
            <p className="field__error" role="alert">
              {error}
            </p>
          ) : null}
          {notice ? (
            <p className="quiet quiet--ok" role="status">
              {notice}
            </p>
          ) : null}
          <button type="submit" className="button button--ink" disabled={busy} style={{ minHeight: 44 }}>
            {busy ? 'Saving…' : 'Save commission'}
          </button>
        </form>
      )}
    </div>
  );
}
