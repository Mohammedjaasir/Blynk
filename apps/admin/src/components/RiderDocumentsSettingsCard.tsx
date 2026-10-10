import { useEffect, useState, type FormEvent } from 'react';
import { riderDocuments, type RiderDocumentSettings, type RiderDocumentType, type RiderDocumentTypeInput } from '../api/riderDocuments';
import type { VehicleType } from '../api/types';
import { errorMessage, fieldErrors } from '../lib/apiErrors';
import { MOTOR_VEHICLES, VEHICLE_TYPES } from '../lib/riderDocuments';
import { Switch } from './Switch';
import { Spinner, useToast } from './ui';
import './riderDocuments.css';

/**
 * Settings -> Rider documents (owner, 2026-10-10: "give all the options to
 * control to ops and admin"). Which documents a rider uploads at sign-up:
 * the four built-ins (Vehicle book (CR), Revenue licence, Insurance
 * certificate, Driving licence - fixed names, can be hidden) plus up to 10
 * custom ones. Per document: Required (all motor vehicles; the chips refine
 * it per vehicle type, bicycles off by default), needs an expiry date, front
 * and back, and shown in the app. Save sends the whole list (PUT); a custom
 * document left out is removed.
 */

const VEHICLE_SHORT: Record<VehicleType, string> = {
  MOTORCYCLE: 'Motorcycle',
  SCOOTER: 'Scooter',
  THREE_WHEELER: 'Three-wheeler',
  CAR: 'Car',
  BICYCLE: 'Bicycle',
};

const MAX_CUSTOM = 10;
const LABEL_MIN = 2;
const LABEL_MAX = 80;

interface Row extends Omit<RiderDocumentType, 'key'> {
  key?: string;
  /** Stable React key, also for rows not saved yet. */
  rowId: string;
}

let nextRowId = 0;
const toRows = (s: RiderDocumentSettings): Row[] => s.documents.map((d) => ({ ...d, rowId: d.key }));

function labelError(label: string): string | undefined {
  const text = label.trim();
  if (text.length < LABEL_MIN) return 'Give the document a name (at least 2 characters).';
  if (text.length > LABEL_MAX) return `Keep the name to ${LABEL_MAX} characters.`;
  return undefined;
}

export function RiderDocumentsSettingsCard() {
  const toast = useToast();
  const [current, setCurrent] = useState<RiderDocumentSettings | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [newLabel, setNewLabel] = useState('');
  const [addError, setAddError] = useState<string | undefined>();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function show(s: RiderDocumentSettings) {
    setCurrent(s);
    setRows(toRows(s));
  }

  useEffect(() => {
    let live = true;
    riderDocuments
      .getSettings()
      .then((s) => live && show(s))
      .catch((err) => live && setLoadError(errorMessage(err, 'Could not load rider documents.')));
    return () => {
      live = false;
    };
  }, []);

  const update = (rowId: string, patch: Partial<Row>) =>
    setRows((list) => list.map((r) => (r.rowId === rowId ? { ...r, ...patch } : r)));

  function toggleVehicle(row: Row, vehicle: VehicleType) {
    const has = row.required_for.includes(vehicle);
    const next = has ? row.required_for.filter((v) => v !== vehicle) : [...row.required_for, vehicle];
    update(row.rowId, { required_for: VEHICLE_TYPES.filter((v) => next.includes(v)) });
  }

  function addDocument() {
    const problem = labelError(newLabel);
    if (problem) {
      setAddError(problem);
      return;
    }
    if (rows.filter((r) => !r.builtin).length >= MAX_CUSTOM) {
      setAddError(`At most ${MAX_CUSTOM} custom documents.`);
      return;
    }
    if (rows.some((r) => r.label.trim().toLowerCase() === newLabel.trim().toLowerCase())) {
      setAddError('There is already a document with this name.');
      return;
    }
    setAddError(undefined);
    setRows((list) => [
      ...list,
      {
        rowId: `new-${++nextRowId}`,
        label: newLabel.trim(),
        builtin: false,
        enabled: true,
        required_for: [],
        needs_expiry: false,
        needs_back: false,
      },
    ]);
    setNewLabel('');
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaveError(null);
    // Custom names are checked here first; the API checks again.
    const local: Record<string, string> = {};
    rows.forEach((r, i) => {
      if (!r.builtin) {
        const problem = labelError(r.label);
        if (problem) local[`documents.${i}.label`] = problem;
      }
    });
    if (Object.keys(local).length) {
      setErrors(local);
      return;
    }
    setErrors({});
    const body: RiderDocumentTypeInput[] = rows.map((r) => ({
      ...(r.key ? { key: r.key } : {}),
      ...(r.builtin ? {} : { label: r.label.trim() }),
      enabled: r.enabled,
      required_for: r.required_for,
      needs_expiry: r.needs_expiry,
      needs_back: r.needs_back,
    }));
    setSaving(true);
    try {
      show(await riderDocuments.setSettings(body));
      toast.success('Rider documents saved.');
    } catch (err) {
      const fields = fieldErrors(err);
      setErrors(fields);
      setSaveError(errorMessage(err, 'Could not save rider documents.', Object.keys(fields).filter((f) => /^documents\.\d+\./.test(f))));
    } finally {
      setSaving(false);
    }
  }

  /** Server / local errors for row `i` ("documents.4.label" etc.). */
  const rowErrors = (i: number) =>
    Object.entries(errors)
      .filter(([field]) => field === `documents.${i}` || field.startsWith(`documents.${i}.`))
      .map(([, message]) => message);

  return (
    <section className="panel" aria-label="Rider documents">
      <h2 className="panel__title">Rider documents</h2>
      {loadError ? (
        <p className="field__error">{loadError}</p>
      ) : !current ? (
        <Spinner label="Loading rider documents" />
      ) : (
        <form className="form" onSubmit={save} noValidate>
          <p className="form__note">
            What a new rider uploads in the Rider app. Required documents must be verified before the rider can be approved;
            the others are optional. Admin and Operations review them under Rider requests.
          </p>
          <div className="rd-types">
            {rows.map((row, i) => {
              const name = row.label.trim() || 'New document';
              const problems = rowErrors(i);
              return (
                <div key={row.rowId} className={`rd-type${row.enabled ? '' : ' is-off'}`} role="group" aria-label={name}>
                  <div className="rd-type__head">
                    {row.builtin ? (
                      <h3 className="rd-type__name">{row.label}</h3>
                    ) : (
                      <div className="rd-type__name">
                        <input
                          className="input"
                          aria-label={`Name of ${name}`}
                          maxLength={LABEL_MAX}
                          value={row.label}
                          onChange={(e) => update(row.rowId, { label: e.target.value })}
                        />
                      </div>
                    )}
                    {row.builtin ? <span className="rd-chip rd-chip--soft">Built-in</span> : <span className="rd-chip rd-chip--soft">Custom</span>}
                    {!row.builtin ? (
                      <button
                        type="button"
                        className="button button--ghost button--sm"
                        aria-label={`Remove ${name}`}
                        onClick={() => setRows((list) => list.filter((r) => r.rowId !== row.rowId))}
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>
                  <div className="rd-type__switches">
                    <Switch
                      label={`Required: ${name}`}
                      checked={row.required_for.length > 0}
                      onChange={(on) => update(row.rowId, { required_for: on ? [...MOTOR_VEHICLES] : [] })}
                    >
                      Required
                    </Switch>
                    <Switch label={`Needs expiry date: ${name}`} checked={row.needs_expiry} onChange={(on) => update(row.rowId, { needs_expiry: on })}>
                      Needs expiry date
                    </Switch>
                    <Switch label={`Front and back: ${name}`} checked={row.needs_back} onChange={(on) => update(row.rowId, { needs_back: on })}>
                      Front and back
                    </Switch>
                    <Switch label={`Shown in the app: ${name}`} checked={row.enabled} onChange={(on) => update(row.rowId, { enabled: on })}>
                      Shown in the app
                    </Switch>
                  </div>
                  <div className="rd-type__vehicles" role="group" aria-label={`Required for: ${name}`}>
                    <span className="rd-type__vehicles-label">Required for</span>
                    {VEHICLE_TYPES.map((v) => {
                      const on = row.required_for.includes(v);
                      return (
                        <button
                          key={v}
                          type="button"
                          className={`rd-choice${on ? ' is-selected' : ''}`}
                          aria-pressed={on}
                          onClick={() => toggleVehicle(row, v)}
                        >
                          {VEHICLE_SHORT[v]}
                        </button>
                      );
                    })}
                    {row.required_for.length === 0 ? <span className="cell__secondary">Optional for everyone</span> : null}
                  </div>
                  {!row.enabled ? <p className="form__note">Hidden: riders are not asked for it and it does not block approval.</p> : null}
                  {problems.map((p) => (
                    <p key={p} className="field__error" role="alert">
                      {p}
                    </p>
                  ))}
                </div>
              );
            })}
          </div>

          <div className="rd-add">
            <label className="field">
              <span className="field__label">Add a document</span>
              <input
                className="input"
                placeholder="e.g. Police clearance report"
                maxLength={LABEL_MAX}
                value={newLabel}
                onChange={(e) => {
                  setNewLabel(e.target.value);
                  setAddError(undefined);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addDocument();
                  }
                }}
              />
              {addError ? <span className="field__error">{addError}</span> : <span className="field__hint">New documents are saved with Save.</span>}
            </label>
            <button type="button" className="button button--ghost" style={{ marginTop: 22 }} onClick={addDocument}>
              Add
            </button>
          </div>

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
