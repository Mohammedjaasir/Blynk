import { LocationPickerMap } from '../../components/LocationPickerMap';
import { toLatLng } from '../../lib/route';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { dental } from '../../api/resources';
import type { DentalClinic } from '../../api/types';
import { PageHeader } from '../../components/Layout';
import { Badge, EmptyState, Field, Spinner } from '../../components/ui';
import { dentalErrorMessage } from '../../lib/dental';

/**
 * Dental clinics: create, edit and activate/deactivate (task F8, plan §15).
 * Ported from `apps/admin/src/pages/DentalClinics.tsx` (a fresh
 * implementation, not an import - common.md rule 2), as a mobile card list
 * (Operations' own `cat-list`/`cat-row` convention already established by
 * F5/F6/F7) instead of Admin's `<table>` - same form shape and validation-
 * error surfacing, different list chrome, per the brief's own instruction.
 *
 * **No hard-delete endpoint exists** (confirmed directly against
 * `backend/api/src/modules/dental/index.ts`'s route table - only
 * POST/GET/PATCH are registered for `/admin/dental/clinics`), so this screen
 * offers none - deactivating is the only supported way to retire one,
 * matching Admin's own reasoning exactly (preserves appointment-history
 * integrity; `clinic_doctors.clinic_id` is `ON DELETE RESTRICT` besides).
 * Doctor roster / availability / blocked dates are managed from the clinic
 * detail screen (`ClinicDetail.tsx`), reached via each row's "Doctors" link.
 */
export function Clinics() {
  const [rows, setRows] = useState<DentalClinic[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<DentalClinic | 'new' | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await dental.clinics.list());
      setError(null);
    } catch (err) {
      setError(dentalErrorMessage(err));
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleActive(clinic: DentalClinic) {
    try {
      await dental.clinics.update(clinic.id, { is_active: !clinic.is_active });
      setNotice(`${clinic.name} is now ${clinic.is_active ? 'inactive' : 'active'}.`);
      await load();
    } catch (err) {
      setNotice(dentalErrorMessage(err));
    }
  }

  return (
    <div className="page">
      <PageHeader
        title="Clinics"
        description="Clinics where customers can channel a doctor in the customer app."
        actions={
          <button type="button" className="button" onClick={() => setEditing('new')}>
            Add clinic
          </button>
        }
      />

      {notice ? (
        <p className="field__error" role="status">
          {notice}
          <button type="button" className="field__error-dismiss" onClick={() => setNotice(null)} aria-label="Dismiss">
            ×
          </button>
        </p>
      ) : null}
      {error ? <p className="field__error">{error}</p> : null}

      {rows === null ? (
        <Spinner label="Loading clinics" />
      ) : rows.length === 0 ? (
        <EmptyState title="No clinics yet" message="Add the first clinic to start offering doctor appointments." />
      ) : (
        <ul className="cat-list">
          {rows.map((clinic) => (
            <li key={clinic.id} className={`cat-row cat-row--flat${!clinic.is_active ? ' is-muted' : ''}`}>
              <div className="cat-row__main">
                <p className="cat-row__title">{clinic.name}</p>
                <p className="cat-row__meta">{clinic.city}</p>
                <p className="cat-row__meta">
                  {clinic.operating_start_time.slice(0, 5)}–{clinic.operating_end_time.slice(0, 5)} ·{' '}
                  {clinic.contact_phone}
                </p>
                <div className="cat-row__badges">
                  <Badge tone={clinic.is_active ? 'active' : 'inactive'}>
                    {clinic.is_active ? 'Active' : 'Inactive'}
                  </Badge>
                </div>
              </div>
              <div className="cat-row__actions">
                <Link className="button button--ghost button--sm" to={`/catalog/dental/clinics/${clinic.id}`}>
                  Doctors
                </Link>
                <button type="button" className="button button--ghost button--sm" onClick={() => setEditing(clinic)}>
                  Edit
                </button>
                <button
                  type="button"
                  className="button button--ghost button--sm"
                  onClick={() => void toggleActive(clinic)}
                >
                  {clinic.is_active ? 'Deactivate' : 'Activate'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="page__note">
        The API supports creating and updating clinics; it has no delete endpoint, so deactivation is the way to
        retire one.
      </p>

      {editing ? (
        <ClinicDialog
          clinic={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
        />
      ) : null}
    </div>
  );
}

interface ClinicFormState {
  name: string;
  city: string;
  address_line: string;
  latitude: string;
  longitude: string;
  contact_phone: string;
  operating_start_time: string;
  operating_end_time: string;
  is_active: boolean;
}

function toFormState(clinic: DentalClinic | null): ClinicFormState {
  return {
    name: clinic?.name ?? '',
    city: clinic?.city ?? '',
    address_line: clinic?.address_line ?? '',
    latitude: clinic ? String(clinic.latitude) : '',
    longitude: clinic ? String(clinic.longitude) : '',
    contact_phone: clinic?.contact_phone ?? '',
    // <input type="time"> wants HH:MM; the API round-trips TIME as HH:MM:SS.
    operating_start_time: clinic?.operating_start_time.slice(0, 5) ?? '09:00',
    operating_end_time: clinic?.operating_end_time.slice(0, 5) ?? '17:00',
    is_active: clinic?.is_active ?? true,
  };
}

function ClinicDialog({
  clinic,
  onClose,
  onSaved,
}: {
  clinic: DentalClinic | null;
  onClose(): void;
  onSaved(): void | Promise<void>;
}) {
  const [form, setForm] = useState<ClinicFormState>(toFormState(clinic));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (form.name.trim().length < 2) next.name = 'Name must be at least 2 characters.';
    if (!form.city.trim()) next.city = 'City is required.';
    if (!form.address_line.trim()) next.address_line = 'Address is required.';
    const lat = Number(form.latitude);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) next.latitude = 'Latitude must be between -90 and 90.';
    const lon = Number(form.longitude);
    if (!Number.isFinite(lon) || lon < -180 || lon > 180) next.longitude = 'Longitude must be between -180 and 180.';
    if (form.contact_phone.trim().length < 7) next.contact_phone = 'Enter a valid phone number.';
    // Courtesy hint only - the backend is the real authority on hours
    // (including the merge-then-validate check on a single-field PATCH).
    if (form.operating_end_time <= form.operating_start_time) {
      next.operating_end_time = 'Closing time must be after opening time.';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setServerError(null);
    if (!validate()) return;

    const payload = {
      name: form.name.trim(),
      city: form.city.trim(),
      address_line: form.address_line.trim(),
      latitude: Number(form.latitude),
      longitude: Number(form.longitude),
      contact_phone: form.contact_phone.trim(),
      operating_start_time: form.operating_start_time,
      operating_end_time: form.operating_end_time,
      is_active: form.is_active,
    };

    setSaving(true);
    try {
      if (clinic) {
        await dental.clinics.update(clinic.id, payload);
      } else {
        await dental.clinics.create(payload);
      }
      await onSaved();
    } catch (err) {
      // The backend's merge-then-validate INVALID_CLINIC_HOURS rejection
      // (and any other real refusal) must read as a clear, specific error -
      // never a generic failure (task-F8-brief.md).
      setServerError(dentalErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Clinic">
      <form className="modal__panel modal__panel--wide" onSubmit={submit}>
        <h2 className="modal__title">{clinic ? 'Edit clinic' : 'Add clinic'}</h2>
        <Field label="Name" error={errors.name}>
          <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <div className="form__row">
          <Field label="City" error={errors.city}>
            <input
              className="input"
              value={form.city}
              onChange={(e) => setForm({ ...form, city: e.target.value })}
            />
          </Field>
          <Field label="Contact phone" error={errors.contact_phone}>
            <input
              className="input"
              inputMode="tel"
              value={form.contact_phone}
              onChange={(e) => setForm({ ...form, contact_phone: e.target.value })}
            />
          </Field>
        </div>
        <Field label="Address" error={errors.address_line}>
          <input
            className="input"
            value={form.address_line}
            onChange={(e) => setForm({ ...form, address_line: e.target.value })}
          />
        </Field>
        <LocationPickerMap
          label="Hospital location"
          value={toLatLng(form.latitude, form.longitude)}
          onChange={(p) => setForm((f) => ({ ...f, latitude: String(p.lat), longitude: String(p.lng) }))}
        />
        <div className="form__row">
          <Field label="Latitude" error={errors.latitude}>
            <input
              className="input"
              inputMode="decimal"
              value={form.latitude}
              onChange={(e) => setForm({ ...form, latitude: e.target.value })}
            />
          </Field>
          <Field label="Longitude" error={errors.longitude}>
            <input
              className="input"
              inputMode="decimal"
              value={form.longitude}
              onChange={(e) => setForm({ ...form, longitude: e.target.value })}
            />
          </Field>
        </div>
        <div className="form__row">
          <Field label="Opens" error={errors.operating_start_time}>
            <input
              className="input"
              type="time"
              value={form.operating_start_time}
              onChange={(e) => setForm({ ...form, operating_start_time: e.target.value })}
            />
          </Field>
          <Field label="Closes" error={errors.operating_end_time}>
            <input
              className="input"
              type="time"
              value={form.operating_end_time}
              onChange={(e) => setForm({ ...form, operating_end_time: e.target.value })}
            />
          </Field>
        </div>
        <label className="toggle">
          <input
            type="checkbox"
            checked={form.is_active}
            onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
          />
          <span>
            <strong>Active</strong>
            <em>Inactive clinics disappear from the customer app.</em>
          </span>
        </label>
        {serverError ? (
          <p className="field__error" role="alert">
            {serverError}
          </p>
        ) : null}
        <div className="modal__actions">
          <button type="button" className="button button--ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button" disabled={saving}>
            {saving ? <Spinner label="Saving" /> : 'Save'}
          </button>
        </div>
      </form>
    </div>
  );
}
