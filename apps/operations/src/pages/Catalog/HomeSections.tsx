import { useCallback, useEffect, useState } from 'react';
import { catalog, settings } from '../../api/resources';
import type { Category } from '../../api/types';
import { Badge, Field, Spinner } from '../../components/ui';
import { PageHeader } from '../../components/Layout';
import { Switch } from '../../components/RiderDocuments';
import { catalogErrorMessage, categoryOptions } from '../../lib/catalog';
import {
  HOME_SECTIONS_LIMITS,
  STATUS_WORDS,
  blankDraft,
  countdownText,
  draftFrom,
  fromLocalInput,
  moveItem,
  scheduleText,
  sectionProblem,
  sectionStatus,
  sectionsPayload,
  sectionsProblem,
  toLocalInput,
  type HomeSectionDraft,
  type HomeSectionStatus,
  type HomeSectionsSetting,
} from '../../lib/homeSections';
import { TargetProductPicker } from './Promotions';

/**
 * Home sections (owner's brother, 2026-10-24: "if we need snacks, if we need juices to come, and
 * showcase timely offers also with a countdown timer"). Staff add their own product rails to the
 * customer app's Home: a category's products or up to 12 picked ones, optionally between a start
 * and an end time (Sri Lanka time) with a live countdown to the end. The order here is the order
 * on Home. Admin has the same page (apps/admin/src/pages/HomeSections.tsx); this is Blynk Ops' own copy.
 */
const TONE: Record<HomeSectionStatus, 'active' | 'inactive' | 'muted'> = { LIVE: 'active', SCHEDULED: 'muted', ENDED: 'muted', OFF: 'inactive' };

const TOUCH = { minHeight: 44, minWidth: 44 } as const;

/** What the rail header will look like in the app; the countdown ticks like it does there. */
function RailPreview({ draft }: { draft: HomeSectionDraft }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!draft.show_countdown || !draft.ends_at) return;
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, [draft.show_countdown, draft.ends_at]);
  const countdown = draft.show_countdown ? countdownText(draft.ends_at, now) : '';
  return (
    <div className="field" aria-label="Preview of the rail header">
      <span className="field__label">Preview</span>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', padding: '10px 12px', border: '1px solid var(--line, #e3e6ec)', borderRadius: 12 }}>
        <span>
          <strong data-testid="preview-title">{draft.title.trim() || 'Section title'}</strong>
          {draft.subtitle?.trim() ? (
            <>
              <br />
              <span className="field__hint">{draft.subtitle.trim()}</span>
            </>
          ) : null}
        </span>
        {countdown ? (
          <span data-testid="preview-countdown" style={{ background: '#ffd84d', color: '#14161a', borderRadius: 999, padding: '4px 10px', fontWeight: 600, fontSize: 13 }}>
            {countdown}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function SectionEditor({
  draft,
  categories,
  onChange,
}: {
  draft: HomeSectionDraft;
  categories: Category[];
  onChange(change: Partial<HomeSectionDraft>): void;
}) {
  const options = categoryOptions(categories);
  const ids = draft.source.kind === 'PRODUCTS' ? draft.source.product_ids : [];
  const full = ids.length >= HOME_SECTIONS_LIMITS.products;
  return (
    <div className="editor__section" style={{ marginTop: 8 }}>
      <div className="form__row">
        <Field label="Title" hint={`${draft.title.trim().length}/${HOME_SECTIONS_LIMITS.title.max}`}>
          <input className="input" aria-label="Title" maxLength={HOME_SECTIONS_LIMITS.title.max} value={draft.title} placeholder="Fresh juices" onChange={(e) => onChange({ title: e.target.value })} />
        </Field>
        <Field label="Subtitle (optional)" hint={`${(draft.subtitle ?? '').length}/${HOME_SECTIONS_LIMITS.subtitle}`}>
          <input
            className="input"
            aria-label="Subtitle"
            maxLength={HOME_SECTIONS_LIMITS.subtitle}
            value={draft.subtitle ?? ''}
            placeholder="Cold and ready until 6 pm"
            onChange={(e) => onChange({ subtitle: e.target.value || null })}
          />
        </Field>
      </div>

      <Field label="Products">
        <select
          className="input"
          aria-label="Products come from"
          value={draft.source.kind}
          onChange={(e) =>
            onChange(
              e.target.value === 'CATEGORY'
                ? { source: { kind: 'CATEGORY', category_id: '' }, products: [], source_name: '' }
                : { source: { kind: 'PRODUCTS', product_ids: [] }, products: [], source_name: '0 products' }
            )
          }
        >
          <option value="CATEGORY">A category</option>
          <option value="PRODUCTS">Products I pick</option>
        </select>
      </Field>

      {draft.source.kind === 'CATEGORY' ? (
        <>
          <Field label="Category" hint="Its products and its sub-categories' products">
            <select
              className="input"
              aria-label="Category"
              value={draft.source.category_id}
              onChange={(e) => {
                const opt = options.find((o) => o.id === e.target.value);
                onChange({ source: { kind: 'CATEGORY', category_id: e.target.value }, source_name: opt?.label ?? '' });
              }}
            >
              <option value="">Select a category</option>
              {options.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                  {option.isActive ? '' : ' (off)'}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Products shown" hint={`${HOME_SECTIONS_LIMITS.maxItems.min} to ${HOME_SECTIONS_LIMITS.maxItems.max}`}>
            <input
              className="input"
              type="number"
              inputMode="numeric"
              aria-label="Products shown"
              min={HOME_SECTIONS_LIMITS.maxItems.min}
              max={HOME_SECTIONS_LIMITS.maxItems.max}
              value={draft.max_items}
              onChange={(e) => onChange({ max_items: Number(e.target.value) })}
            />
          </Field>
        </>
      ) : (
        <>
          <p className="field__hint" aria-live="polite">
            {ids.length} of {HOME_SECTIONS_LIMITS.products} picked. They show in this order.
          </p>
          <div className="band-list">
            {draft.products.map((p, i) => (
              <div className="band-list__row" key={p.id} style={{ flexWrap: 'wrap', gap: 8 }} data-testid="picked-product">
                <span style={{ flex: '1 1 160px' }}>{p.name}</span>
                <button
                  type="button"
                  className="button button--ghost button--sm"
                  style={TOUCH}
                  aria-label={`Move ${p.name} up`}
                  disabled={i === 0}
                  onClick={() => onChange({ products: moveItem(draft.products, i, -1), source: { kind: 'PRODUCTS', product_ids: moveItem(ids, i, -1) } })}
                >
                  Up
                </button>
                <button
                  type="button"
                  className="button button--ghost button--sm"
                  style={TOUCH}
                  aria-label={`Move ${p.name} down`}
                  disabled={i === draft.products.length - 1}
                  onClick={() => onChange({ products: moveItem(draft.products, i, 1), source: { kind: 'PRODUCTS', product_ids: moveItem(ids, i, 1) } })}
                >
                  Down
                </button>
                <button
                  type="button"
                  className="button button--ghost button--sm"
                  style={TOUCH}
                  aria-label={`Remove ${p.name} from the section`}
                  onClick={() => {
                    const products = draft.products.filter((x) => x.id !== p.id);
                    onChange({ products, source: { kind: 'PRODUCTS', product_ids: ids.filter((x) => x !== p.id) }, source_name: `${products.length} ${products.length === 1 ? 'product' : 'products'}` });
                  }}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
          {full ? (
            <p className="form__note">That is the most a section can hold. Remove one to add another.</p>
          ) : (
            <TargetProductPicker
              selectedId={null}
              selectedName={null}
              onPick={(product) => {
                if (!product || ids.includes(product.id)) return;
                const products = [...draft.products, { id: product.id, name: product.name }];
                onChange({ products, source: { kind: 'PRODUCTS', product_ids: [...ids, product.id] }, source_name: `${products.length} ${products.length === 1 ? 'product' : 'products'}` });
              }}
            />
          )}
        </>
      )}

      <p className="card__row">
        <Switch checked={draft.is_active} onToggle={() => onChange({ is_active: !draft.is_active })} label="Show this section on Home" />
        <span>Show this section on Home</span>
      </p>
      <div className="form__row">
        <Field label="Starts" hint="Optional - empty means straight away (Sri Lanka time)">
          <input className="input" type="datetime-local" aria-label="Starts" value={toLocalInput(draft.starts_at)} onChange={(e) => onChange({ starts_at: fromLocalInput(e.target.value) })} />
        </Field>
        <Field label="Ends" hint="Optional - empty means it stays on (Sri Lanka time)">
          <input className="input" type="datetime-local" aria-label="Ends" value={toLocalInput(draft.ends_at)} onChange={(e) => onChange({ ends_at: fromLocalInput(e.target.value) })} />
        </Field>
      </div>
      <p className="card__row">
        <Switch checked={draft.show_countdown} onToggle={() => onChange({ show_countdown: !draft.show_countdown })} label="Show a countdown to the end" />
        <span>Show a countdown to the end</span>
      </p>
      {draft.show_countdown && !draft.ends_at ? <p className="field__hint">Set an end time for the countdown.</p> : null}

      <RailPreview draft={draft} />
    </div>
  );
}

export function HomeSections() {
  const [notice, setNotice] = useState<string | null>(null);
  const [saved, setSaved] = useState<HomeSectionsSetting | null>(null);
  const [rows, setRows] = useState<HomeSectionDraft[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const adopt = useCallback((s: HomeSectionsSetting) => {
    setSaved(s);
    setRows(s.sections.map(draftFrom));
    setEditing(null);
  }, []);

  useEffect(() => {
    settings.homeSections
      .get()
      .then((s) => {
        adopt(s);
        setLoadError(null);
      })
      .catch((err) => setLoadError(catalogErrorMessage(err)));
    void catalog.categories.list().then(setCategories).catch(() => setCategories([]));
  }, [adopt]);

  const dirty = saved ? JSON.stringify(sectionsPayload(rows)) !== JSON.stringify(sectionsPayload(saved.sections)) : false;
  const problem = sectionsProblem(rows);

  const patch = (key: string, change: Partial<HomeSectionDraft>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...change } : r)));

  function add() {
    const draft = blankDraft();
    setRows((rs) => [...rs, draft]);
    setEditing(draft.key);
  }

  async function save() {
    setError(null);
    setNotice(null);
    if (problem) return;
    setSaving(true);
    try {
      adopt(await settings.homeSections.update(sectionsPayload(rows)));
      setNotice('Home sections saved.');
    } catch (err) {
      setError(catalogErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  if (loadError) {
    return (
      <>
        <PageHeader title="Home sections" />
        <p className="field__error" role="alert">
          {loadError}
        </p>
      </>
    );
  }
  if (!saved) return <Spinner label="Loading the home sections" />;

  const now = new Date();
  return (
    <>
      <PageHeader
        title="Home sections"
        description="Add your own product rows to the app's Home, such as Snacks, Juices or Weekend offers. A row can start and end at a time and show a live countdown. The order here is the order on Home."
      />

      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <section className="editor__section">
          <h3 className="editor__legend">On Home, top to bottom</h3>
          {rows.length === 0 ? <p className="form__note">No sections yet. Add one to put a row of products on Home.</p> : null}
          <div className="band-list">
            {rows.map((r, i) => {
              const status = sectionStatus(r, now);
              const label = r.title.trim() || 'New section';
              return (
                <div key={r.key} data-testid="home-section-row" style={{ border: '1px solid var(--line, #e3e6ec)', borderRadius: 12, padding: 10 }}>
                  <div className="band-list__row" style={{ flexWrap: 'wrap', gap: 8 }}>
                    <span style={{ flex: '2 1 200px' }}>
                      <strong>{label}</strong> <Badge tone={TONE[status]}>{STATUS_WORDS[status]}</Badge>
                      <br />
                      <span className="field__hint">
                        {r.source_name || 'No products chosen yet'} · {scheduleText(r)}
                        {r.show_countdown && r.ends_at ? ' · countdown' : ''}
                      </span>
                    </span>
                    <button type="button" className="button button--ghost button--sm" style={TOUCH} aria-label={`Move ${label} up`} disabled={i === 0} onClick={() => setRows((rs) => moveItem(rs, i, -1))}>
                      Up
                    </button>
                    <button type="button" className="button button--ghost button--sm" style={TOUCH} aria-label={`Move ${label} down`} disabled={i === rows.length - 1} onClick={() => setRows((rs) => moveItem(rs, i, 1))}>
                      Down
                    </button>
                    <button type="button" className="button button--ghost button--sm" style={TOUCH} aria-label={`${editing === r.key ? 'Close' : 'Edit'} ${label}`} aria-expanded={editing === r.key} onClick={() => setEditing(editing === r.key ? null : r.key)}>
                      {editing === r.key ? 'Close' : 'Edit'}
                    </button>
                    <button
                      type="button"
                      className="button button--ghost button--sm"
                      style={TOUCH}
                      aria-label={`Remove ${label}`}
                      onClick={() => {
                        setRows((rs) => rs.filter((x) => x.key !== r.key));
                        if (editing === r.key) setEditing(null);
                      }}
                    >
                      Remove
                    </button>
                  </div>
                  {editing === r.key ? <SectionEditor draft={r} categories={categories} onChange={(change) => patch(r.key, change)} /> : null}
                  {editing !== r.key && sectionProblem(r) ? (
                    <p className="field__error" style={{ marginTop: 6 }}>
                      {sectionProblem(r)}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
          <button type="button" className="button button--ghost" style={{ marginTop: 8, ...TOUCH }} disabled={rows.length >= HOME_SECTIONS_LIMITS.sections} onClick={add}>
            Add a section
          </button>
          {rows.length >= HOME_SECTIONS_LIMITS.sections ? <p className="field__hint">That is the most Home can hold ({HOME_SECTIONS_LIMITS.sections}).</p> : null}
        </section>

        {error || problem ? (
          <p className="field__error" role="alert">
            {error ?? problem}
          </p>
        ) : null}
        {notice ? (
          <p className="form__note" role="status">
            {notice}
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
