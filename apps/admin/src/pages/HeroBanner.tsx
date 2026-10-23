import { useCallback, useEffect, useMemo, useState } from 'react';
import { categories as categoriesApi, categoryGroups as groupsApi, heroBanner as heroBannerApi, settings as settingsApi } from '../api/resources';
import { referralPoints } from '../api/referralPoints';
import type { Category, CategoryGroup, HeroBannerFields, HeroBannerSetting, HeroBannerSlide } from '../api/types';
import { HeroBannerPreview } from '../components/HeroBannerPreview';
import { PageHeader } from '../components/Layout';
import { Field, Spinner, useToast } from '../components/ui';
import { errorMessage } from '../lib/apiErrors';
import {
  DEFAULT_HERO,
  HERO_ITEMS,
  EMPTY_SLIDE,
  HERO_LIMITS,
  HERO_TIMING,
  HERO_STATUS_TEXT,
  HERO_TOKENS,
  heroPayload,
  HERO_SAMPLE,
  heroPreviewModel,
  heroProblem,
  heroSampleFrom,
  type HeroSample,
  heroStatus,
} from '../lib/heroBanner';
import { fromLocalInput, toLocalInput } from '../lib/promoBand';
import { describeLink, LinkPicker } from './PromoBand';

/**
 * Home banner: the purple hero banner at the top of the customer app's Home
 * (saucer lifting illustrated groceries, two jumping words, a rolling
 * sub-line, ORDER NOW). Automatic by default (the app's own words); Custom
 * sets the words, sub-lines, button and items - with the banner playing live
 * beside the form exactly as the app plays it. Blynk Ops has the same editor.
 */
export function HeroBanner() {
  const toast = useToast();
  const [saved, setSaved] = useState<HeroBannerSetting | null>(null);
  const [draft, setDraft] = useState<HeroBannerFields>(DEFAULT_HERO);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [groups, setGroups] = useState<CategoryGroup[]>([]);
  const [productName, setProductName] = useState<string | null>(null);

  const adopt = useCallback((s: HeroBannerSetting) => {
    setSaved(s);
    setDraft(heroFieldsOf(s));
    setProductName(s.cta_target?.level === 'PRODUCT' ? s.cta_target.name : null);
  }, []);

  useEffect(() => {
    heroBannerApi
      .get()
      .then((s) => {
        adopt(s);
        setLoadError(null);
      })
      .catch((err) => setLoadError(errorMessage(err, 'Could not load the Home banner.')));
    void categoriesApi.listAdmin().then(setCategories).catch(() => setCategories([]));
    void groupsApi
      .list()
      .then((r) => setGroups(r.groups))
      .catch(() => setGroups([]));
  }, [adopt]);

  const set = <K extends keyof HeroBannerFields>(key: K, value: HeroBannerFields[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  // the live Blynk Points / free-delivery switches, so "Automatic" previews what customers see now
  const [sample, setSample] = useState<HeroSample>(HERO_SAMPLE);
  useEffect(() => {
    let alive = true;
    void Promise.allSettled([referralPoints.getPointsSetting(), settingsApi.getCheckout()]).then(([p, c]) => {
      if (!alive) return;
      setSample(heroSampleFrom(p.status === 'fulfilled' ? p.value : null, c.status === 'fulfilled' ? c.value : null));
    });
    return () => {
      alive = false;
    };
  }, []);
  const model = useMemo(() => heroPreviewModel(draft, sample), [draft, sample]);
  const problem = heroProblem(draft);
  const dirty = saved ? JSON.stringify(heroPayload(draft)) !== JSON.stringify(heroPayload(heroFieldsOf(saved))) : false;
  const status = heroStatus(draft);
  const custom = draft.mode === 'CUSTOM';

  async function save(body: HeroBannerFields, message: string) {
    setError(null);
    const issue = heroProblem(body);
    if (issue) {
      setError(issue);
      return;
    }
    setSaving(true);
    try {
      adopt(await heroBannerApi.update(heroPayload(body)));
      toast.success(message);
    } catch (err) {
      setError(errorMessage(err, 'Could not save the Home banner.'));
    } finally {
      setSaving(false);
    }
  }

  if (loadError) {
    return (
      <>
        <PageHeader title="Home banner" />
        <p className="field__error" role="alert">
          {loadError}
        </p>
      </>
    );
  }
  if (!saved) return <Spinner label="Loading the Home banner" />;

  return (
    <>
      <PageHeader
        title="Home banner"
        description="The purple banner at the top of the customer app's Home. Automatic writes its own words; Custom uses yours. Changes reach the app within a minute of saving."
        actions={
          <span className="band-status" data-status={status === 'AUTO' ? 'OFF' : status} data-testid="hero-status">
            {HERO_STATUS_TEXT[status]}
          </span>
        }
      />

      <div className="band-editor">
        <form
          className="band-editor__form"
          onSubmit={(e) => {
            e.preventDefault();
            void save(draft, 'Home banner saved.');
          }}
        >
          <HeroBannerForm
            draft={draft}
            set={set}
            setDraft={setDraft}
            categories={categories}
            groups={groups}
            productName={productName}
            setProductName={setProductName}
          />

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
              onClick={() => void save(DEFAULT_HERO, 'Home banner back to automatic.')}
            >
              Reset to automatic
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
          <HeroBannerPreview
            model={model}
            linkText={custom ? describeLink(draft, saved, categories, groups, productName) : null}
          />
          <p className="preview-note" style={{ marginTop: 6 }}>
            The preview fills the tokens with sample values (cheapest price LKR 253, 2 free deliveries); the app uses the live ones.
          </p>
        </aside>
      </div>
    </>
  );
}

export const heroFieldsOf = (s: HeroBannerSetting): HeroBannerFields => ({
  mode: s.mode,
  title_1: s.title_1,
  title_2: s.title_2,
  lines: s.lines,
  cta_label: s.cta_label,
  cta_destination_type: s.cta_destination_type,
  cta_destination_value: s.cta_destination_value,
  items: s.items,
  slides: s.slides ?? [],
  starts_at: s.starts_at,
  ends_at: s.ends_at,
});

/** The editor's fields (no save bar), so both apps share the same wording and order. */
function HeroBannerForm({
  draft,
  set,
  setDraft,
  categories,
  groups,
  productName,
  setProductName,
}: {
  draft: HeroBannerFields;
  set<K extends keyof HeroBannerFields>(key: K, value: HeroBannerFields[K]): void;
  setDraft(fn: (d: HeroBannerFields) => HeroBannerFields): void;
  categories: Category[];
  groups: CategoryGroup[];
  productName: string | null;
  setProductName(name: string | null): void;
}) {
  const custom = draft.mode === 'CUSTOM';
  const updateLine = (i: number, v: string) => set('lines', draft.lines.map((x, j) => (j === i ? v : x)));
  return (
    <>
      <section className="editor__section">
        <h3 className="editor__legend">Words</h3>
        <div className="hero-mode" role="group" aria-label="Banner words">
          <button type="button" aria-pressed={!custom} onClick={() => set('mode', 'AUTO')}>
            Automatic
          </button>
          <button type="button" aria-pressed={custom} onClick={() => set('mode', 'CUSTOM')}>
            Custom
          </button>
        </div>
        <p className="field__hint">
          {custom
            ? 'Your words below. Outside the schedule (if you set one) the banner goes back to automatic.'
            : 'Automatic: "EARN POINTS" with the points rule while Blynk Points are on, else "FRESH GROCERIES" with two catchy lines underneath - no free-delivery claim or price shown.'}
        </p>
      </section>

      {custom ? (
        <>
          <section className="editor__section">
            <h3 className="editor__legend">Title</h3>
            <p className="field__hint">Two big words that jump letter by letter, shown in capitals. Up to {HERO_LIMITS.titleChars} characters each so they fit every phone.</p>
            <div className="form__row">
              <Field label="First word (white)">
                <input
                  className="input"
                  value={draft.title_1}
                  maxLength={HERO_LIMITS.titleChars}
                  onChange={(e) => set('title_1', e.target.value)}
                  placeholder="e.g. WEEKEND"
                />
              </Field>
              <Field label="Second word (yellow)">
                <input
                  className="input"
                  value={draft.title_2}
                  maxLength={HERO_LIMITS.titleChars}
                  onChange={(e) => set('title_2', e.target.value)}
                  placeholder="e.g. DEALS"
                />
              </Field>
            </div>
          </section>

          <section className="editor__section">
            <h3 className="editor__legend">Sub-lines</h3>
            <p className="field__hint">
              1 to {HERO_LIMITS.lines} short lines that take turns every 3.2 s under the title (up to {HERO_LIMITS.lineChars} characters; long lines are drawn smaller).
            </p>
            <div className="hero-tokens" data-testid="hero-tokens">
              You can use these tokens in a line:
              <ul>
                {HERO_TOKENS.map((t) => (
                  <li key={t.token}>
                    <code>{t.token}</code> - {t.meaning}
                  </li>
                ))}
              </ul>
              A line whose token has no value right now (no free deliveries on, Blynk Points off, or no products) is skipped.
            </div>
            <div className="band-list" style={{ marginTop: 8 }}>
              {draft.lines.map((line, i) => (
                <div className="band-list__row" key={i}>
                  <input
                    className="input"
                    aria-label={`Sub-line ${i + 1}`}
                    value={line}
                    maxLength={HERO_LIMITS.lineChars}
                    placeholder="e.g. Fresh picks, every day"
                    onChange={(e) => updateLine(i, e.target.value)}
                  />
                  <span className="band-count">
                    {line.trim().length}/{HERO_LIMITS.lineChars}
                  </span>
                  <button
                    type="button"
                    className="button button--ghost button--sm"
                    aria-label={`Remove sub-line ${i + 1}`}
                    disabled={draft.lines.length <= 1}
                    onClick={() => set('lines', draft.lines.filter((_, j) => j !== i))}
                  >
                    Remove
                  </button>
                </div>
              ))}
              {draft.lines.length < HERO_LIMITS.lines ? (
                <button
                  type="button"
                  className="button button--ghost button--sm"
                  style={{ alignSelf: 'flex-start' }}
                  onClick={() => set('lines', [...draft.lines, ''])}
                >
                  Add sub-line
                </button>
              ) : (
                <span className="field__hint">That is the most ({HERO_LIMITS.lines}).</span>
              )}
            </div>
          </section>

          <section className="editor__section">
            <h3 className="editor__legend">More slides</h3>
            <p className="field__hint">
              Optional. After the banner above the app moves on to each slide below (about {HERO_TIMING.cycle / 1000} s each), then starts again - e.g. FRESH GROCERIES, then FRESH JUICES, then SNACKS.
              Every slide has its own two words; its sub-line and item are optional (empty = the sub-lines and items above take turns). Up to {HERO_LIMITS.slides} more slides.
            </p>
            <div className="band-list" style={{ marginTop: 8 }}>
              {draft.slides.map((sl, i) => {
                const put = (patch: Partial<HeroBannerSlide>) => set('slides', draft.slides.map((x, j) => (j === i ? { ...x, ...patch } : x)));
                return (
                  <div className="band-list__row" key={i} style={{ flexWrap: 'wrap', gap: 8 }} data-testid="hero-slide">
                    <input className="input" style={{ flex: '1 1 110px' }} aria-label={`Slide ${i + 2} first word`} value={sl.title_1} maxLength={HERO_LIMITS.titleChars} placeholder="FRESH" onChange={(e) => put({ title_1: e.target.value })} />
                    <input className="input" style={{ flex: '1 1 110px' }} aria-label={`Slide ${i + 2} second word`} value={sl.title_2} maxLength={HERO_LIMITS.titleChars} placeholder="JUICES" onChange={(e) => put({ title_2: e.target.value })} />
                    <input className="input" style={{ flex: '2 1 200px' }} aria-label={`Slide ${i + 2} sub-line`} value={sl.line} maxLength={HERO_LIMITS.lineChars} placeholder="Sub-line (optional)" onChange={(e) => put({ line: e.target.value })} />
                    <select className="input" style={{ flex: '1 1 130px' }} aria-label={`Slide ${i + 2} item`} value={sl.item ?? ''} onChange={(e) => put({ item: (e.target.value || null) as HeroBannerSlide['item'] })}>
                      <option value="">Item: as above</option>
                      {HERO_ITEMS.map((it) => (
                        <option key={it.key} value={it.key}>{`${it.emoji} ${it.label}`}</option>
                      ))}
                    </select>
                    <button type="button" className="button button--ghost button--sm" aria-label={`Remove slide ${i + 2}`} onClick={() => set('slides', draft.slides.filter((_, j) => j !== i))}>
                      Remove
                    </button>
                  </div>
                );
              })}
              {draft.slides.length < HERO_LIMITS.slides ? (
                <button type="button" className="button button--ghost button--sm" style={{ alignSelf: 'flex-start' }} onClick={() => set('slides', [...draft.slides, { ...EMPTY_SLIDE }])}>
                  Add slide
                </button>
              ) : (
                <span className="field__hint">That is the most ({HERO_LIMITS.slides}).</span>
              )}
            </div>
          </section>

          <section className="editor__section">
            <h3 className="editor__legend">Button</h3>
            <Field label="Button text" hint={`Up to ${HERO_LIMITS.ctaChars} characters, shown in capitals`}>
              <input
                className="input"
                value={draft.cta_label}
                maxLength={HERO_LIMITS.ctaChars}
                onChange={(e) => set('cta_label', e.target.value)}
              />
            </Field>
            <LinkPicker
              draft={draft}
              categories={categories}
              groups={groups}
              productName={productName}
              label="The button opens"
              noneLabel="Scroll down to the aisles (as today)"
              onChange={(type, value, name) => {
                setDraft((d) => ({ ...d, cta_destination_type: type, cta_destination_value: value }));
                setProductName(name ?? null);
              }}
            />
          </section>

          <section className="editor__section">
            <h3 className="editor__legend">Items in the beam</h3>
            <p className="field__hint">The saucer lifts these one after another (illustrations only). Pick at least one.</p>
            <div className="band-choices" role="group" aria-label="Items in the beam">
              {HERO_ITEMS.map((item) => {
                const on = draft.items.includes(item.key);
                return (
                  <button
                    key={item.key}
                    type="button"
                    className="band-choice"
                    aria-pressed={on}
                    onClick={() =>
                      set(
                        'items',
                        on ? draft.items.filter((k) => k !== item.key) : HERO_ITEMS.map((x) => x.key).filter((k) => k === item.key || draft.items.includes(k))
                      )
                    }
                  >
                    <span className="band-choice__emoji" aria-hidden="true">
                      {item.emoji}
                    </span>
                    {item.label}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="editor__section">
            <h3 className="editor__legend">Schedule</h3>
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
              <Field label="Ends" hint="Optional - after it the banner is automatic again">
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
        </>
      ) : null}
    </>
  );
}
