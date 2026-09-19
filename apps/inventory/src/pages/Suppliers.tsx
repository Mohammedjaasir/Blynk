import { useRef, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { suppliersApi } from '../api/resources';
import type { Supplier, SupplierInput } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { can } from '../auth/can';
import { PageHeader } from '../components/Layout';
import { ConfirmDialog, Dialog, EmptyState, Field, LoadError, SkeletonRows, Spinner, Status, useToast } from '../components/ui';
import { errorMessage, isApiError } from '../lib/errors';
import { useLoad } from '../lib/useLoad';

/**
 * Where Blynk buys from. Everyone in Inventory can read the list (staff pick
 * from it while sourcing); only an admin can add, edit, deactivate or
 * reactivate. The backend has no delete - deactivating retires a supplier
 * while keeping its sourcing history intact.
 */
export function Suppliers() {
  const { user } = useAuth();
  const toast = useToast();
  const manage = can(user?.role, 'manageSuppliers');
  const [params, setParams] = useSearchParams();
  const showAll = params.get('show') === 'all';
  const { data, error, loading, reload } = useLoad(() => suppliersApi.list(!showAll), [showAll]);
  const [editing, setEditing] = useState<Supplier | 'new' | null>(null);
  const [toggling, setToggling] = useState<Supplier | null>(null);
  const [toggleBusy, setToggleBusy] = useState(false);
  const [toggleError, setToggleError] = useState<string | null>(null);

  async function toggleActive() {
    if (!toggling) return;
    setToggleBusy(true);
    setToggleError(null);
    try {
      await suppliersApi.update(toggling.id, { is_active: !toggling.is_active });
      toast.success(`${toggling.name} ${toggling.is_active ? 'deactivated' : 'reactivated'}.`);
      setToggling(null);
      await reload();
    } catch (err) {
      setToggleError(errorMessage(err));
    } finally {
      setToggleBusy(false);
    }
  }

  const rows = data ?? [];

  return (
    <>
      <PageHeader
        title="Suppliers"
        description={
          manage
            ? 'Market sources Blynk buys from. Staff choose from active suppliers when sourcing.'
            : 'Market sources Blynk buys from. Suppliers are added and changed by a Blynk admin.'
        }
        actions={
          manage ? (
            <button type="button" className="button" onClick={() => setEditing('new')}>
              Add supplier
            </button>
          ) : null
        }
      />

      <div className="toolbar">
        <div className="segmented" role="group" aria-label="Which suppliers">
          <button
            type="button"
            className="segmented__option"
            aria-pressed={!showAll}
            onClick={() => setParams(new URLSearchParams(), { replace: true })}
          >
            Active
          </button>
          <button
            type="button"
            className="segmented__option"
            aria-pressed={showAll}
            onClick={() => setParams(new URLSearchParams({ show: 'all' }), { replace: true })}
          >
            All
          </button>
        </div>
      </div>

      {error ? <LoadError error={error} onRetry={() => void reload()} /> : null}

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Supplier</th>
              <th scope="col">Contact</th>
              <th scope="col">Address</th>
              <th scope="col">Status</th>
              {manage ? (
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              ) : null}
            </tr>
          </thead>
          {loading && !data ? (
            <SkeletonRows columns={manage ? 5 : 4} rows={4} />
          ) : (
            <tbody>
              {rows.map((s) => (
                <tr key={s.id} className={s.is_active ? '' : 'is-muted'}>
                  <td>
                    <span className="cell__primary">{s.name}</span>
                    <span className="cell__secondary mono">{s.code ?? 'No code'}</span>
                  </td>
                  <td>
                    <span>{s.contact_person ?? '—'}</span>
                    <span className="cell__secondary mono">{s.contact_phone ?? ''}</span>
                  </td>
                  <td className="cell__secondary">{s.address ?? '—'}</td>
                  <td>
                    <Status tone={s.is_active ? 'ok' : 'muted'}>{s.is_active ? 'Active' : 'Inactive'}</Status>
                  </td>
                  {manage ? (
                    <td className="actions">
                      <button type="button" className="button button--ghost button--sm" onClick={() => setEditing(s)}>
                        Edit
                      </button>
                      <button type="button" className="button button--ghost button--sm" onClick={() => setToggling(s)}>
                        {s.is_active ? 'Deactivate' : 'Reactivate'}
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          )}
        </table>
      </div>

      {data && rows.length === 0 ? (
        <EmptyState
          title={showAll ? 'No suppliers yet' : 'No active suppliers'}
          message={manage ? 'Add the market sources you buy from.' : 'Ask a Blynk admin to add suppliers.'}
        />
      ) : null}

      {editing ? (
        <SupplierDialog
          supplier={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async (message) => {
            setEditing(null);
            toast.success(message);
            await reload();
          }}
        />
      ) : null}

      {toggling ? (
        <ConfirmDialog
          title={toggling.is_active ? 'Deactivate supplier' : 'Reactivate supplier'}
          confirmLabel={toggling.is_active ? 'Deactivate' : 'Reactivate'}
          busy={toggleBusy}
          error={toggleError}
          onConfirm={() => void toggleActive()}
          onCancel={() => {
            setToggling(null);
            setToggleError(null);
          }}
        >
          {toggling.is_active ? (
            <p>
              <strong>{toggling.name}</strong> will no longer be offered when sourcing. Its past sourcing records are
              kept.
            </p>
          ) : (
            <p>
              <strong>{toggling.name}</strong> will be offered again when sourcing.
            </p>
          )}
        </ConfirmDialog>
      ) : null}
    </>
  );
}

const LIMITS = { name: 128, code: 64, contact_person: 128, contact_phone: 20, address: 500, notes: 500 };

function SupplierDialog({
  supplier,
  onClose,
  onSaved,
}: {
  supplier: Supplier | null;
  onClose(): void;
  onSaved(message: string): void | Promise<void>;
}) {
  const [form, setForm] = useState({
    name: supplier?.name ?? '',
    code: supplier?.code ?? '',
    contact_person: supplier?.contact_person ?? '',
    contact_phone: supplier?.contact_phone ?? '',
    address: supplier?.address ?? '',
    notes: supplier?.notes ?? '',
  });
  const [errors, setErrors] = useState<Partial<Record<keyof typeof form, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);

  const set = (key: keyof typeof form) => (event: { target: { value: string } }) => {
    setForm((f) => ({ ...f, [key]: event.target.value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };

  function validate() {
    const next: typeof errors = {};
    if (form.name.trim().length < 2) next.name = 'Name must be at least 2 characters.';
    for (const [key, max] of Object.entries(LIMITS) as Array<[keyof typeof form, number]>) {
      if (form[key].trim().length > max) next[key] = `Keep this under ${max} characters.`;
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current || !validate()) return;
    submitting.current = true;
    setBusy(true);
    setFormError(null);

    // Send only filled fields. The backend cannot clear a field to empty, and
    // an empty code would collide with the unique index, so blanks are left out.
    const body: SupplierInput = {};
    for (const key of Object.keys(LIMITS) as Array<keyof typeof form>) {
      const value = form[key].trim();
      if (value) body[key] = value;
    }

    try {
      if (supplier) {
        await suppliersApi.update(supplier.id, body);
        await onSaved(`${body.name ?? supplier.name} updated.`);
      } else {
        await suppliersApi.create(body);
        await onSaved(`${body.name} added.`);
      }
    } catch (err) {
      if (isApiError(err, 'SUPPLIER_CODE_TAKEN')) {
        setErrors((e) => ({ ...e, code: 'Another supplier already uses this code.' }));
      } else {
        setFormError(errorMessage(err, 'The supplier was not saved.'));
      }
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <Dialog title={supplier ? `Edit ${supplier.name}` : 'Add supplier'} onClose={onClose}>
      <form onSubmit={submit} className="form" noValidate>
        <Field label="Name" error={errors.name}>
          <input className="input" value={form.name} onChange={set('name')} data-autofocus />
        </Field>
        <div className="form__row">
          <Field label="Code (optional)" hint="Short unique reference, e.g. SUP-DHARGA-MAIN" error={errors.code}>
            <input className="input input--mono" value={form.code} onChange={set('code')} />
          </Field>
          <Field label="Contact phone" error={errors.contact_phone}>
            <input className="input input--mono" inputMode="tel" value={form.contact_phone} onChange={set('contact_phone')} />
          </Field>
        </div>
        <Field label="Contact person" error={errors.contact_person}>
          <input className="input" value={form.contact_person} onChange={set('contact_person')} />
        </Field>
        <Field label="Address" error={errors.address}>
          <input className="input" value={form.address} onChange={set('address')} />
        </Field>
        <Field label="Notes" error={errors.notes}>
          <textarea className="input" rows={2} value={form.notes} onChange={set('notes')} />
        </Field>
        {supplier ? (
          <p className="form__lead">Fields left blank keep their current value.</p>
        ) : null}
        {formError ? (
          <p className="field__error" role="alert">
            {formError}
          </p>
        ) : null}
        <div className="modal__actions">
          <button type="button" className="button button--ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button" disabled={busy}>
            {busy ? <Spinner label="Saving" /> : supplier ? 'Save changes' : 'Add supplier'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
