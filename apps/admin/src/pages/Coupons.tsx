import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError } from '../api/client';
import { coupons as couponsApi } from '../api/resources';
import type { Coupon, CouponType } from '../api/types';
import { PageHeader } from '../components/Layout';
import { Badge, ConfirmDialog, EmptyState, Field, Spinner, useToast } from '../components/ui';
import { errorMessage, fieldErrors } from '../lib/apiErrors';
import {
  COUPON_FIELD_FOR,
  STATE_LABEL,
  couponInUseMessage,
  TYPE_LABEL,
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
 * Coupon codes customers type at checkout (backend migration 018). The API
 * re-validates every code when an order is placed, under a lock, so the
 * limits here hold even when customers race for the last use.
 */

const errorText = errorMessage;

type Dialog = { kind: 'create' } | { kind: 'edit'; coupon: Coupon } | { kind: 'delete'; coupon: Coupon } | null;

export function Coupons() {
  const toast = useToast();
  const [rows, setRows] = useState<Coupon[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);

  const load = useCallback(async () => {
    try {
      setRows(await couponsApi.list());
      setError(null);
    } catch (err) {
      setError(errorText(err, 'Could not load coupons.'));
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const replace = (c: Coupon) => setRows((current) => current?.map((r) => (r.id === c.id ? c : r)) ?? current);

  async function toggle(c: Coupon) {
    try {
      // Only the switch: sending discount_type makes the API re-check the
      // type's value, and without it a FIXED or PERCENT coupon is refused.
      const updated = await couponsApi.update(c.id, { is_active: !c.is_active });
      replace(updated);
      toast.success(updated.is_active ? `${c.code} is switched on.` : `${c.code} is switched off.`);
    } catch (err) {
      toast.error(errorText(err, 'Could not change the coupon.'));
    }
  }

  async function remove(c: Coupon) {
    setDialog(null);
    try {
      await couponsApi.remove(c.id);
      setRows((current) => current?.filter((r) => r.id !== c.id) ?? current);
      toast.success(`${c.code} deleted.`);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'COUPON_IN_USE') {
        // Used since the list was read: say why, and show its real usage.
        toast.error(couponInUseMessage(c.code));
        await load();
      } else {
        toast.error(errorText(err, 'Could not delete the coupon.'));
      }
    }
  }

  return (
    <>
      <PageHeader
        title="Coupons"
        description="Codes customers type at checkout. Each is checked again when the order is placed."
        actions={
          <button type="button" className="button" onClick={() => setDialog({ kind: 'create' })}>
            New coupon
          </button>
        }
      />

      {error ? <p className="field__error">{error}</p> : null}

      {rows === null ? (
        <Spinner label="Loading coupons" />
      ) : rows.length === 0 ? (
        error ? null : <EmptyState title="No coupons yet" message="Create a code for a promotion, a first order or free delivery." />
      ) : (
        <div className="table-wrap">
          <table className="table" aria-label="Coupons">
            <thead>
              <tr>
                <th scope="col">Code</th>
                <th scope="col">Discount</th>
                <th scope="col">Conditions</th>
                <th scope="col">Dates</th>
                <th scope="col">Used</th>
                <th scope="col">Status</th>
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const state = couponState(c);
                const conditions = [
                  c.first_order_only ? 'First order only' : null,
                  c.min_subtotal != null ? `Min. ${formatMoney(c.min_subtotal)}` : null,
                  `${c.per_customer_limit} per customer`,
                ].filter(Boolean);
                return (
                  <tr key={c.id}>
                    <td>
                      <span className="cell__primary mono">{c.code}</span>
                      {c.description ? <span className="cell__secondary"> {c.description}</span> : null}
                    </td>
                    <td>{describeDiscount(c)}</td>
                    <td className="cell__secondary">{conditions.join(' · ')}</td>
                    <td className="cell__secondary">{describeWindow(c)}</td>
                    <td className="mono">
                      {c.usage_count}
                      {c.usage_limit != null ? ` / ${c.usage_limit}` : ''}
                    </td>
                    <td>
                      <Badge tone={state === 'live' ? 'active' : state === 'off' ? 'inactive' : 'muted'}>{STATE_LABEL[state]}</Badge>
                    </td>
                    <td>
                      <div className="row-actions">
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
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {dialog?.kind === 'create' || dialog?.kind === 'edit' ? (
        <CouponDialog
          coupon={dialog.kind === 'edit' ? dialog.coupon : null}
          onClose={() => setDialog(null)}
          onSaved={(saved, isNew) => {
            setDialog(null);
            if (isNew) setRows((current) => [saved, ...(current ?? [])]);
            else replace(saved);
            toast.success(isNew ? `${saved.code} created.` : `${saved.code} saved.`);
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
    </>
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
      } else if (err instanceof ApiError && err.code === 'COUPON_IN_USE') {
        setErrors({ form: couponInUseMessage(coupon?.code ?? form.code) });
      } else {
        // Per-field server details next to their inputs; the rest below.
        const inline: CouponFormErrors = {};
        const shown: string[] = [];
        for (const [field, message] of Object.entries(fieldErrors(err))) {
          const key = COUPON_FIELD_FOR[field];
          if (key && !inline[key]) {
            inline[key] = message;
            shown.push(field);
          }
        }
        setErrors({ ...inline, form: errorMessage(err, 'Could not save the coupon.', shown) });
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
      <form className="modal__panel modal__panel--wide" onSubmit={submit} noValidate>
        <h2 className="modal__title">{title}</h2>
        <div className="form-grid">
          <Field label="Code" hint={isNew ? '4-20 letters or digits. Customers can type it in any case.' : 'A code cannot be changed.'} error={errors.code}>
            <input
              className="input mono"
              value={form.code}
              maxLength={20}
              disabled={!isNew}
              autoComplete="off"
              onChange={(e) => set('code', e.target.value.toUpperCase())}
            />
          </Field>
          <Field label="Description" hint="For staff; optional." error={errors.description}>
            <input className="input" value={form.description} maxLength={200} onChange={(e) => set('description', e.target.value)} />
          </Field>
          <Field label="Type" error={errors.discount_type}>
            <select className="input" value={form.discount_type} onChange={(e) => set('discount_type', e.target.value as CouponType)}>
              {(Object.keys(TYPE_LABEL) as CouponType[]).map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          </Field>
          {form.discount_type === 'FIXED' ? (
            <Field label="Amount off (LKR)" error={errors.discount_value}>
              <input className="input" inputMode="decimal" value={form.discount_value} onChange={(e) => set('discount_value', e.target.value)} />
            </Field>
          ) : null}
          {form.discount_type === 'PERCENT' ? (
            <>
              <Field label="Percentage off" hint="1 to 100." error={errors.discount_value}>
                <input className="input" inputMode="decimal" value={form.discount_value} onChange={(e) => set('discount_value', e.target.value)} />
              </Field>
              <Field label="Maximum discount (LKR)" hint="Optional cap." error={errors.max_discount}>
                <input className="input" inputMode="decimal" value={form.max_discount} onChange={(e) => set('max_discount', e.target.value)} />
              </Field>
            </>
          ) : null}
          <Field label="Minimum basket (LKR)" hint="Optional. Items only, before delivery." error={errors.min_subtotal}>
            <input className="input" inputMode="decimal" value={form.min_subtotal} onChange={(e) => set('min_subtotal', e.target.value)} />
          </Field>
          <Field label="First day" hint="Optional (Sri Lanka time)." error={errors.starts_on}>
            <input className="input" type="date" value={form.starts_on} onChange={(e) => set('starts_on', e.target.value)} />
          </Field>
          <Field label="Last day" hint="Optional; the code works until the end of this day." error={errors.ends_on}>
            <input className="input" type="date" value={form.ends_on} onChange={(e) => set('ends_on', e.target.value)} />
          </Field>
          <Field
            label="Total uses"
            hint={
              coupon && coupon.usage_count > 0
                ? `Optional; empty means no limit. Used ${coupon.usage_count} so far - the limit cannot be lower.`
                : 'Optional; empty means no limit.'
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
          <span>First order only</span>
        </label>
        <label className="toggle">
          <input type="checkbox" checked={form.is_active} onChange={(e) => set('is_active', e.target.checked)} />
          <span>Active</span>
        </label>
        {errors.form ? <p className="field__error">{errors.form}</p> : null}
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
