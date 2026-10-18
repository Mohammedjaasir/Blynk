import { useCallback, useEffect, useMemo, useState } from 'react';
import { deleteImagesQuietly } from '../../api/client';
import { catalog, settings } from '../../api/resources';
import type { Category, CategoryGroup, PromoBandFields, PromoBandSetting, PromotionTarget } from '../../api/types';
import { ImageUploader } from '../../components/ImageUploader';
import { PageHeader } from '../../components/Layout';
import { PromoBandPreview } from '../../components/PromoBandPreview';
import { Switch } from '../../components/RiderDocuments';
import { Field, Spinner } from '../../components/ui';
import { catalogErrorMessage, categoryOptions } from '../../lib/catalog';
import { replacedImages } from '../../lib/image';
import {
  BAND_BACKGROUND_KEYS,
  BAND_BACKGROUNDS,
  BAND_ILLUSTRATIONS,
  BAND_LIMITS,
  BAND_MASCOTS,
  BAND_STATUS_TEXT,
  BAND_TEXT_COLORS,
  BAND_TEXT_KEYS,
  DEFAULT_BAND,
  autoTextColor,
  bandPayload,
  bandPreviewModel,
  bandProblem,
  bandStatus,
  fromLocalInput,
  readable,
  toLocalInput,
} from '../../lib/promoBand';
import { TargetProductPicker } from './Promotions';

/**
 * Home promo band (owner, 2026-10-14: "make sure promotional banner edit
 * option like this animation in the ops and admin"). The animated yellow
 * band after the third aisle in the customer app: its sliding headlines,
 * ticked points, colours, the item in the light beam, the rider mascot, a
 * link and an optional schedule - with the band playing live beside the
 * form exactly as the app plays it. Admin has the same editor
 * (apps/admin/src/pages/PromoBand.tsx); this is Blynk Ops' own copy.
 */
export function PromoBand() {
  const [notice, setNotice] = useState<string | null>(null);
  const [saved, setSaved] = useState<PromoBandSetting | null>(null);
  const [draft, setDraft] = useState<PromoBandFields>(DEFAULT_BAND);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [groups, setGroups] = useState<CategoryGroup[]>([]);
  const [productName, setProductName] = useState<string | null>(null);

  const adopt = useCallback((s: PromoBandSetting) => {
    setSaved(s);
    setDraft(fieldsOf(s));
    setProductName(s.cta_target?.level === 'PRODUCT' ? s.cta_target.name : null);
  }, []);

  useEffect(() => {
    settings.promoBand
      .get()
      .then((s) => {
        adopt(s);
        setLoadError(null);
      })
      .catch((err) => setLoadError(catalogErrorMessage(err)));
    void catalog.categories.list().then(setCategories).catch(() => setCategories([]));
    void catalog.categoryGroups
      .list()
      .then((r) => setGroups(r.groups ?? []))
      .catch(() => setGroups([]));
  }, [adopt]);

  const set = <K extends keyof PromoBandFields>(key: K, value: PromoBandFields[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const model = useMemo(() => bandPreviewModel(draft), [draft]);
  const problem = bandProblem(draft);
  const dirty = saved ? JSON.stringify(bandPayload(draft)) !== JSON.stringify(bandPayload(fieldsOf(saved))) : false;
  const status = bandStatus(draft);

  async function save(body: PromoBandFields, message: string) {
    setError(null);
    setNotice(null);
    const issue = bandProblem(body);
    if (issue) {
      setError(issue);
      return;
    }
    setSaving(true);
    try {
      const before = saved?.item_image_url;
      const next = await settings.promoBand.update(bandPayload(body));
      // Saved: a replaced item image is safe to delete now.
      void deleteImagesQuietly(replacedImages([before], [next.item_image_url]));
      adopt(next);
      setNotice(message);
    } catch (err) {
      setError(catalogErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  if (loadError) {
    return (
      <div className="page">
        <PageHeader title="Promo band" />
        <p className="field__error" role="alert">
          {loadError}
        </p>
      </div>
    );
  }
  if (!saved) return <Spinner label="Loading the promo band" />;

  return (
    <div className="page">
      <PageHeader
        title="Promo band"
        description="The animated yellow band after the third aisle on the customer app's Home. Changes reach the app within a minute of saving."
        actions={
          <span className="band-status" data-status={status} data-testid="band-status">
            {BAND_STATUS_TEXT[status]}
          </span>
        }
      />
      {notice ? (
        <p className="form__note" role="status">
          {notice}
        </p>
      ) : null}

      <div className="band-editor">
        <form
          className="band-editor__form"
          onSubmit={(e) => {
            e.preventDefault();
            void save(draft, 'Promo band saved.');
          }}
        >
          <section className="editor__section">
            <h3 className="editor__legend">Show</h3>
            <span className="band-switch-row">
              <Switch checked={draft.enabled} onToggle={() => set('enabled', !draft.enabled)} label="Show the promo band on Home" />
              <span aria-hidden="true">Show the promo band on Home</span>
            </span>
            <div className="form__row">
              <Field label="Starts" hint="Optional - leave empty to start straight away">
                <input
                  className="input"
                  type="datetime-local"
                  aria-label="Starts"
                  value={toLocalInput(draft.starts_at)}
                  onChange={(e) => set('starts_at', fromLocalInput(e.target.value))}
                />
              </Field>
              <Field label="Ends" hint="Optional - leave empty to keep it running">
                <input
                  className="input"
                  type="datetime-local"
                  aria-label="Ends"
                  value={toLocalInput(draft.ends_at)}
                  onChange={(e) => set('ends_at', fromLocalInput(e.target.value))}
                />
              </Field>
            </div>
          </section>

          <section className="editor__section">
            <h3 className="editor__legend">Headlines</h3>
            <p className="field__hint">
              They slide in one after another, 2.8 s each. Leave empty to keep the app&apos;s own line (&quot;Handpicked
              fresh, every single day&quot;).
            </p>
            <TextList
              items={draft.lines}
              max={BAND_LIMITS.lines}
              maxChars={BAND_LIMITS.lineChars}
              noun="headline"
              placeholder="e.g. Fresh bread every morning"
              onChange={(v) => set('lines', v)}
            />
          </section>

          <section className="editor__section">
            <h3 className="editor__legend">Ticked points</h3>
            <p className="field__hint">Short facts with a tick, side by side. Leave empty for "Quality checked", "Local favourites".</p>
            <TextList
              items={draft.ticks}
              max={BAND_LIMITS.ticks}
              maxChars={BAND_LIMITS.tickChars}
              noun="ticked point"
              placeholder="e.g. Quality checked"
              onChange={(v) => set('ticks', v)}
            />
          </section>

          <section className="editor__section">
            <h3 className="editor__legend">Colours</h3>
            <span className="field__label">Background</span>
            <div className="band-swatches" role="group" aria-label="Background">
              {BAND_BACKGROUND_KEYS.map((key) => {
                const bg = BAND_BACKGROUNDS[key];
                return (
                  <button
                    key={key}
                    type="button"
                    className="band-swatch"
                    aria-pressed={draft.background === key}
                    onClick={() =>
                      setDraft((d) => ({
                        ...d,
                        background: key,
                        // a colour that is unreadable on the new background goes back to automatic
                        text_color: d.text_color && !readable(key, d.text_color) ? null : d.text_color,
                      }))
                    }
                  >
                    <span className="band-swatch__chip" style={{ background: `linear-gradient(${bg.start}, ${bg.end})` }} />
                    {bg.label}
                  </button>
                );
              })}
            </div>
            <span className="field__label" style={{ marginTop: 12 }}>
              Text
            </span>
            <div className="band-swatches" role="group" aria-label="Text colour">
              <button
                type="button"
                className="band-swatch"
                aria-pressed={draft.text_color === null}
                onClick={() => set('text_color', null)}
              >
                <span
                  className="band-swatch__chip"
                  style={{
                    background: BAND_BACKGROUNDS[draft.background].start,
                    color: BAND_TEXT_COLORS[autoTextColor(draft.background)].hex,
                  }}
                >
                  Aa
                </span>
                Automatic
              </button>
              {BAND_TEXT_KEYS.map((key) => {
                const ok = readable(draft.background, key);
                return (
                  <button
                    key={key}
                    type="button"
                    className="band-swatch"
                    aria-pressed={draft.text_color === key}
                    disabled={!ok}
                    title={ok ? undefined : 'Too hard to read on this background'}
                    onClick={() => set('text_color', key)}
                  >
                    <span
                      className="band-swatch__chip"
                      style={{ background: BAND_BACKGROUNDS[draft.background].start, color: BAND_TEXT_COLORS[key].hex }}
                    >
                      Aa
                    </span>
                    {BAND_TEXT_COLORS[key].label}
                  </button>
                );
              })}
            </div>
            <span className="field__hint">Only colours that stay easy to read on the background can be picked.</span>
          </section>

          <section className="editor__section">
            <h3 className="editor__legend">Item in the light beam</h3>
            <div className="band-choices" role="group" aria-label="Item kind">
              {(
                [
                  ['NONE', 'No item'],
                  ['ILLUSTRATED', 'Illustrated item'],
                  ['IMAGE', 'Your image'],
                ] as const
              ).map(([kind, text]) => (
                <button
                  key={kind}
                  type="button"
                  className="band-choice"
                  aria-pressed={draft.item_kind === kind}
                  onClick={() => set('item_kind', kind)}
                >
                  {text}
                </button>
              ))}
            </div>
            {draft.item_kind === 'ILLUSTRATED' ? (
              <div className="band-choices" role="group" aria-label="Illustrated item" style={{ marginTop: 10 }}>
                {BAND_ILLUSTRATIONS.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    className="band-choice"
                    aria-pressed={draft.item_illustration === item.key}
                    onClick={() => set('item_illustration', item.key)}
                  >
                    <span className="band-choice__emoji" aria-hidden="true">
                      {item.emoji}
                    </span>
                    {item.label}
                  </button>
                ))}
              </div>
            ) : null}
            {draft.item_kind === 'IMAGE' ? (
              <div style={{ marginTop: 10 }}>
                <ImageUploader
                  value={draft.item_image_url}
                  folder="promotions"
                  label="Item image (a cut-out PNG on a transparent background looks best)"
                  onChange={(url) => set('item_image_url', url)}
                />
              </div>
            ) : null}
          </section>

          <section className="editor__section">
            <h3 className="editor__legend">Mascot</h3>
            <div className="band-choices" role="group" aria-label="Mascot">
              {BAND_MASCOTS.map((m) => (
                <button
                  key={m.key}
                  type="button"
                  className="band-choice band-choice--wide"
                  aria-pressed={draft.mascot === m.key}
                  onClick={() => set('mascot', m.key)}
                >
                  <strong>{m.label}</strong>
                  <em>{m.hint}</em>
                </button>
              ))}
            </div>
          </section>

          <section className="editor__section">
            <h3 className="editor__legend">When tapped</h3>
            <LinkPicker
              draft={draft}
              categories={categories}
              groups={groups}
              productName={productName}
              onChange={(type, value, name) => {
                setDraft((d) => ({ ...d, cta_destination_type: type, cta_destination_value: value }));
                setProductName(name ?? null);
              }}
            />
          </section>

          {error || problem ? (
            <p className="field__error" role="alert">
              {error ?? problem}
            </p>
          ) : null}

          <div className="band-save-bar">
            <button
              type="button"
              className="button button--ghost"
              disabled={saving}
              onClick={() => void save({ ...DEFAULT_BAND, item_image_url: draft.item_image_url }, 'Promo band back to the app default.')}
            >
              Restore app default
            </button>
            <button type="button" className="button button--ghost" disabled={!dirty || saving} onClick={() => adopt(saved)}>
              Discard changes
            </button>
            <button type="submit" className="button" disabled={!dirty || saving || !!problem}>
              {saving ? <Spinner label="Saving" /> : 'Save'}
            </button>
          </div>
        </form>

        <aside className="band-editor__preview" aria-label="Live preview">
          <h3 className="editor__legend">Live preview</h3>
          <PromoBandPreview model={model} linkText={describeLink(draft, saved, categories, groups, productName)} />
        </aside>
      </div>
    </div>
  );
}

const fieldsOf = (s: PromoBandSetting): PromoBandFields => ({
  enabled: s.enabled,
  lines: s.lines,
  ticks: s.ticks,
  background: s.background,
  text_color: s.text_color,
  item_kind: s.item_kind,
  item_illustration: s.item_illustration,
  item_image_url: s.item_image_url,
  mascot: s.mascot,
  cta_destination_type: s.cta_destination_type,
  cta_destination_value: s.cta_destination_value,
  starts_at: s.starts_at,
  ends_at: s.ends_at,
});

/** An editable list of short lines (headlines / ticked points). */
function TextList({
  items,
  max,
  maxChars,
  noun,
  placeholder,
  onChange,
}: {
  items: string[];
  max: number;
  maxChars: number;
  noun: string;
  placeholder: string;
  onChange(next: string[]): void;
}) {
  const update = (i: number, v: string) => onChange(items.map((x, j) => (j === i ? v : x)));
  const move = (i: number, d: -1 | 1) => {
    const next = [...items];
    const [x] = next.splice(i, 1);
    next.splice(i + d, 0, x!);
    onChange(next);
  };
  return (
    <div className="band-list">
      {items.map((item, i) => (
        <div className="band-list__row" key={i}>
          <input
            className="input"
            aria-label={`${noun[0]!.toUpperCase()}${noun.slice(1)} ${i + 1}`}
            value={item}
            maxLength={maxChars}
            placeholder={placeholder}
            onChange={(e) => update(i, e.target.value)}
          />
          <span className="band-count">
            {item.trim().length}/{maxChars}
          </span>
          <button
            type="button"
            className="button button--ghost button--sm"
            aria-label={`Move ${noun} ${i + 1} up`}
            disabled={i === 0}
            onClick={() => move(i, -1)}
          >
            ↑
          </button>
          <button
            type="button"
            className="button button--ghost button--sm"
            aria-label={`Move ${noun} ${i + 1} down`}
            disabled={i === items.length - 1}
            onClick={() => move(i, 1)}
          >
            ↓
          </button>
          <button
            type="button"
            className="button button--ghost button--sm"
            aria-label={`Remove ${noun} ${i + 1}`}
            onClick={() => onChange(items.filter((_, j) => j !== i))}
          >
            Remove
          </button>
        </div>
      ))}
      {items.length < max ? (
        <button type="button" className="button button--ghost button--sm" style={{ alignSelf: 'flex-start' }} onClick={() => onChange([...items, ''])}>
          Add {noun}
        </button>
      ) : (
        <span className="field__hint">
          That is the most ({max}).
        </span>
      )}
    </div>
  );
}

/** The link fields a promo surface stores (promo band, hero banner). */
type LinkFields = Pick<PromoBandFields, 'cta_destination_type' | 'cta_destination_value'>;
type LinkKind = '' | 'ALL' | 'MAIN' | 'CATEGORY' | 'PRODUCT';
const linkKindOf = (d: LinkFields): LinkKind =>
  d.cta_destination_type === 'CATALOG'
    ? d.cta_destination_value
      ? 'MAIN'
      : 'ALL'
    : d.cta_destination_type === 'CATEGORY'
      ? 'CATEGORY'
      : d.cta_destination_type === 'PRODUCT'
        ? 'PRODUCT'
        : '';

/**
 * Where a tap goes: the same levels as a promotion (Main / Category / Sub-category / Product /
 * whole catalog). Shared with the hero banner editor.
 */
export function LinkPicker({
  draft,
  categories,
  groups,
  productName,
  onChange,
  label = 'The band opens',
  noneLabel = 'Nothing (informational)',
}: {
  draft: LinkFields;
  label?: string;
  noneLabel?: string;
  categories: Category[];
  groups: CategoryGroup[];
  productName: string | null;
  onChange(type: PromoBandFields['cta_destination_type'], value: string | null, name?: string | null): void;
}) {
  const kind = linkKindOf(draft);
  const value = draft.cta_destination_value ?? '';
  return (
    <>
      <Field label={label}>
        <select
          className="input"
          value={kind}
          onChange={(e) => {
            const k = e.target.value as LinkKind;
            onChange(k === 'ALL' || k === 'MAIN' ? 'CATALOG' : k === '' ? null : k, null);
          }}
        >
          <option value="">{noneLabel}</option>
          <option value="ALL">Whole catalog (all products)</option>
          <option value="MAIN">A main section (home heading)</option>
          <option value="CATEGORY">A category or sub-category</option>
          <option value="PRODUCT">A product</option>
        </select>
      </Field>
      {kind === 'MAIN' ? (
        <Field label="Main section">
          <select className="input" value={value} onChange={(e) => onChange('CATALOG', e.target.value || null)}>
            <option value="">Select a main section</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
                {g.is_active ? '' : ' (hidden)'}
              </option>
            ))}
          </select>
        </Field>
      ) : null}
      {kind === 'CATEGORY' ? (
        <Field label="Category or sub-category" hint="A sub-category opens its category">
          <select className="input" value={value} onChange={(e) => onChange('CATEGORY', e.target.value || null)}>
            <option value="">Select a category</option>
            {categoryOptions(categories).map((option) => (
              <option key={option.id} value={option.slug}>
                {option.label}
                {option.isActive ? '' : ' (off)'}
              </option>
            ))}
          </select>
        </Field>
      ) : null}
      {kind === 'PRODUCT' ? (
        <TargetProductPicker
          selectedId={value || null}
          selectedName={productName}
          onPick={(product) => onChange('PRODUCT', product?.id ?? null, product?.name ?? null)}
        />
      ) : null}
    </>
  );
}

/** "the category Rice" etc. for the preview note; null = no link. Shared with the hero banner editor. */
export function describeLink(
  d: LinkFields,
  saved: LinkFields & { cta_target: PromotionTarget | null },
  categories: Category[],
  groups: CategoryGroup[],
  productName: string | null
): string | null {
  const savedTarget: PromotionTarget | null =
    saved.cta_destination_type === d.cta_destination_type && saved.cta_destination_value === d.cta_destination_value
      ? saved.cta_target
      : null;
  switch (d.cta_destination_type) {
    case 'CATALOG': {
      if (!d.cta_destination_value) return 'the whole catalog';
      const g = groups.find((x) => x.id === d.cta_destination_value);
      return `the main section ${g?.name ?? savedTarget?.name ?? ''}`.trim();
    }
    case 'CATEGORY': {
      if (!d.cta_destination_value) return null;
      const option = categoryOptions(categories).find((x) => x.slug === d.cta_destination_value);
      const name = option?.label ?? savedTarget?.name ?? d.cta_destination_value;
      return `${option?.parentId || savedTarget?.level === 'SUB_CATEGORY' ? 'the sub-category' : 'the category'} ${name}`;
    }
    case 'PRODUCT':
      return d.cta_destination_value ? `the product ${productName ?? savedTarget?.name ?? ''}`.trim() : null;
    default:
      return null;
  }
}
