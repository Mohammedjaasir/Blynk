import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';
import { dentalDoctors } from '../api/resources';
import { DENTAL_SPECIALTY_SUGGESTIONS, type DentalDoctor } from '../api/types';
import { PageHeader } from '../components/Layout';
import { DoctorsSignInCard } from '../components/DoctorsSignInCard';
import { Badge, EmptyState, Field, Spinner, useToast } from '../components/ui';
import { errorMessage } from '../lib/apiErrors';

/**
 * Dental doctors (owner, 2026-10-09): list, add, edit and activate or
 * deactivate - the same /admin/dental/doctors endpoints the Operations app
 * uses. A doctor's specialty is free text (migration 030, 2-64 characters);
 * the six common ones are quick-pick chips. There is no delete endpoint:
 * deactivating retires a doctor and keeps their appointment history.
 */

/** The six enum codes doctors.specialty held before migration 030, in case
 * an old value comes back before the migration runs. */
const LEGACY_SPECIALTY_LABEL: Record<string, string> = {
  GENERAL_DENTIST: 'General dentist',
  ORTHODONTIST: 'Orthodontist',
  PERIODONTIST: 'Periodontist',
  ENDODONTIST: 'Endodontist',
  ORAL_SURGEON: 'Oral surgeon',
  PEDIATRIC_DENTIST: 'Pediatric dentist',
};

/** A doctor's specialty as written, or the label of an old enum code. */
export function specialtyLabel(specialty: string | null | undefined): string {
  if (!specialty) return '';
  return LEGACY_SPECIALTY_LABEL[specialty] ?? specialty;
}

const SPECIALTY_MIN = 2;
const SPECIALTY_MAX = 64;

export function DentalDoctors() {
  const toast = useToast();
  const [rows, setRows] = useState<DentalDoctor[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<DentalDoctor | 'new' | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await dentalDoctors.list());
      setError(null);
    } catch (err) {
      setError(errorMessage(err, 'Could not load the doctors.'));
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleActive(doctor: DentalDoctor) {
    try {
      await dentalDoctors.update(doctor.id, { is_active: !doctor.is_active });
      toast.success(`${doctor.full_name} is now ${doctor.is_active ? 'inactive' : 'active'}.`);
      await load();
    } catch (err) {
      toast.error(errorMessage(err, 'Could not change the doctor.'));
    }
  }

  return (
    <>
      <PageHeader
        title="Doctors"
        description="Doctors customers can book in the Blynk app, at whichever clinics attach them (clinics are set up in the Operations app)."
        actions={
          <button type="button" className="button" onClick={() => setEditing('new')}>
            Add doctor
          </button>
        }
      />

      <DoctorsSignInCard />

      {error ? <p className="field__error">{error}</p> : null}

      {rows === null ? (
        <Spinner label="Loading doctors" />
      ) : rows.length === 0 ? (
        error ? null : <EmptyState title="No doctors yet" message="Add a doctor, then attach them to a clinic." />
      ) : (
        <div className="table-wrap">
          <table className="table" aria-label="Doctors">
            <thead>
              <tr>
                <th scope="col">Doctor</th>
                <th scope="col">Specialty</th>
                <th scope="col">Rating</th>
                <th scope="col">Status</th>
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((doctor) => (
                <tr key={doctor.id}>
                  <td>
                    <span className="cell__primary">{doctor.full_name}</span>
                  </td>
                  <td>{specialtyLabel(doctor.specialty)}</td>
                  <td className="cell__secondary">
                    {doctor.rating_count && doctor.rating_average != null
                      ? `★ ${doctor.rating_average.toFixed(1)} (${doctor.rating_count})`
                      : '—'}
                  </td>
                  <td>
                    <Badge tone={doctor.is_active ? 'active' : 'inactive'}>
                      {doctor.is_active ? 'Active' : 'Inactive'}
                    </Badge>
                  </td>
                  <td>
                    <div className="row-actions">
                      <button
                        type="button"
                        className="button button--ghost button--sm"
                        aria-label={`Edit ${doctor.full_name}`}
                        onClick={() => setEditing(doctor)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="button button--ghost button--sm"
                        aria-label={`${doctor.is_active ? 'Deactivate' : 'Activate'} ${doctor.full_name}`}
                        onClick={() => void toggleActive(doctor)}
                      >
                        {doctor.is_active ? 'Deactivate' : 'Activate'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing ? (
        <DoctorDialog
          doctor={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async (saved) => {
            toast.success(`${saved.full_name} is saved.`);
            setEditing(null);
            await load();
          }}
        />
      ) : null}
    </>
  );
}

function DoctorDialog({
  doctor,
  onClose,
  onSaved,
}: {
  doctor: DentalDoctor | null;
  onClose(): void;
  onSaved(doctor: DentalDoctor): void | Promise<void>;
}) {
  const [form, setForm] = useState({
    full_name: doctor?.full_name ?? '',
    specialty: specialtyLabel(doctor?.specialty),
    photo_url: doctor?.photo_url ?? '',
    bio: doctor?.bio ?? '',
    is_active: doctor?.is_active ?? true,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const found: Record<string, string> = {};
    if (form.full_name.trim().length < 2) found.full_name = 'Name must be at least 2 characters.';
    const specialty = form.specialty.trim();
    if (specialty.length < SPECIALTY_MIN || specialty.length > SPECIALTY_MAX) {
      found.specialty = `Specialty must be ${SPECIALTY_MIN} to ${SPECIALTY_MAX} characters.`;
    }
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    const payload = {
      full_name: form.full_name.trim(),
      specialty,
      photo_url: form.photo_url.trim() || null,
      bio: form.bio.trim() || null,
      is_active: form.is_active,
    };
    setSaving(true);
    setFormError(null);
    try {
      const saved = doctor ? await dentalDoctors.update(doctor.id, payload) : await dentalDoctors.create(payload);
      await onSaved(saved);
    } catch (err) {
      setFormError(errorMessage(err, 'Could not save the doctor.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Doctor">
      <form className="modal__panel modal__panel--wide" onSubmit={submit} noValidate>
        <h2 className="modal__title">{doctor ? 'Edit doctor' : 'Add doctor'}</h2>
        <Field label="Full name" error={errors.full_name}>
          <input
            className="input"
            value={form.full_name}
            onChange={(e) => setForm({ ...form, full_name: e.target.value })}
          />
        </Field>
        <SpecialtyPicker
          value={form.specialty}
          error={errors.specialty}
          onChange={(specialty) => setForm({ ...form, specialty })}
        />
        <Field label="Photo URL" hint="Optional.">
          <input
            className="input"
            value={form.photo_url}
            onChange={(e) => setForm({ ...form, photo_url: e.target.value })}
          />
        </Field>
        <Field label="Bio" hint="Optional, shown on the doctor's profile.">
          <textarea
            className="input"
            rows={3}
            value={form.bio}
            onChange={(e) => setForm({ ...form, bio: e.target.value })}
          />
        </Field>
        <label className="toggle">
          <input
            type="checkbox"
            checked={form.is_active}
            onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
          />
          <span>
            <strong>Active</strong>
            <em>Inactive doctors can't be attached to a clinic or booked.</em>
          </span>
        </label>
        {formError ? (
          <p className="field__error" role="alert">
            {formError}
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

/**
 * Specialty: quick-pick chips plus a text box holding the actual value
 * (owner, 2026-10-09). A chip is on while the text matches it
 * (case-insensitive), so typing anything else turns it off. Not a `Field`,
 * whose <label> would send every click on it to the first chip.
 */
function SpecialtyPicker({
  value,
  error,
  onChange,
}: {
  value: string;
  error?: string;
  onChange(value: string): void;
}) {
  const labelId = useId();
  const current = value.trim().toLowerCase();
  return (
    <div className="field">
      <span className="field__label" id={labelId}>
        Specialty
      </span>
      <div className="specialty-chips" role="group" aria-label="Specialty suggestions">
        {DENTAL_SPECIALTY_SUGGESTIONS.map((suggestion) => {
          const selected = current === suggestion.toLowerCase();
          return (
            <button
              key={suggestion}
              type="button"
              className={`specialty-chip${selected ? ' is-selected' : ''}`}
              aria-pressed={selected}
              onClick={() => onChange(suggestion)}
            >
              {suggestion}
            </button>
          );
        })}
      </div>
      <input
        className="input"
        aria-labelledby={labelId}
        placeholder="Or type a specialty"
        maxLength={SPECIALTY_MAX}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {error ? <span className="field__error">{error}</span> : null}
    </div>
  );
}
