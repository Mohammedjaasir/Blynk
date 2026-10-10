import { useCallback, useEffect, useId, useState } from 'react';
import { settings as settingsApi } from '../api/resources';
import type { PayModel, PayParams, RiderPay, RiderPayType } from '../api/types';
import {
  DEFAULT_PAY_PARAMS,
  DISTANCE_MODE_OPTIONS,
  OWN_MODEL_LABEL,
  PAY_MODELS,
  PAY_TYPE_LABEL,
  describePay,
  fillDraftBlanks,
  formatPercent,
  linearTierDrafts,
  type PayDraft,
  type PayDraftErrors,
} from '../lib/riderPay';
import { formatMoney } from '../lib/orders';
import { KmTierEditor, ModeChoice } from './KmTierEditor';
import { Field } from './ui';
import './riderPay.css';

/**
 * Rider type (Company / Commission) as the site's segmented control and, for
 * a commission rider, how they are paid per delivery. Shared by the approve
 * dialog on Rider requests and "Change pay" on Rider earnings
 * (owner, 2026-10-09).
 *
 * Rider pay controls (owner, 2026-10-10): a commission rider follows the
 * "Store default" model, or has their own % of the delivery fee, fixed LKR
 * per delivery, or distance pay (base + LKR per km), each with an optional
 * minimum per delivery. The numbers start from the store default. Distance
 * pay can use per-km tiers instead (owner, 2026-10-10).
 */
export function RiderPayFields({
  draft,
  defaults,
  errors = {},
  onChange,
}: {
  draft: PayDraft;
  /** The store default model; null until loaded (or when it cannot load). */
  defaults: PayParams | null;
  errors?: PayDraftErrors;
  onChange(next: PayDraft): void;
}) {
  const typeLabelId = useId();
  const modelLabelId = useId();
  const set = (patch: Partial<PayDraft>) => onChange({ ...draft, ...patch });
  const minHint =
    defaults && typeof defaults.min_lkr === 'number'
      ? `Blank = the store minimum, ${formatMoney(defaults.min_lkr)}.`
      : 'Blank = the store minimum (none now).';
  return (
    <>
      <div className="field">
        <span className="field__label" id={typeLabelId}>
          Rider type
        </span>
        <div className="segmented" role="group" aria-labelledby={typeLabelId}>
          {(['COMPANY', 'COMMISSION'] as RiderPayType[]).map((option) => (
            <button
              key={option}
              type="button"
              className={option === draft.payType ? 'segmented__item is-selected' : 'segmented__item'}
              aria-pressed={option === draft.payType}
              onClick={() => set({ payType: option })}
            >
              {PAY_TYPE_LABEL[option]}
            </button>
          ))}
        </div>
      </div>
      {draft.payType === 'COMMISSION' ? (
        <>
          <div className="field">
            <span className="field__label" id={modelLabelId}>
              Pay per delivery
            </span>
            <div className="segmented segmented--wrap" role="group" aria-labelledby={modelLabelId}>
              {(['DEFAULT', ...PAY_MODELS] as PayDraft['model'][]).map((option) => (
                <button
                  key={option}
                  type="button"
                  className={option === draft.model ? 'segmented__item is-selected' : 'segmented__item'}
                  aria-pressed={option === draft.model}
                  onClick={() => onChange(fillDraftBlanks({ ...draft, model: option }, defaults))}
                >
                  {option === 'DEFAULT' ? 'Store default' : OWN_MODEL_LABEL[option as PayModel]}
                </button>
              ))}
            </div>
          </div>
          {draft.model === 'DEFAULT' ? (
            <p className="form__note" data-testid="pay-default-note">
              Follows the store default{defaults ? `: ${describePay(defaults)}` : ''}. It changes when the default changes
              (Settings, Rider pay).
            </p>
          ) : null}
          {draft.model === 'PERCENT' ? (
            <Field
              label="Own commission (%)"
              hint={`Share of the standard delivery fee. 0 to 100, up to 2 decimals.${
                defaults ? ` Store default ${formatPercent(defaults.percent)}%.` : ''
              }`}
              error={errors.percent}
            >
              <input
                className="input"
                inputMode="decimal"
                value={draft.percent}
                onChange={(e) => set({ percent: e.target.value })}
              />
            </Field>
          ) : null}
          {draft.model === 'FIXED' ? (
            <Field label="LKR per delivery" hint="The same amount for every delivery." error={errors.fixed}>
              <input className="input" inputMode="decimal" value={draft.fixed} onChange={(e) => set({ fixed: e.target.value })} />
            </Field>
          ) : null}
          {draft.model === 'DISTANCE' ? (
            <>
              {/* Base + per km, or per-km tiers (owner, 2026-10-10). */}
              <ModeChoice
                label="Distance pay"
                value={draft.distanceMode ?? 'LINEAR'}
                options={DISTANCE_MODE_OPTIONS}
                onChange={(mode) =>
                  set({
                    distanceMode: mode,
                    tiers: draft.tiers?.some((t) => t.trim() !== '') ? draft.tiers : linearTierDrafts(draft.base, draft.perKm),
                  })
                }
              />
              {draft.distanceMode === 'TIERS' ? (
                <>
                  <KmTierEditor
                    label="Pay for each km"
                    drafts={draft.tiers ?? ['']}
                    onChange={(tiers) => set({ tiers })}
                    errors={errors.tiers}
                  />
                  <p className="form__note">Road distance, store to drop-off. The minimum below still applies.</p>
                </>
              ) : (
                <div className="form__row">
                  <Field label="Base LKR per delivery" error={errors.base}>
                    <input className="input" inputMode="decimal" value={draft.base} onChange={(e) => set({ base: e.target.value })} />
                  </Field>
                  <Field label="LKR per km" hint="Road distance, store to drop-off." error={errors.perKm}>
                    <input className="input" inputMode="decimal" value={draft.perKm} onChange={(e) => set({ perKm: e.target.value })} />
                  </Field>
                </div>
              )}
            </>
          ) : null}
          {draft.model !== 'DEFAULT' ? (
            <Field label="Minimum per delivery (LKR, optional)" hint={minHint} error={errors.min}>
              <input className="input" inputMode="decimal" value={draft.min} onChange={(e) => set({ min: e.target.value })} />
            </Field>
          ) : null}
        </>
      ) : null}
      <p className="form__note">
        {draft.payType === 'COMMISSION'
          ? 'Earns this on each delivery, plus any boosts, and keeps it out of the cash collected; hands in the rest.'
          : 'Salaried. No per-delivery pay; Blynk keeps the delivery charge and the rider hands in all cash collected.'}
      </p>
    </>
  );
}

/**
 * The store default pay model for prefills, hints and labels (owner,
 * 2026-10-10): GET /admin/settings/rider-pay, or - against an API from
 * before the rider pay controls - only the default % from
 * /admin/settings/rider-commission. Both null until loaded (or when neither
 * loads; the pages still work, they just say "default").
 */
export function useRiderPayDefaults(): {
  defaultModel: PayParams | null;
  defaultPercent: number | null;
  /** The store default as a full model for prefills (the % alone fills the rest from the contract defaults). */
  defaults: PayParams | null;
  /** Keeps the defaults in step with a pay the API just returned. */
  learn(pay: Pick<RiderPay, 'default_percent'> & Partial<Pick<RiderPay, 'default_model'>>): void;
} {
  const [defaultModel, setDefaultModel] = useState<PayParams | null>(null);
  const [defaultPercent, setDefaultPercent] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    settingsApi
      .getRiderPay()
      .then((s) => {
        if (!live || !s?.default_model) throw new Error('no rider pay settings');
        setDefaultModel(s.default_model);
        setDefaultPercent(s.default_model.percent);
      })
      .catch(() =>
        settingsApi
          .getRiderCommission()
          .then((s) => live && typeof s?.default_percent === 'number' && setDefaultPercent(s.default_percent))
          .catch(() => undefined)
      );
    return () => {
      live = false;
    };
  }, []);
  const learn = useCallback((pay: Pick<RiderPay, 'default_percent'> & Partial<Pick<RiderPay, 'default_model'>>) => {
    if (pay.default_model) setDefaultModel(pay.default_model);
    if (typeof pay.default_percent === 'number') setDefaultPercent(pay.default_percent);
  }, []);
  const defaults = defaultModel ?? (defaultPercent === null ? null : { ...DEFAULT_PAY_PARAMS, percent: defaultPercent });
  return { defaultModel, defaultPercent, defaults, learn };
}
