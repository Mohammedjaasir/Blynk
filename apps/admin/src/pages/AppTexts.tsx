import { useCallback, useEffect, useState } from 'react';
import { appTexts as appTextsApi, categories as categoriesApi } from '../api/resources';
import type { Category } from '../api/types';
import { PageHeader } from '../components/Layout';
import { Field, Spinner, useToast } from '../components/ui';
import { errorMessage } from '../lib/apiErrors';
import {
  APP_COLORS,
  APP_TEXT_LISTS,
  APP_TEXT_SECTIONS,
  appTextsFieldsOf,
  appTextsPayload,
  appTextsProblem,
  EMPTY_APP_TEXTS,
  UNDER_AMOUNT,
  type AppTextKey,
  type AppTextsFields,
  type AppTextsSetting,
} from '../lib/appTexts';
import { TextList } from './PromoBand';

/**
 * App texts (owner, 2026-10-18: "make sure each and everything was editable from the admin"):
 * the customer app's words that are not the Home banner or the promo band - Home headings and
 * aisle-card lines, the cart header and strip, order placed, the login headlines, the "Pay
 * online" note - plus the "Under LKR" amount and a colour per aisle card. A blank field keeps
 * the app's own words (shown greyed in it). Blynk Ops has the same page.
 */
export function AppTexts() {
  const toast = useToast();
  const [saved, setSaved] = useState<AppTextsSetting | null>(null);
  const [draft, setDraft] = useState<AppTextsFields>(EMPTY_APP_TEXTS);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [aisles, setAisles] = useState<Category[]>([]);

  const adopt = useCallback((s: AppTextsSetting) => {
    setSaved(s);
    setDraft(appTextsFieldsOf(s));
  }, []);

  useEffect(() => {
    appTextsApi
      .get()
      .then((s) => {
        adopt(s);
        setLoadError(null);
      })
      .catch((err) => setLoadError(errorMessage(err, 'Could not load the app texts.')));
    void categoriesApi
      .listAdmin()
      .then((cs) => setAisles(cs.filter((c) => !c.parent_id && c.is_active).sort((a, b) => a.display_order - b.display_order)))
      .catch(() => setAisles([]));
  }, [adopt]);

  const problem = appTextsProblem(draft);
  const dirty = saved ? JSON.stringify(appTextsPayload(draft)) !== JSON.stringify(appTextsPayload(appTextsFieldsOf(saved))) : false;

  async function save(body: AppTextsFields, message: string) {
    setError(null);
    const issue = appTextsProblem(body);
    if (issue) {
      setError(issue);
      return;
    }
    setSaving(true);
    try {
      adopt(await appTextsApi.update(appTextsPayload(body)));
      toast.success(message);
    } catch (err) {
      setError(errorMessage(err, 'Could not save the app texts.'));
    } finally {
      setSaving(false);
    }
  }

  if (loadError) {
    return (
      <>
        <PageHeader title="App texts" />
        <p className="field__error" role="alert">
          {loadError}
        </p>
      </>
    );
  }
  if (!saved) return <Spinner label="Loading the app texts" />;

  return (
    <>
      <PageHeader
        title="App texts"
        description="The customer app's own words and colours. Leave a field blank to keep the app's own (shown in grey). The Home banner's words and the promo band have their own pages. Changes reach the app within a minute of saving."
      />
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          void save(draft, 'App texts saved.');
        }}
      >
        <AppTextsForm draft={draft} setDraft={setDraft} aisles={aisles} />

        {error || problem ? (
          <p className="field__error" role="alert">
            {error ?? problem}
          </p>
        ) : null}

        <div className="form__actions">
          <button
            type="button"
            className="button button--ghost"
            disabled={saving}
            onClick={() => void save(EMPTY_APP_TEXTS, "App texts back to the app's own words.")}
          >
            Reset all to the app&apos;s own
          </button>
          <button type="button" className="button button--ghost" disabled={!dirty || saving} onClick={() => adopt(saved)}>
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

/** The surface colours (owner, 2026-10-18: "even colors also editable"); words on them turn dark or white to stay readable. */
function ColorsSection({ draft, setDraft }: { draft: AppTextsFields; setDraft: (f: (d: AppTextsFields) => AppTextsFields) => void }) {
  return (
    <section className="form__section" aria-label="Colours">
      <h2 className="form__section-title">Colours</h2>
      <p className="form__note">
        The colours of the app&apos;s main surfaces. Words on them switch between dark and white so they stay readable. The promo band
        has its own colours on its page.
      </p>
      {APP_COLORS.map((c) => {
        const value = draft[c.key];
        return (
          <div className="form__row" key={c.key} style={{ alignItems: 'center' }}>
            <span style={{ minWidth: 260 }}>{c.label}</span>
            <input
              type="color"
              aria-label={`${c.label} colour`}
              value={value || c.builtIn}
              onChange={(e) => setDraft((d) => ({ ...d, [c.key]: e.target.value.toUpperCase() }))}
            />
            <span className="field__hint">{value || `App's own (${c.builtIn})`}</span>
            {value ? (
              <button type="button" className="button button--ghost button--sm" onClick={() => setDraft((d) => ({ ...d, [c.key]: '' }))}>
                Use the app&apos;s own
              </button>
            ) : null}
          </div>
        );
      })}
    </section>
  );
}

/** The fields, shared wording and order with Blynk Ops. */
export function AppTextsForm({
  draft,
  setDraft,
  aisles,
}: {
  draft: AppTextsFields;
  setDraft: (f: (d: AppTextsFields) => AppTextsFields) => void;
  aisles: Category[];
}) {
  const setText = (k: AppTextKey, v: string) => setDraft((d) => ({ ...d, [k]: v }));
  const lists = APP_TEXT_LISTS;
  return (
    <>
      {APP_TEXT_SECTIONS.map((s) => (
        <section className="form__section" key={s.title} aria-label={s.title}>
          <h2 className="form__section-title">{s.title}</h2>
          <p className="form__note">{s.note}</p>
          {s.title === 'Home' ? (
            <Field label='"Under LKR" amount' hint={`Home's price rail and its filter chip. Blank = ${UNDER_AMOUNT.builtIn}.`}>
              <input
                className="input"
                inputMode="numeric"
                placeholder={String(UNDER_AMOUNT.builtIn)}
                value={draft.home_under_amount ?? ''}
                onChange={(e) => {
                  const t = e.target.value.trim();
                  setDraft((d) => ({ ...d, home_under_amount: t === '' ? null : Number(t) }));
                }}
              />
            </Field>
          ) : null}
          {s.fields.map((f) => (
            <Field key={f.key} label={f.label} hint={f.hint ?? `Blank = "${f.builtIn}"`}>
              <input
                className="input"
                aria-label={f.label}
                value={draft[f.key]}
                maxLength={f.max}
                placeholder={f.builtIn}
                onChange={(e) => setText(f.key, e.target.value)}
              />
            </Field>
          ))}
          {s.title === 'Home' ? (
            <div>
              <h3 className="editor__legend">{lists.home_aisle_lines.label}</h3>
              <p className="field__hint">{lists.home_aisle_lines.note}</p>
              <TextList
                items={draft.home_aisle_lines}
                max={lists.home_aisle_lines.max}
                maxChars={lists.home_aisle_lines.chars}
                noun="aisle line"
                placeholder={lists.home_aisle_lines.builtIn[0]}
                onChange={(v) => setDraft((d) => ({ ...d, home_aisle_lines: v }))}
              />
            </div>
          ) : null}
        </section>
      ))}

      <section className="form__section" aria-label="Login">
        <h2 className="form__section-title">Login</h2>
        <p className="field__hint">{lists.login_headlines.note}</p>
        <TextList
          items={draft.login_headlines}
          max={lists.login_headlines.max}
          maxChars={lists.login_headlines.chars}
          noun="login headline"
          placeholder={lists.login_headlines.builtIn[0]}
          onChange={(v) => setDraft((d) => ({ ...d, login_headlines: v }))}
        />
      </section>

      <ColorsSection draft={draft} setDraft={setDraft} />

      <section className="form__section" aria-label="Aisle colours">
        <h2 className="form__section-title">Aisle card colours</h2>
        <p className="form__note">The background of each aisle card on Home. Not set = the app picks a soft colour for the category.</p>
        {aisles.length === 0 ? <p className="form__note">No active main categories yet.</p> : null}
        {aisles.map((c) => {
          const color = draft.aisle_colors[c.id];
          return (
            <div className="form__row" key={c.id} style={{ alignItems: 'center' }}>
              <span style={{ minWidth: 180 }}>{c.name}</span>
              <input
                type="color"
                aria-label={`${c.name} colour`}
                value={color ?? '#F7F7F9'}
                onChange={(e) => setDraft((d) => ({ ...d, aisle_colors: { ...d.aisle_colors, [c.id]: e.target.value.toUpperCase() } }))}
              />
              <span className="field__hint">{color ?? "App's own"}</span>
              {color ? (
                <button
                  type="button"
                  className="button button--ghost button--sm"
                  onClick={() =>
                    setDraft((d) => {
                      const next = { ...d.aisle_colors };
                      delete next[c.id];
                      return { ...d, aisle_colors: next };
                    })
                  }
                >
                  Use the app&apos;s own
                </button>
              ) : null}
            </div>
          );
        })}
      </section>
    </>
  );
}
