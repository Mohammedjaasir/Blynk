import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ApiError } from '../api/client';
import { coupons as couponsApi, settings } from '../api/resources';
import type { Coupon, CouponType } from '../api/types';
import { PageHeader } from '../components/Layout';
import { ConfirmDialog, EmptyState, Field, Spinner, Status, type Tone } from '../components/ui';
import { catalogErrorMessage } from '../lib/catalog';
import {
  COUPON_FIELD_FOR,
  STATE_LABEL,
  couponInUseMessage,
  couponState,
  describeDiscount,
  describeWindow,
  emptyForm,
  formFromCoupon,
  toInput,
  validateForm,
  type CouponForm,
  type CouponFormErrors,
} from '../lib/coupons';
import { formatMoney } from '../lib/orders';

/**
 * Coupons (owner, 2026-10-10: "make sure admin and ops can create a coupon
 * code for customers"). A mobile card list of the codes customers type at
 * checkout - create, edit, switch on/off, delete one nobody used - over the
 * same GET|POST|PATCH|DELETE /admin/coupons the Admin site uses (Admin and
 * Operations; every change audited server-side). The API re-checks each code
 * when an order is placed, under a lock, so the limits hold.
 *
 * When "Coupon codes at checkout" is off (GET /admin/settings/checkout
 * coupons_enabled false) the customer app hides the coupon field, so the
 * page says so and links to that switch on the More tab.
 */

/** Short labels for the type picker (segmented, not a native select). */
const TYPE_CHOICES: ReadonlyArray<{ value: CouponType; label: string }> = [
  { value: 'FIXED', label: 'LKR off' },
  { value: 'PERCENT', label: '% off' },
  { value: 'FREE_DELIVERY', label: 'Free delivery' },
];

const STATE_TONE: Record<ReturnType<typeof couponState>, Tone> = {
  live: 'ok',
  off: 'muted',
  scheduled: 'info',
  ended: 'muted',
  'used-up': 'warn',
};

type Dialog = { kind: 'create' } | { kind: 'edit'; coupon: Coupon } | { kind: 'delete'; coupon: Coupon } | null;

export function Coupons() {
  const [rows, setRows] = useState<Coupon[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  // null until known; a failed read shows no notice rather than a wrong one.
  const [couponsEnabled, setCouponsEnabled] = useState<boolean | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await couponsApi.list());
      setError(null);
    } catch (err) {
      setError(catalogErrorMessage(err));
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void load();
    let live = true;
    settings.checkout
      .get()
      .then((s) => live && setCouponsEnabled(s.coupons_enabled))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [load]);

  const replace = (c: Coupon) => setRows((current) => current?.map((r) => (r.id === c.id ? c : r)) ?? current);

  async function toggle(c: Coupon) {
    setNotice(null);
    try {
      // Only the switch: sending discount_type makes the API re-check its value.
      const updated = await couponsApi.update(c.id, { is_active: !c.is_active });
      replace(updated);
      setNotice({ text: updated.is_active ? `${c.code} is switched on.` : `${c.code} is switched off.`, ok: true });
    } catch (err) {
      setNotice({ text: catalogErrorMessage(err), ok: false });
    }
  }

  async function remove(c: Coupon) {
    setDialog(null);
    setNotice(null);
    try {
      await couponsApi.remove(c.id);
      setRows((current) => current?.filter((r) => r.id !== c.id) ?? current);
      setNotice({ text: `${c.code} deleted.`, ok: true });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'COUPON_IN_USE') {
        // Used since the list was read: say why, and show its real usage.
        setNotice({ text: couponInUseMessage(c.code), ok: false });
        await load();
      } else {
        setNotice({ text: catalogErrorMessage(err), ok: false });
      }
    }
  }

  const addButton = (
    <button type="button" className="button" onClick={() => setDialog({ kind: 'create' })}>
      New coupon
    </button>
  );

  return (
    <div className="page">
      <PageHeader
        title="Coupons"
        description="Codes customers type at checkout. Each is checked again when the order is placed."
        actions={addButton}
      />

      {couponsEnabled === false ? (
        <div className="banner coupon-off" role="status">
          <p className="coupon-off__text">Customers can't enter codes until 'Coupon codes at checkout' is on.</p>
          <Link className="button button--ghost button--sm" to="/more#checkout-settings">
            Open checkout settings
          </Link>
        </div>
      ) : null}

      {notice ? (
        <p className={notice.ok ? 'quiet quiet--ok' : 'field__error'} role="status">
          {notice.text}
          <button type="button" className="field__error-dismiss" onClick={() => setNotice(null)} aria-label="Dismiss">
            ×
          </button>
        </p>
      ) : null}
      {error ? <p className="field__error">{error}</p> : null}

      {rows === null ? (
        <Spinner label="Loading coupons" />
      ) : rows.length === 0 ? (
        error ? null : (
          <EmptyState
            title="No coupons yet"
            message="Create a code for a promotion, a first order or free delivery."
            action={addButton}
          />
        )
      ) : (
        <ul className="cat-list" aria-label="Coupons">
          {rows.map((c) => {
            const state = couponState(c);
            const conditions = [
              c.first_order_only ? 'First order only' : null,
              c.min_subtotal != null ? `Min. ${formatMoney(c.min_subtotal)}` : null,
              `${c.per_customer_limit} per customer`,
            ].filter(Boolean);
            return (
              <li key={c.id} className="cat-row cat-row--flat coupon-row">
                <div className="cat-row__main">
                  <p className="cat-row__title mono">{c.code}</p>
                  {c.description ? <p className="cat-row__meta">{c.description}</p> : null}
                  <p className="coupon-row__discount">{describeDiscount(c)}</p>
                  <p className="cat-row__meta">{conditions.join(' · ')}</p>
                  <div className="cat-row__badges">
                    <Status tone={STATE_TONE[state]}>{STATE_LABEL[state]}</Status>
                    <span className="cat-row__order">{describeWindow(c)}</span>
                    <span className="cat-row__order mono">
                      Used {c.usage_count}
                      {c.usage_limit != null ? ` / ${c.usage_limit}` : ''}
                    </span>
                  </div>
                </div>
                <div className="cat-row__actions">
                  <button
                    type="button"
                    className="button button--ghost button--sm"
                    aria-label={`Edit ${c.code}`}
                    onClick={() => setDialog({ kind: 'edit', coupon: c })}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="button button--ghost button--sm"
                    aria-label={`${c.is_active ? 'Switch off' : 'Switch on'} ${c.code}`}
                    onClick={() => void toggle(c)}
                  >
                    {c.is_active ? 'Switch off' : 'Switch on'}
                  </button>
                  {c.usage_count === 0 ? (
                    <button
                      type="button"
                      className="button button--ghost button--sm"
                      aria-label={`Delete ${c.code}`}
                      onClick={() => setDialog({ kind: 'delete', coupon: c })}
                    >
                      Delete
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {dialog?.kind === 'create' || dialog?.kind === 'edit' ? (
        <CouponDialog
          coupon={dialog.kind === 'edit' ? dialog.coupon : null}
          onClose={() => setDialog(null)}
          onSaved={(saved, isNew) => {
            setDialog(null);
            if (isNew) setRows((current) => [saved, ...(current ?? [])]);
            else replace(saved);
            setNotice({ text: isNew ? `${saved.code} created.` : `${saved.code} saved.`, ok: true });
          }}
        />
      ) : null}

      {dialog?.kind === 'delete' ? (
        <ConfirmDialog
          title="Delete coupon"
          message={`${dialog.coupon.code} has never been used. Delete it?`}
          confirmLabel="Delete"
          destructive
          onCancel={() => setDialog(null)}
          onConfirm={() => void remove(dialog.coupon)}
        />
      ) : null}
    </div>
  );
}

function CouponDialog({
  coupon,
  onClose,
  onSaved,
}: {
  coupon: Coupon | null;
  onClose(): void;
  onSaved(coupon: Coupon, isNew: boolean): void;
}) {
  const isNew = coupon === null;
  const [form, setForm] = useState<CouponForm>(() => (coupon ? formFromCoupon(coupon) : emptyForm()));
  const [errors, setErrors] = useState<CouponFormErrors>({});
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof CouponForm>(key: K, value: CouponForm[K]) => setForm((f) => ({ ...f, [key]: value }));
  const title = isNew ? 'New coupon' : `Edit ${coupon.code}`;

  async function submit(event: FormEvent) {
    event.preventDefault();
    const found = validateForm(form, isNew, coupon?.usage_count ?? 0);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setSaving(true);
    try {
      const body = toInput(form, isNew);
      const saved = isNew ? await couponsApi.create(body) : await couponsApi.update(coupon.id, body);
      onSaved(saved, isNew);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'COUPON_CODE_TAKEN') {
        setErrors({ code: 'Another coupon already uses this code.' });
      } else if (err instanceof ApiError && err.code === 'VALIDATION_ERROR') {
        // Per-field server details next to their inputs; the first one below.
        const details = (err.details as Array<{ field?: string; message?: string }> | undefined) ?? [];
        const inline: CouponFormErrors = {};
        for (const d of details) {
          const key = d.field ? COUPON_FIELD_FOR[d.field] : undefined;
          if (key && d.message && !inline[key]) inline[key] = d.message;
        }
        setErrors(Object.keys(inline).length ? inline : { form: catalogErrorMessage(err) });
      } else {
        setErrors({ form: catalogErrorMessage(err) });
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
      <form className="modal__panel modal__panel--wide" onSubmit={submit} noValidate>
        <h2 className="modal__title">{title}</h2>
        <Field
          label="Code"
          hint={isNew ? '4-20 letters or digits. Customers can type it in any case.' : 'A code cannot be changed.'}
          error={errors.code}
        >
          <input
            className="input mono"
            value={form.code}
            maxLength={20}
            disabled={!isNew}
            autoComplete="off"
            autoCapitalize="characters"
            onChange={(e) => set('code', e.target.value.toUpperCase())}
          />
        </Field>
        <Field label="Description" hint="For staff; optional." error={errors.description}>
          <input className="input" value={form.description} maxLength={200} onChange={(e) => set('description', e.target.value)} />
        </Field>

        <div className="field">
          <span className="field__label" id="coupon-type-label">
            Discount
          </span>
          <div className="segmented" role="group" aria-labelledby="coupon-type-label">
            {TYPE_CHOICES.map((t) => (
              <button
                key={t.value}
                type="button"
                className={t.value === form.discount_type ? 'segmented__item is-selected' : 'segmented__item'}
                aria-pressed={t.value === form.discount_type}
                onClick={() => set('discount_type', t.value)}
              >
                {t.label}
              </button>
            ))}
          </div>
          {errors.discount_type ? <span className="field__error-text">{errors.discount_type}</span> : null}
        </div>

        {form.discount_type === 'FIXED' ? (
          <Field label="Amount off (LKR)" error={errors.discount_value}>
            <input className="input" inputMode="decimal" value={form.discount_value} onChange={(e) => set('discount_value', e.target.value)} />
          </Field>
        ) : null}
        {form.discount_type === 'PERCENT' ? (
          <div className="form__row">
            <Field label="Percentage off" hint="1 to 100." error={errors.discount_value}>
              <input className="input" inputMode="decimal" value={form.discount_value} onChange={(e) => set('discount_value', e.target.value)} />
            </Field>
            <Field label="Maximum discount (LKR)" hint="Optional cap." error={errors.max_discount}>
              <input className="input" inputMode="decimal" value={form.max_discount} onChange={(e) => set('max_discount', e.target.value)} />
            </Field>
          </div>
        ) : null}
        {form.discount_type === 'FREE_DELIVERY' ? <p className="form__note">The order's delivery fee is waived.</p> : null}

        <Field label="Minimum basket (LKR)" hint="Optional. Items only, before delivery." error={errors.min_subtotal}>
          <input className="input" inputMode="decimal" value={form.min_subtotal} onChange={(e) => set('min_subtotal', e.target.value)} />
        </Field>
        <div className="form__row">
          <Field label="First day" hint="Optional (Sri Lanka time)." error={errors.starts_on}>
            <input className="input" type="date" value={form.starts_on} onChange={(e) => set('starts_on', e.target.value)} />
          </Field>
          <Field label="Last day" hint="Optional; works until the end of this day." error={errors.ends_on}>
            <input className="input" type="date" value={form.ends_on} onChange={(e) => set('ends_on', e.target.value)} />
          </Field>
        </div>
        <div className="form__row">
          <Field
            label="Total uses"
            hint={
              coupon && coupon.usage_count > 0
                ? `Optional; empty = no limit. Used ${coupon.usage_count} so far.`
                : 'Optional; empty = no limit.'
            }
            error={errors.usage_limit}
          >
            <input className="input" inputMode="numeric" value={form.usage_limit} onChange={(e) => set('usage_limit', e.target.value)} />
          </Field>
          <Field label="Uses per customer" error={errors.per_customer_limit}>
            <input
              className="input"
              inputMode="numeric"
              value={form.per_customer_limit}
              onChange={(e) => set('per_customer_limit', e.target.value)}
            />
          </Field>
        </div>
        <label className="toggle">
          <input type="checkbox" checked={form.first_order_only} onChange={(e) => set('first_order_only', e.target.checked)} />
          <span>
            <strong>First order only</strong>
            <em>Only for a customer with no earlier (not cancelled) order.</em>
          </span>
        </label>
        <label className="toggle">
          <input type="checkbox" checked={form.is_active} onChange={(e) => set('is_active', e.target.checked)} />
          <span>
            <strong>Active</strong>
            <em>Switched off, the code is refused at checkout.</em>
          </span>
        </label>
        {errors.form ? (
          <p className="field__error" role="alert">
            {errors.form}
          </p>
        ) : null}
        <div className="modal__actions">
          <button type="button" className="button button--ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button" disabled={saving}>
            {saving ? <Spinner label="Saving coupon" /> : isNew ? 'Create coupon' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  );
}
