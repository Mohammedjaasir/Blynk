import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { dental } from '../../api/resources';
import { DENTAL_SPECIALTY_LABEL, type ClinicDoctorRosterRow, type DentalClinic, type DentalDoctor } from '../../api/types';
import { LocationPreviewMap } from '../../components/LocationPickerMap';
import { PageHeader } from '../../components/Layout';
import { Badge, EmptyState, Field, Spinner } from '../../components/ui';
import { dentalErrorMessage } from '../../lib/dental';
import { formatMoney } from '../../lib/orders';

/**
 * One clinic's doctor roster (task F8, plan §17): attach an existing
 * (active) doctor with a consultation fee, edit the fee, and toggle a
 * pairing active/inactive. Ported from
 * `apps/admin/src/pages/DentalClinicDoctors.tsx` (a fresh implementation,
 * not an import). Availability templates and blocked dates are managed one
 * level deeper, per clinic-doctor pairing (`Availability.tsx`), reached via
 * each row's own link.
 *
 * Task F9 (plan §21) adds the clinic's single-pin location map right below
 * the header, once the clinic itself has loaded - see
 * `components/ClinicLocationMap.tsx`'s own doc comment for what it shows and
 * the disclosed Static-Maps-API policy conflict this task's report covers.
 */
export function ClinicDetail() {
  const { clinicId } = useParams<{ clinicId: string }>();

  const [clinic, setClinic] = useState<DentalClinic | null>(null);
  const [roster, setRoster] = useState<ClinicDoctorRosterRow[] | null>(null);
  const [allDoctors, setAllDoctors] = useState<DentalDoctor[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [attaching, setAttaching] = useState(false);
  const [editingFee, setEditingFee] = useState<ClinicDoctorRosterRow | null>(null);

  const load = useCallback(async () => {
    if (!clinicId) return;
    try {
      const [clinicRow, rosterRows, doctors] = await Promise.all([
        dental.clinics.get(clinicId),
        dental.clinicDoctors.roster(clinicId),
        dental.doctors.list(true),
      ]);
      setClinic(clinicRow);
      setRoster(rosterRows);
      setAllDoctors(doctors);
      setError(null);
    } catch (err) {
      setError(dentalErrorMessage(err));
      setRoster([]);
    }
  }, [clinicId]);

  useEffect(() => {
    void load();
  }, [load]);

  const availableToAttach = useMemo(() => {
    const attachedIds = new Set((roster ?? []).map((row) => row.doctor_id));
    return allDoctors.filter((doctor) => !attachedIds.has(doctor.id));
  }, [roster, allDoctors]);

  async function togglePairing(row: ClinicDoctorRosterRow) {
    try {
      await dental.clinicDoctors.update(row.clinic_doctor_id, { is_active: !row.pairing_is_active });
      setNotice(`${row.full_name} is now ${row.pairing_is_active ? 'inactive' : 'active'} at this clinic.`);
      await load();
    } catch (err) {
      setNotice(dentalErrorMessage(err));
    }
  }

  if (!clinicId) return null;

  return (
    <div className="page">
      <PageHeader
        title={clinic ? `${clinic.name} — doctors` : 'Clinic doctors'}
        description="Doctors attached to this clinic, their consultation fee and whether they're currently bookable here."
        actions={
          <>
            <Link className="button button--ghost" to="/catalog/dental/clinics">
              Back to clinics
            </Link>
            <button type="button" className="button" onClick={() => setAttaching(true)}>
              Attach doctor
            </button>
          </>
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

      {clinic ? <LocationPreviewMap latitude={clinic.latitude} longitude={clinic.longitude} label={clinic.name} /> : null}

      {roster === null ? (
        <Spinner label="Loading roster" />
      ) : roster.length === 0 ? (
        <EmptyState title="No doctors attached yet" message="Attach a doctor to make this clinic bookable." />
      ) : (
        <ul className="cat-list">
          {roster.map((row) => (
            <li
              key={row.clinic_doctor_id}
              className={`cat-row cat-row--flat${!row.pairing_is_active ? ' is-muted' : ''}`}
            >
              <div className="cat-row__main">
                <p className="cat-row__title">
                  {row.full_name}
                  {!row.doctor_is_active ? (
                    <>
                      {' '}
                      <Badge tone="muted">Doctor inactive</Badge>
                    </>
                  ) : null}
                </p>
                <p className="cat-row__meta">{DENTAL_SPECIALTY_LABEL[row.specialty]}</p>
                <p className="cat-row__meta">
                  {row.consultation_fee === null ? 'No consultation fee set' : formatMoney(row.consultation_fee)}
                </p>
                <div className="cat-row__badges">
                  <Badge tone={row.pairing_is_active ? 'active' : 'inactive'}>
                    {row.pairing_is_active ? 'Active' : 'Inactive'}
                  </Badge>
                </div>
              </div>
              <div className="cat-row__actions">
                <Link
                  className="button button--ghost button--sm"
                  to={`/catalog/dental/clinics/${clinicId}/doctors/${row.clinic_doctor_id}`}
                  state={{ doctorName: row.full_name, clinicName: clinic?.name }}
                >
                  Availability
                </Link>
                <button type="button" className="button button--ghost button--sm" onClick={() => setEditingFee(row)}>
                  Edit fee
                </button>
                <button
                  type="button"
                  className="button button--ghost button--sm"
                  onClick={() => void togglePairing(row)}
                >
                  {row.pairing_is_active ? 'Deactivate' : 'Activate'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {attaching ? (
        <AttachDoctorDialog
          clinicId={clinicId}
          doctors={availableToAttach}
          onClose={() => setAttaching(false)}
          onSaved={async () => {
            setAttaching(false);
            await load();
          }}
        />
      ) : null}

      {editingFee ? (
        <EditFeeDialog
          row={editingFee}
          onClose={() => setEditingFee(null)}
          onSaved={async () => {
            setEditingFee(null);
            await load();
          }}
        />
      ) : null}
    </div>
  );
}

function AttachDoctorDialog({
  clinicId,
  doctors,
  onClose,
  onSaved,
}: {
  clinicId: string;
  doctors: DentalDoctor[];
  onClose(): void;
  onSaved(): void | Promise<void>;
}) {
  const [doctorId, setDoctorId] = useState(doctors[0]?.id ?? '');
  const [fee, setFee] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!doctorId) {
      setError('Choose a doctor to attach.');
      return;
    }
    if (fee.trim() !== '' && (!Number.isFinite(Number(fee)) || Number(fee) < 0)) {
      setError('Fee must be a non-negative number.');
      return;
    }

    setSaving(true);
    try {
      await dental.clinicDoctors.attach(clinicId, {
        doctor_id: doctorId,
        consultation_fee: fee.trim() === '' ? null : Number(fee),
      });
      await onSaved();
    } catch (err) {
      // task-F8-brief.md §"Clinic-doctor relationships": an invalid pairing
      // (inactive/missing clinic or doctor, duplicate) must surface as a
      // real, clear error, never a silent or generic failure.
      setError(dentalErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Attach doctor">
      <form className="modal__panel" onSubmit={submit}>
        <h2 className="modal__title">Attach a doctor</h2>
        {doctors.length === 0 ? (
          <p className="form__note">Every active doctor is already attached to this clinic. Add a new doctor first.</p>
        ) : (
          <>
            <Field label="Doctor">
              <select className="input" value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
                {doctors.map((doctor) => (
                  <option key={doctor.id} value={doctor.id}>
                    {doctor.full_name} — {DENTAL_SPECIALTY_LABEL[doctor.specialty]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Consultation fee (LKR)" hint="Optional, indicative - payable at the clinic">
              <input className="input" inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} />
            </Field>
          </>
        )}
        {error ? (
          <p className="field__error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="modal__actions">
          <button type="button" className="button button--ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button" disabled={saving || doctors.length === 0}>
            {saving ? <Spinner label="Saving" /> : 'Attach'}
          </button>
        </div>
      </form>
    </div>
  );
}

function EditFeeDialog({
  row,
  onClose,
  onSaved,
}: {
  row: ClinicDoctorRosterRow;
  onClose(): void;
  onSaved(): void | Promise<void>;
}) {
  const [fee, setFee] = useState(row.consultation_fee === null ? '' : String(row.consultation_fee));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (fee.trim() !== '' && (!Number.isFinite(Number(fee)) || Number(fee) < 0)) {
      setError('Fee must be a non-negative number.');
      return;
    }
    setSaving(true);
    try {
      await dental.clinicDoctors.update(row.clinic_doctor_id, {
        consultation_fee: fee.trim() === '' ? null : Number(fee),
      });
      await onSaved();
    } catch (err) {
      setError(dentalErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Edit consultation fee">
      <form className="modal__panel" onSubmit={submit}>
        <h2 className="modal__title">Edit fee — {row.full_name}</h2>
        <Field label="Consultation fee (LKR)" hint="Optional, indicative - payable at the clinic">
          <input className="input" inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} />
        </Field>
        {error ? (
          <p className="field__error" role="alert">
            {error}
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
