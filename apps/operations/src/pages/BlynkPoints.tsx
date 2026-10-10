import { useEffect, useState, type FormEvent } from 'react';
import { referralPoints, type PointsSetting } from '../api/referralPoints';
import { PageHeader } from '../components/Layout';
import { Spinner } from '../components/ui';
import { catalogErrorMessage } from '../lib/catalog';
import { formatDateTime } from '../lib/inventory';
import { changedFields, pointsExample, pointsFormFrom, readPointsForm, type PointsFormField } from '../lib/referralPoints';

/**
 * More -> Blynk Points (owner, 2026-10-10). Customers earn points on
 * delivered orders and spend them like money at checkout. Admin has the same
 * controls under Settings; the backend does the earning, spending and expiry.
 */
export function BlynkPoints() {
  return (
    <div className="page">
      <PageHeader title="Blynk Points" description="Points customers earn on delivered orders and spend at checkout." />
      <PointsSettingsCard />
    </div>
  );
}

type Form = ReturnType<typeof pointsFormFrom>;

const FIELDS: { field: PointsFormField; label: string; hint: string; numeric?: boolean }[] = [
  { field: 'earn_points', label: 'Points earned', hint: 'Whole points, 1 to 1,000 ...', numeric: true },
  { field: 'earn_per_lkr', label: 'For every LKR spent', hint: '... for every full LKR this much of a delivered order: items after discounts, not the delivery fee.' },
  { field: 'lkr_per_point', label: 'Value of one point (LKR)', hint: 'What one point takes off at checkout.' },
  { field: 'min_redeem_points', label: 'Minimum points to use', hint: 'A customer needs at least this many before they can use any.', numeric: true },
  { field: 'max_redeem_percent', label: 'Most of an order points can pay (%)', hint: 'Of the amount due after discounts, 1 to 100.' },
  { field: 'expiry_months', label: 'Points expire after (months)', hint: '0 = points never expire. The oldest points are used first.', numeric: true },
];

function PointsSettingsCard() {
  const [current, setCurrent] = useState<PointsSetting | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<{ message: string; field?: PointsFormField } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function show(s: PointsSetting) {
    setCurrent(s);
    setForm(pointsFormFrom(s));
  }

  useEffect(() => {
    referralPoints
      .getPointsSetting()
      .then(show)
      .catch((err) => setLoadError(catalogErrorMessage(err)));
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!current || !form) return;
    setNotice(null);
    const read = readPointsForm(form);
    if ('error' in read) {
      setError({ message: read.error, field: read.field });
      return;
    }
    // updated_at is copied over so it never counts as a change.
    const body = changedFields(current, { ...read.value, updated_at: current.updated_at });
    setError(null);
    if (Object.keys(body).length === 0) {
      setNotice('Nothing changed.');
      return;
    }
    setSaving(true);
    try {
      show(await referralPoints.setPointsSetting(body));
      setNotice('Blynk Points saved.');
    } catch (err) {
      setError({ message: catalogErrorMessage(err) });
    } finally {
      setSaving(false);
    }
  }

  const preview = form ? readPointsForm(form) : null;

  return (
    <section className="card" aria-labelledby="points-settings-title">
      <h2 className="section-label" id="points-settings-title">
        Blynk Points
      </h2>
      {loadError ? (
        <p className="field__error">{loadError}</p>
      ) : !current || !form ? (
        <Spinner label="Loading Blynk Points" />
      ) : (
        <form className="form" onSubmit={save} noValidate>
          <label className="toggle">
            <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
            <span>
              <strong>Blynk Points</strong>
              <em>
                Points act like a payment applied after all discounts, so they combine with a coupon, birthday gift or referral reward.
              </em>
            </span>
          </label>
          {FIELDS.map(({ field, label, hint, numeric }) => (
            <label key={field} className="field">
              <span className="field__label">{label}</span>
              <input
                className="input"
                inputMode={numeric ? 'numeric' : 'decimal'}
                value={form[field]}
                onChange={(e) => setForm({ ...form, [field]: e.target.value })}
                aria-invalid={error?.field === field ? true : undefined}
              />
              <span className="field__hint">{hint}</span>
            </label>
          ))}
          {preview && 'value' in preview ? (
            <p className="quiet" data-testid="points-example">
              {pointsExample(preview.value)}
            </p>
          ) : null}
          <button type="submit" className="button" disabled={saving}>
            {saving ? <Spinner label="Saving" /> : 'Save'}
          </button>
        </form>
      )}
      {error ? <p className="field__error" role="alert">{error.message}</p> : null}
      {notice ? <p className="quiet quiet--ok" role="status">{notice}</p> : null}
      {current?.updated_at ? <p className="quiet">Last changed {formatDateTime(current.updated_at)}</p> : null}
    </section>
  );
}
