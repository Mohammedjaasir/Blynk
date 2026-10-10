import { useEffect, useState, type FormEvent } from 'react';
import { referralPoints, type PointsSetting } from '../api/referralPoints';
import { errorMessage } from '../lib/apiErrors';
import { changedFields, pointsExample, pointsFormFrom, readPointsForm, type PointsFormField } from '../lib/referralPoints';
import { Field, Spinner, useToast } from './ui';

const FIELDS: { field: PointsFormField; label: string; hint: string; numeric?: boolean }[] = [
  { field: 'earn_points', label: 'Points earned', hint: 'Whole points, 1 to 1,000 ...', numeric: true },
  {
    field: 'earn_per_lkr',
    label: 'For every LKR spent',
    hint: '... for every full LKR this much of a delivered order: items after discounts, not the delivery fee.',
  },
  { field: 'lkr_per_point', label: 'Value of one point (LKR)', hint: 'What one point takes off at checkout.' },
  { field: 'min_redeem_points', label: 'Minimum points to use', hint: 'A customer needs at least this many before they can use any.', numeric: true },
  { field: 'max_redeem_percent', label: 'Most of an order points can pay (%)', hint: 'Of the amount due after discounts, 1 to 100.' },
  { field: 'expiry_months', label: 'Points expire after (months)', hint: '0 = points never expire. The oldest points are used first.', numeric: true },
];

/**
 * Settings -> Blynk Points (owner, 2026-10-10): earn on delivered orders,
 * spend like money at checkout. Operations has the same controls under More.
 * PATCH sends only what changed.
 */
export function PointsSettingsCard() {
  const toast = useToast();
  const [current, setCurrent] = useState<PointsSetting | null>(null);
  const [form, setForm] = useState<ReturnType<typeof pointsFormFrom> | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<{ field: PointsFormField; message: string } | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function show(s: PointsSetting) {
    setCurrent(s);
    setForm(pointsFormFrom(s));
  }

  useEffect(() => {
    let cancelled = false;
    referralPoints
      .getPointsSetting()
      .then((s) => !cancelled && show(s))
      .catch((err) => !cancelled && setLoadError(errorMessage(err, 'Could not load Blynk Points.')));
    return () => {
      cancelled = true;
    };
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!current || !form) return;
    setSaveError(null);
    const read = readPointsForm(form);
    if ('error' in read) {
      setFieldError({ field: read.field, message: read.error });
      return;
    }
    setFieldError(null);
    const body = changedFields(current, { ...read.value, updated_at: current.updated_at });
    if (Object.keys(body).length === 0) {
      toast.success('Nothing changed.');
      return;
    }
    setSaving(true);
    try {
      show(await referralPoints.setPointsSetting(body));
      toast.success('Blynk Points saved.');
    } catch (err) {
      setSaveError(errorMessage(err, 'Could not save Blynk Points.'));
    } finally {
      setSaving(false);
    }
  }

  const preview = form ? readPointsForm(form) : null;

  return (
    <section className="panel" aria-label="Blynk Points">
      <h2 className="panel__title">Blynk Points</h2>
      {loadError ? (
        <p className="field__error">{loadError}</p>
      ) : !current || !form ? (
        <Spinner label="Loading Blynk Points" />
      ) : (
        <form className="form" onSubmit={save} noValidate>
          <label className="toggle">
            <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
            <span>
              Blynk Points
              <em>Points act like a payment applied after all discounts, so they combine with a coupon, birthday gift or referral reward.</em>
            </span>
          </label>
          {FIELDS.map(({ field, label, hint, numeric }) => (
            <Field key={field} label={label} hint={hint} error={fieldError?.field === field ? fieldError.message : undefined}>
              <input
                className="input"
                inputMode={numeric ? 'numeric' : 'decimal'}
                value={form[field]}
                onChange={(e) => setForm({ ...form, [field]: e.target.value })}
              />
            </Field>
          ))}
          {preview && 'value' in preview ? (
            <p className="form__note" data-testid="points-example">
              {pointsExample(preview.value)}
            </p>
          ) : null}
          {current.updated_at ? <p className="form__note">Changed {new Date(current.updated_at).toLocaleString()}.</p> : null}
          {saveError ? (
            <p className="field__error" role="alert">
              {saveError}
            </p>
          ) : null}
          <div className="form__actions">
            <button type="submit" className="button" disabled={saving}>
              {saving ? <Spinner label="Saving" /> : 'Save'}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
