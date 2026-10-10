import { useEffect, useState, type FormEvent } from 'react';
import { riderDocuments } from '../api/resources';
import type { RiderDocumentType, RiderDocumentTypeInput, VehicleType } from '../api/types';
import { ApiError } from '../api/client';
import { PageHeader } from '../components/Layout';
import { Switch } from '../components/RiderDocuments';
import { Spinner } from '../components/ui';
import { documentErrorMessage, MOTOR_VEHICLES, VEHICLE_TYPES } from '../lib/riderDocuments';
import { formatDateTime } from '../lib/inventory';
import '../components/rider-documents.css';

/**
 * Settings -> Rider documents (owner, 2026-10-10: "give all the options to
 * control to ops and admin"). Which documents a new rider uploads, who must
 * have them verified before approval (per vehicle type), whether a document
 * needs an expiry date or a front and back page, and custom documents.
 * Saved in one PUT; the backend validates and audits every change.
 */

const MAX_CUSTOM = 10;
const LABEL_MIN = 2;
const LABEL_MAX = 80;

/** A row being edited; `tempId` names a new custom document until it is saved. */
interface Draft extends Omit<RiderDocumentType, 'key'> {
  key?: string;
  tempId: string;
}

let nextTemp = 0;
const toDraft = (d: RiderDocumentType): Draft => ({ ...d, tempId: d.key });

function toInput(d: Draft): RiderDocumentTypeInput {
  return {
    ...(d.key ? { key: d.key } : {}),
    ...(d.builtin ? {} : { label: d.label.trim() }),
    enabled: d.enabled,
    required_for: d.required_for,
    needs_expiry: d.needs_expiry,
    needs_back: d.needs_back,
  };
}

/** `documents.4.label` -> { 4: 'message' } (validation details from the API). */
function fieldErrors(err: unknown): Record<number, string> {
  const out: Record<number, string> = {};
  if (!(err instanceof ApiError) || !Array.isArray(err.details)) return out;
  for (const d of err.details as Array<{ field?: string; message?: string }>) {
    const match = /^documents\.(\d+)/.exec(d.field ?? '');
    if (match && d.message && out[Number(match[1])] === undefined) out[Number(match[1])] = d.message;
  }
  return out;
}

export function RiderDocumentSettings() {
  const [list, setList] = useState<Draft[] | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<number, string>>({});
  const [newLabel, setNewLabel] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    riderDocuments.settings
      .get()
      .then((s) => {
        if (!live) return;
        setList(s.documents.map(toDraft));
        setUpdatedAt(s.updated_at);
      })
      .catch((err) => live && setLoadError(documentErrorMessage(err, 'Could not load the rider document settings.')));
    return () => {
      live = false;
    };
  }, []);

  function change(tempId: string, patch: Partial<Draft>) {
    setNotice(null);
    setList((rows) => (rows ?? []).map((d) => (d.tempId === tempId ? { ...d, ...patch } : d)));
  }

  function toggleVehicle(d: Draft, v: VehicleType) {
    const has = d.required_for.includes(v);
    const next = has ? d.required_for.filter((x) => x !== v) : [...d.required_for, v];
    // Keep the API's vehicle order so the saved list reads the same every time.
    change(d.tempId, { required_for: VEHICLE_TYPES.map((t) => t.id).filter((id) => next.includes(id)) });
  }

  function add(e: FormEvent) {
    e.preventDefault();
    const label = newLabel.trim();
    if (label.length < LABEL_MIN || label.length > LABEL_MAX) {
      setAddError(`Use ${LABEL_MIN} to ${LABEL_MAX} characters.`);
      return;
    }
    const rows = list ?? [];
    if (rows.some((d) => d.label.trim().toLowerCase() === label.toLowerCase())) {
      setAddError('A document with this name is already in the list.');
      return;
    }
    setAddError(null);
    setNotice(null);
    nextTemp += 1;
    setList([
      ...rows,
      {
        tempId: `new-${nextTemp}`,
        label,
        builtin: false,
        enabled: true,
        required_for: [],
        needs_expiry: false,
        needs_back: false,
      },
    ]);
    setNewLabel('');
  }

  async function save() {
    if (!list) return;
    setError(null);
    setNotice(null);
    setRowErrors({});
    const bad: Record<number, string> = {};
    list.forEach((d, i) => {
      const n = d.label.trim().length;
      if (!d.builtin && (n < LABEL_MIN || n > LABEL_MAX)) bad[i] = `Use ${LABEL_MIN} to ${LABEL_MAX} characters for the name.`;
    });
    if (Object.keys(bad).length > 0) {
      setRowErrors(bad);
      setError('Check the highlighted documents.');
      return;
    }
    setSaving(true);
    try {
      const saved = await riderDocuments.settings.update(list.map(toInput));
      setList(saved.documents.map(toDraft));
      setUpdatedAt(saved.updated_at);
      setNotice('Rider documents saved. New applications follow these settings.');
    } catch (err) {
      setRowErrors(fieldErrors(err));
      setError(documentErrorMessage(err, 'Could not save the rider document settings.'));
    } finally {
      setSaving(false);
    }
  }

  const customCount = (list ?? []).filter((d) => !d.builtin).length;

  return (
    <div className="page">
      <PageHeader
        title="Rider documents"
        description="What new riders upload, and what Ops or Admin must verify before a rider is approved."
      />

      {loadError ? (
        <p className="field__error" role="alert">
          {loadError}
        </p>
      ) : null}
      {!list && !loadError ? <Spinner label="Loading rider document settings" /> : null}

      {list ? (
        <>
          <ul className="rdoc-settings" aria-label="Rider documents">
            {list.map((d, i) => {
              const required = d.required_for.length > 0;
              const name = d.label || 'New document';
              return (
                <li key={d.tempId} className={`rdoc-type${d.enabled ? '' : ' is-off'}`} aria-label={name}>
                  <div className="rdoc-type__head">
                    {d.builtin ? (
                      <p className="rdoc-type__name">
                        {d.label}
                        <span className="rdoc-type__tag">Built in</span>
                      </p>
                    ) : (
                      <label className="field rdoc-type__label-field">
                        <span className="field__label">Document name</span>
                        <input
                          className="input"
                          value={d.label}
                          maxLength={LABEL_MAX}
                          onChange={(e) => change(d.tempId, { label: e.target.value })}
                        />
                      </label>
                    )}
                    {d.builtin ? (
                      <Switch label={`Shown in the app: ${d.label}`} checked={d.enabled} onToggle={() => change(d.tempId, { enabled: !d.enabled })} />
                    ) : (
                      <button
                        type="button"
                        className="button button--sm button--ghost"
                        aria-label={`Remove ${name}`}
                        onClick={() => {
                          setNotice(null);
                          setList((rows) => (rows ?? []).filter((x) => x.tempId !== d.tempId));
                        }}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                  {d.builtin && !d.enabled ? (
                    <p className="quiet">Hidden: riders are not asked for it.</p>
                  ) : null}
                  <div className="rdoc-type__body">
                    <div className="rdoc-switch-row">
                      <span>
                        Required
                        <em>{required ? 'Must be verified before approval.' : 'Optional for every vehicle.'}</em>
                      </span>
                      <Switch
                        label={`Required: ${name}`}
                        checked={required}
                        onToggle={() => change(d.tempId, { required_for: required ? [] : [...MOTOR_VEHICLES] })}
                      />
                    </div>
                    <div className="specialty-chips" role="group" aria-label={`Required for: ${name}`}>
                      {VEHICLE_TYPES.map((v) => {
                        const on = d.required_for.includes(v.id);
                        return (
                          <button
                            key={v.id}
                            type="button"
                            className={on ? 'specialty-chip is-selected' : 'specialty-chip'}
                            aria-pressed={on}
                            onClick={() => toggleVehicle(d, v.id)}
                          >
                            {v.text}
                          </button>
                        );
                      })}
                    </div>
                    <div className="rdoc-switch-row">
                      <span>
                        Needs expiry date
                        <em>Staff enter the date when verifying; riders are warned before it runs out.</em>
                      </span>
                      <Switch
                        label={`Needs expiry date: ${name}`}
                        checked={d.needs_expiry}
                        onToggle={() => change(d.tempId, { needs_expiry: !d.needs_expiry })}
                      />
                    </div>
                    <div className="rdoc-switch-row">
                      <span>
                        Front and back
                        <em>The rider uploads both sides.</em>
                      </span>
                      <Switch
                        label={`Front and back: ${name}`}
                        checked={d.needs_back}
                        onToggle={() => change(d.tempId, { needs_back: !d.needs_back })}
                      />
                    </div>
                  </div>
                  {rowErrors[i] ? <p className="field__error-text">{rowErrors[i]}</p> : null}
                </li>
              );
            })}
          </ul>

          <form className="card" onSubmit={add} noValidate>
            <h2 className="section-label">Add a document</h2>
            <div className="rdoc-add">
              <label className="field">
                <span className="field__label">Name</span>
                <input
                  className="input"
                  value={newLabel}
                  maxLength={LABEL_MAX}
                  placeholder="e.g. Police report"
                  disabled={customCount >= MAX_CUSTOM}
                  onChange={(e) => {
                    setNewLabel(e.target.value);
                    setAddError(null);
                  }}
                />
              </label>
              <button type="submit" className="button" disabled={customCount >= MAX_CUSTOM}>
                Add
              </button>
            </div>
            {addError ? <p className="field__error-text">{addError}</p> : null}
            <p className="quiet">
              {customCount >= MAX_CUSTOM
                ? `You have the most custom documents (${MAX_CUSTOM}). Remove one to add another.`
                : 'Added documents are optional until you mark them required. Save to apply.'}
            </p>
          </form>

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
          {updatedAt ? <p className="quiet">Last changed {formatDateTime(updatedAt)}</p> : null}
          <button type="button" className="primary" disabled={saving} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save rider documents'}
          </button>
        </>
      ) : null}
    </div>
  );
}
