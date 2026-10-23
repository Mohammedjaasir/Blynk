import { useCallback, useEffect, useState } from 'react';
import { catalog, settings } from '../../api/resources';
import type { Category } from '../../api/types';
import { PageHeader } from '../../components/Layout';
import { Field, Spinner } from '../../components/ui';
import { catalogErrorMessage, categoryOptions } from '../../lib/catalog';
import {
  isOpenNow,
  windowLabel,
  windowProblem,
  windowsPayload,
  windowText,
  type AvailabilityKind,
  type AvailabilitySetting,
  type AvailabilityView,
} from '../../lib/availability';
import { TargetProductPicker } from './Promotions';

/**
 * Available hours (owner, 2026-10-23: "some product that I want to add time-based ... for example
 * juices from the morning till six, because the shop closes around 8 ... the timing will be
 * different"). Pick a product or a whole category and the hours it can be ordered (Colombo time).
 * Outside them the customer app shows it greyed with its hours and nothing can be added; a
 * product's own hours win over its category's. Admin has the same page (apps/admin/src/pages/AvailableHours.tsx); this is Blynk Ops' own copy.
 */
export function AvailableHours() {
  const [notice, setNotice] = useState<string | null>(null);
  const [saved, setSaved] = useState<AvailabilitySetting | null>(null);
  const [rows, setRows] = useState<AvailabilityView[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // the add form
  const [kind, setKind] = useState<AvailabilityKind>('PRODUCT');
  const [pickId, setPickId] = useState('');
  const [pickName, setPickName] = useState<string | null>(null);
  const [pickParent, setPickParent] = useState<string | null>(null);
  const [from, setFrom] = useState('06:00');
  const [until, setUntil] = useState('18:00');
  const [addError, setAddError] = useState<string | null>(null);

  const adopt = useCallback((s: AvailabilitySetting) => {
    setSaved(s);
    setRows(s.windows);
  }, []);

  useEffect(() => {
    settings.availabilityWindows
      .get()
      .then((s) => {
        adopt(s);
        setLoadError(null);
      })
      .catch((err) => setLoadError(catalogErrorMessage(err)));
    void catalog.categories.list().then(setCategories).catch(() => setCategories([]));
  }, [adopt]);

  const dirty = saved ? JSON.stringify(windowsPayload(rows)) !== JSON.stringify(windowsPayload(saved.windows)) : false;
  const problem = rows.map((r) => windowProblem(r)).find((p) => p) ?? null;

  const patch = (i: number, change: Partial<AvailabilityView>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...change } : r)));

  function add() {
    setAddError(null);
    if (!pickId) return setAddError(kind === 'PRODUCT' ? 'Choose a product.' : 'Choose a category.');
    const p = windowProblem({ from, until });
    if (p) return setAddError(p);
    if (rows.some((r) => r.kind === kind && r.id === pickId)) return setAddError('That one is already on the list. Change its times below.');
    setRows((rs) => [...rs, { kind, id: pickId, from, until, name: pickName ?? '', parent_name: pickParent, open_now: isOpenNow({ from, until }) }]);
    setPickId('');
    setPickName(null);
    setPickParent(null);
  }

  async function save() {
    setError(null);
    setNotice(null);
    if (problem) return;
    setSaving(true);
    try {
      adopt(await settings.availabilityWindows.update(windowsPayload(rows)));
      setNotice('Available hours saved.');
    } catch (err) {
      setError(catalogErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  if (loadError) {
    return (
      <>
        <PageHeader title="Available hours" />
        <p className="field__error" role="alert">
          {loadError}
        </p>
      </>
    );
  }
  if (!saved) return <Spinner label="Loading the available hours" />;

  return (
    <>
      <PageHeader
        title="Available hours"
        description="Make a product, or a whole category, orderable only between two times of day (Sri Lanka time), e.g. juices 6 am to 6 pm. Outside them the app shows it greyed with its hours and it cannot be added to the cart."
      />

      <section className="editor__section">
        <h3 className="editor__legend">Add</h3>
        <div className="form__row">
          <Field label="What">
            <select
              className="input"
              value={kind}
              onChange={(e) => {
                setKind(e.target.value as AvailabilityKind);
                setPickId('');
                setPickName(null);
                setPickParent(null);
              }}
            >
              <option value="PRODUCT">A product</option>
              <option value="CATEGORY">A whole category</option>
            </select>
          </Field>
          <Field label="From">
            <input className="input" type="time" aria-label="From" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="Until" hint="Later than From, or past midnight">
            <input className="input" type="time" aria-label="Until" value={until} onChange={(e) => setUntil(e.target.value)} />
          </Field>
        </div>
        {kind === 'PRODUCT' ? (
          <TargetProductPicker
            selectedId={pickId || null}
            selectedName={pickName}
            onPick={(product) => {
              setPickId(product?.id ?? '');
              setPickName(product?.name ?? null);
              setPickParent(null);
            }}
          />
        ) : (
          <Field label="Category or sub-category" hint="A main category covers its sub-categories too">
            <select
              className="input"
              value={pickId}
              onChange={(e) => {
                const cat = categories.find((c) => c.id === e.target.value);
                setPickId(e.target.value);
                setPickName(cat?.name ?? null);
                setPickParent(categories.find((c) => c.id === cat?.parent_id)?.name ?? null);
              }}
            >
              <option value="">Select a category</option>
              {categoryOptions(categories).map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                  {option.isActive ? '' : ' (off)'}
                </option>
              ))}
            </select>
          </Field>
        )}
        {addError ? (
          <p className="field__error" role="alert">
            {addError}
          </p>
        ) : null}
        <button type="button" className="button button--ghost" style={{ marginTop: 8 }} onClick={add}>
          Add to the list
        </button>
      </section>

      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <section className="editor__section">
          <h3 className="editor__legend">On the list</h3>
          {rows.length === 0 ? <p className="form__note">Nothing is limited yet: every product can be ordered whenever the shop is open.</p> : null}
          <div className="band-list">
            {rows.map((r, i) => (
              <div className="band-list__row" key={`${r.kind}:${r.id}`} style={{ flexWrap: 'wrap', gap: 8 }} data-testid="hours-row">
                <span style={{ flex: '2 1 200px' }}>
                  <strong>{windowLabel(r)}</strong>
                  <br />
                  <span className="field__hint">
                    {r.kind === 'PRODUCT' ? 'Product' : 'Category'} · {windowText(r)} · {isOpenNow(r) ? 'orderable now' : 'greyed out now'}
                  </span>
                </span>
                <input className="input" style={{ flex: '1 1 110px' }} type="time" aria-label={`${windowLabel(r)} from`} value={r.from} onChange={(e) => patch(i, { from: e.target.value })} />
                <input className="input" style={{ flex: '1 1 110px' }} type="time" aria-label={`${windowLabel(r)} until`} value={r.until} onChange={(e) => patch(i, { until: e.target.value })} />
                <button type="button" className="button button--ghost button--sm" aria-label={`Remove ${windowLabel(r)}`} onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>
                  Remove
                </button>
              </div>
            ))}
          </div>
        </section>

        {notice ? (
          <p className="form__note" role="status">
            {notice}
          </p>
        ) : null}
        {error || problem ? (
          <p className="field__error" role="alert">
            {error ?? problem}
          </p>
        ) : null}
        <div className="band-save-bar">
          <button type="button" className="button button--ghost" disabled={!dirty || saving} onClick={() => saved && adopt(saved)}>
            Discard changes
          </button>
          <button type="submit" className="button" disabled={!dirty || saving || !!problem}>
            {saving ? <Spinner label="Saving" /> : 'Save'}
          </button>
        </div>
      </form>
    </>
  );
}
