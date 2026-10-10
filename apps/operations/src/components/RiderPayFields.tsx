import { useCallback, useEffect, useState } from 'react';
import { settings } from '../api/resources';
import type { DistanceMode, PayModel, PayParams, RiderPay } from '../api/types';
import { formatMoney } from '../lib/orders';
import {
  DEFAULT_PAY_PARAMS,
  DISTANCE_MODE_OPTIONS,
  OWN_MODEL_LABEL,
  PAY_MODELS,
  PAY_TYPE_OPTIONS,
  describePay,
  fillDraftBlanks,
  formatPercent,
  type PayDraft,
  type PayDraftErrors,
} from '../lib/riderPay';
import { KmTierEditor, TierModeChoice } from './KmTierEditor';
import './rider-pay.css';

/**
 * Rider type picker (owner, 2026-10-09): Company or Commission, in the app's
 * own segmented control. Used when approving a rider request and when
 * changing a rider's pay.
 *
 * Rider pay controls (owner, 2026-10-10): a commission rider follows the
 * "Store default" model, or has their own % of the delivery fee, fixed LKR
 * per delivery, or distance pay (base + LKR per km), each with an optional
 * minimum per delivery. The numbers start from the store default.
 * Owner, 2026-10-10: distance pay is base + LKR per km, or per-km tiers
 * (km 1, km 2, ... the last repeats; no cap, the minimum still applies).
 */
export function RiderPayFields({
  draft,
  onChange,
  defaults,
  errors = {},
}: {
  draft: PayDraft;
  onChange(next: PayDraft): void;
  /** The store default model, or null while unknown. */
  defaults: PayParams | null;
  errors?: PayDraftErrors;
}) {
  const set = (patch: Partial<PayDraft>) => onChange({ ...draft, ...patch });
  const minHint =
    defaults && typeof defaults.min_lkr === 'number'
      ? `Blank = the store minimum (${formatMoney(defaults.min_lkr)}). Pays at least this per delivery.`
      : 'Blank = no minimum. Pays at least this per delivery.';
  return (
    <div className="rider-pay">
      <div className="field">
        <span className="field__label" id="rider-pay-type-label">
          Rider type
        </span>
        <div className="segmented rider-pay__types" role="group" aria-labelledby="rider-pay-type-label">
          {PAY_TYPE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={option.value === draft.payType ? 'segmented__item is-selected' : 'segmented__item'}
              aria-pressed={option.value === draft.payType}
              onClick={() => set({ payType: option.value })}
            >
              {option.label}
            </button>
          ))}
        </div>
        <span className="field__hint">
          {draft.payType === 'COMPANY'
            ? 'Salaried. No pay per delivery; Blynk keeps the delivery charge.'
            : 'Earns pay per delivery, plus any boosts, and keeps it from the cash they collect.'}
        </span>
      </div>
      {draft.payType === 'COMMISSION' ? (
        <>
          <div className="field">
            <span className="field__label" id="rider-pay-model-label">
              Pay per delivery
            </span>
            <div className="segmented rpay-segmented" role="group" aria-labelledby="rider-pay-model-label">
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
            {draft.model === 'DEFAULT' ? (
              <span className="field__hint" data-testid="pay-default-note">
                Follows the store default{defaults ? `: ${describePay(defaults)}` : ''}. Changes when the default changes (More →
                Rider pay).
              </span>
            ) : null}
          </div>
          {draft.model === 'PERCENT' ? (
            <div className="field">
              <label className="field rpay-label">
                <span className="field__label">Own commission %</span>
                <input
                  className="input"
                  inputMode="decimal"
                  value={draft.percent}
                  onChange={(e) => set({ percent: e.target.value })}
                  aria-invalid={errors.percent ? true : undefined}
                />
              </label>
              <span className="field__hint">
                Share of the standard delivery fee, 0 to 100.
                {defaults ? ` Store default ${formatPercent(defaults.percent)}.` : ''}
              </span>
              {errors.percent ? <span className="field__error-text">{errors.percent}</span> : null}
            </div>
          ) : null}
          {draft.model === 'FIXED' ? (
            <div className="field">
              <label className="field rpay-label">
                <span className="field__label">LKR per delivery</span>
                <input
                  className="input"
                  inputMode="decimal"
                  value={draft.fixed}
                  onChange={(e) => set({ fixed: e.target.value })}
                  aria-invalid={errors.fixed ? true : undefined}
                />
              </label>
              <span className="field__hint">The same amount for every delivery.</span>
              {errors.fixed ? <span className="field__error-text">{errors.fixed}</span> : null}
            </div>
          ) : null}
          {draft.model === 'DISTANCE' ? (
            <div className="field">
              <TierModeChoice<DistanceMode>
                label="Distance pay"
                options={DISTANCE_MODE_OPTIONS}
                value={draft.distanceMode}
                onPick={(mode) => onChange(fillDraftBlanks({ ...draft, distanceMode: mode }, defaults))}
              />
            </div>
          ) : null}
          {draft.model === 'DISTANCE' && draft.distanceMode === 'TIERS' ? (
            <div className="field">
              <KmTierEditor
                label="Pay per km"
                rows={draft.tiers}
                onChange={(tiers) => set({ tiers })}
                rowErrors={errors.tierRows}
                note="Road distance, store to drop-off. No maximum; the minimum below still applies."
              />
              {errors.tiers && !errors.tierRows?.some(Boolean) ? <span className="field__error-text">{errors.tiers}</span> : null}
            </div>
          ) : null}
          {draft.model === 'DISTANCE' && draft.distanceMode !== 'TIERS' ? (
            <div className="rpay-row">
              <div className="field">
                <label className="field rpay-label">
                  <span className="field__label">Base LKR per delivery</span>
                  <input
                    className="input"
                    inputMode="decimal"
                    value={draft.base}
                    onChange={(e) => set({ base: e.target.value })}
                    aria-invalid={errors.base ? true : undefined}
                  />
                </label>
                {errors.base ? <span className="field__error-text">{errors.base}</span> : null}
              </div>
              <div className="field">
                <label className="field rpay-label">
                  <span className="field__label">LKR per km</span>
                  <input
                    className="input"
                    inputMode="decimal"
                    value={draft.perKm}
                    onChange={(e) => set({ perKm: e.target.value })}
                    aria-invalid={errors.perKm ? true : undefined}
                  />
                </label>
                <span className="field__hint">Road distance, store to drop-off.</span>
                {errors.perKm ? <span className="field__error-text">{errors.perKm}</span> : null}
              </div>
            </div>
          ) : null}
          {draft.model !== 'DEFAULT' ? (
            <div className="field">
              <label className="field rpay-label">
                <span className="field__label">Minimum per delivery (LKR, optional)</span>
                <input
                  className="input"
                  inputMode="decimal"
                  value={draft.min}
                  onChange={(e) => set({ min: e.target.value })}
                  aria-invalid={errors.min ? true : undefined}
                />
              </label>
              <span className="field__hint">{minHint}</span>
              {errors.min ? <span className="field__error-text">{errors.min}</span> : null}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/**
 * The store default pay model for prefills, hints and labels (owner,
 * 2026-10-10): GET /admin/settings/rider-pay, or - against an API from
 * before the rider pay controls - only the default % from
 * /admin/settings/rider-commission. Null until loaded (or when neither
 * loads; the screens still work, they just say "default").
 */
export function useRiderPayDefaults(): {
  defaultModel: PayParams | null;
  defaultPercent: number | null;
  /** A full model for prefills (the % alone fills the rest from the contract defaults). */
  defaults: PayParams | null;
  /** Keeps the defaults in step with a pay the API just returned. */
  learn(pay: Pick<RiderPay, 'default_percent'> & Partial<Pick<RiderPay, 'default_model'>>): void;
} {
  const [defaultModel, setDefaultModel] = useState<PayParams | null>(null);
  const [defaultPercent, setDefaultPercent] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    settings.riderPay
      .get()
      .then((s) => {
        if (!s?.default_model) throw new Error('no rider pay settings');
        if (!live) return;
        setDefaultModel(s.default_model);
        setDefaultPercent(s.default_model.percent);
      })
      .catch(() =>
        settings.riderCommission
          .get()
          .then((s) => live && typeof s?.default_percent === 'number' && setDefaultPercent(s.default_percent))
          .catch(() => undefined)
      );
    return () => {
      live = false;
    };
  }, []);
  const learn = useCallback((pay: Pick<RiderPay, 'default_percent'> & Partial<Pick<RiderPay, 'default_model'>>) => {
    if (pay.default_model) {
      setDefaultModel(pay.default_model);
      setDefaultPercent(pay.default_model.percent);
    } else if (typeof pay.default_percent === 'number') setDefaultPercent(pay.default_percent);
  }, []);
  const defaults = defaultModel ?? (defaultPercent === null ? null : { ...DEFAULT_PAY_PARAMS, percent: defaultPercent });
  return { defaultModel, defaultPercent, defaults, learn };
}
