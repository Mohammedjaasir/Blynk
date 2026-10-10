import type {
  AdjustmentReason,
  BonusKind,
  BoostMode,
  DistanceMode,
  PayModel,
  PayParams,
  RiderPay,
  RiderPayInput,
  RiderPayType,
} from '../api/types';
import { linearToRows, parseTierRows, tiersSummary, tiersToRows } from './kmTiers';
import { formatMoney } from './orders';

/**
 * Rider pay helpers (owner, 2026-10-09): a COMPANY rider is salaried - no
 * per-delivery commission, Blynk keeps the delivery charge. A COMMISSION
 * rider earns a % of the STANDARD delivery fee (the store default, or their
 * own %) and keeps that share out of the COD cash they collect.
 */

export const PAY_TYPE_OPTIONS: { value: RiderPayType; label: string }[] = [
  { value: 'COMPANY', label: 'Company' },
  { value: 'COMMISSION', label: 'Commission' },
];

/** 80 -> "80%", 72.5 -> "72.5%", 66.67 -> "66.67%". */
export function formatPercent(value: number): string {
  return `${Number(value.toFixed(2))}%`;
}

/**
 * "Company", or "Commission · 80%" - the rider's own % when set, otherwise
 * the store default when known (marked "default").
 */
export function payLabel(
  payType: RiderPayType | undefined,
  ownPercent: number | null | undefined,
  defaultPercent: number | null
): string {
  if (payType !== 'COMMISSION') return 'Company';
  if (ownPercent != null) return `Commission · ${formatPercent(ownPercent)}`;
  return defaultPercent != null ? `Commission · ${formatPercent(defaultPercent)} (default)` : 'Commission · default %';
}

/**
 * The optional own % typed for a commission rider: blank = the store
 * default (null); otherwise 0-100 with at most 2 decimals, as the API takes.
 */
export function parseOwnPercent(input: string): { value: number | null } | { error: string } {
  const s = input.trim();
  if (s === '') return { value: null };
  return parseCommissionPercent(s);
}

/** A required % 0-100, at most 2 decimals (the default commission setting). */
export function parseCommissionPercent(input: string): { value: number } | { error: string } {
  const s = input.trim();
  if (s === '') return { error: 'Enter a percentage from 0 to 100.' };
  if (!/^\d+(\.\d+)?$/.test(s)) return { error: 'Enter a number, like 80 or 72.5.' };
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return { error: 'Use at most 2 decimals.' };
  const value = Number(s);
  if (value > 100) return { error: 'The percentage can be at most 100.' };
  return { value };
}

// ---------------------------------------------------------------------------
// Rider pay controls (owner, 2026-10-10: "give the option in ops and admin to
// control the rider app charges"). A commission rider's base pay per delivery
// is one of three models - % of the delivery fee, a fixed LKR, or distance
// (base + LKR per km, or per-km tiers - owner, 2026-10-10) - with an optional minimum, plus automatic boosts
// (peak, rain, daily target, long distance). Deductions and extra pay are
// adjustments, kept from that day's cash. Fresh implementation for Ops (not
// an import from Admin - common.md rule 2).
// ---------------------------------------------------------------------------

/** Store default model choices on the Rider pay page. */
export const PAY_MODEL_LABEL: Record<PayModel, string> = {
  PERCENT: '% of delivery fee',
  FIXED: 'Fixed per delivery',
  DISTANCE: 'Distance',
};

/** Shorter labels for a rider's own model in the pay dialog. */
export const OWN_MODEL_LABEL: Record<PayModel, string> = {
  PERCENT: '% of fee',
  FIXED: 'Fixed',
  DISTANCE: 'Distance',
};

export const PAY_MODELS: PayModel[] = ['PERCENT', 'FIXED', 'DISTANCE'];

export const BOOST_MODE_LABEL: Record<BoostMode, string> = {
  FIXED: '+LKR per delivery',
  PERCENT: '+% of base pay',
};

export const ADJUSTMENT_REASONS: AdjustmentReason[] = ['CASH_SHORT', 'DAMAGED_ITEM', 'LATE', 'BONUS', 'OTHER'];

export const ADJUSTMENT_REASON_LABEL: Record<AdjustmentReason, string> = {
  CASH_SHORT: 'Cash short',
  DAMAGED_ITEM: 'Damaged item',
  LATE: 'Late',
  BONUS: 'Bonus',
  OTHER: 'Other',
};

export const BONUS_KINDS: BonusKind[] = ['PEAK_BOOST', 'RAIN_BOOST', 'LONG_DISTANCE', 'DAILY_TARGET'];

export const BONUS_KIND_LABEL: Record<BonusKind, string> = {
  PEAK_BOOST: 'Peak boost',
  RAIN_BOOST: 'Rain boost',
  LONG_DISTANCE: 'Long distance',
  DAILY_TARGET: 'Daily target',
};

/** The contract's defaults (no settings rows yet). */
export const DEFAULT_PAY_PARAMS: PayParams = {
  model: 'PERCENT',
  percent: 80,
  fixed_lkr: 80,
  base_lkr: 50,
  per_km_lkr: 20,
  min_lkr: null,
};

/** The API's limits (rider.pay-rules.ts / rider.pay.ts). */
export const MAX_PAY_LKR = 10_000;
export const MAX_PER_KM_LKR = 1_000;
export const MAX_ADJUSTMENT_LKR = 100_000;
export const MAX_ADJUSTMENT_NOTE = 300;
export const MAX_ADJUSTMENT_DAYS_BACK = 400;
export const MAX_PEAK_WINDOWS = 10;
export const MAX_DAILY_TIERS = 5;

/** A number for an input box: 80 -> "80", 12.5 -> "12.5", null -> "". */
export const numberText = (value: number | null | undefined) =>
  typeof value === 'number' && Number.isFinite(value) ? String(Number(value.toFixed(2))) : '';

/** Distance pay choices (owner, 2026-10-10). */
export const DISTANCE_MODE_OPTIONS: ReadonlyArray<{ id: DistanceMode; text: string }> = [
  { id: 'LINEAR', text: 'Base + per km' },
  { id: 'TIERS', text: 'Per-km tiers' },
];

/** A DISTANCE model's way of paying; an API from before per-km tiers has none (LINEAR). */
export const distanceModeOf = (params: Pick<PayParams, 'distance_mode'> | null | undefined): DistanceMode =>
  params?.distance_mode === 'TIERS' ? 'TIERS' : 'LINEAR';

/**
 * "80% of the delivery fee", "LKR 80 per delivery", "LKR 50 + LKR 20 per km",
 * or per-km tiers "Per km: km 1 LKR 100, km 2 LKR 60, km 3+ LKR 50" (owner,
 * 2026-10-10); " · min LKR 100" when set.
 */
export function describePay(params: PayParams): string {
  const base =
    params.model === 'FIXED'
      ? `${formatMoney(params.fixed_lkr)} per delivery`
      : params.model === 'DISTANCE'
        ? distanceModeOf(params) === 'TIERS'
          ? `Per km: ${tiersSummary(params.km_tiers ?? [])}`
          : `${formatMoney(params.base_lkr)} + ${formatMoney(params.per_km_lkr)} per km`
        : `${formatPercent(params.percent)} of the delivery fee`;
  return typeof params.min_lkr === 'number' && params.min_lkr > 0 ? `${base} · min ${formatMoney(params.min_lkr)}` : base;
}

/** "+LKR 30" or "+10%". */
export function boostText(mode: BoostMode, amount: number): string {
  return mode === 'PERCENT' ? `+${formatPercent(amount)}` : `+${formatMoney(amount)}`;
}

/** Signed money: "+LKR 100", "−LKR 200", "LKR 0". */
export function signedMoney(value: number): string {
  if (value > 0) return `+${formatMoney(value)}`;
  if (value < 0) return `−${formatMoney(Math.abs(value))}`;
  return formatMoney(0);
}

/**
 * The rider-list label with pay models: an own FIXED / DISTANCE model reads
 * "Commission · Fixed per delivery"; a rider on a non-% store default reads
 * "Commission · LKR 80 per delivery (default)". Otherwise as `payLabel`.
 */
export function payModelLabel(
  payType: RiderPayType | undefined,
  ownPercent: number | null | undefined,
  defaultPercent: number | null,
  ownModel?: PayModel | null,
  defaultModel?: PayParams | null
): string {
  if (payType !== 'COMMISSION') return 'Company';
  if (ownModel === 'FIXED' || ownModel === 'DISTANCE') return `Commission · ${PAY_MODEL_LABEL[ownModel]}`;
  if (ownModel == null && ownPercent == null && defaultModel && defaultModel.model !== 'PERCENT') {
    return `Commission · ${describePay(defaultModel)} (default)`;
  }
  return payLabel(payType, ownPercent, defaultPercent);
}

/**
 * A money / km amount typed by staff: at most 2 decimals (or `decimals`),
 * within [min, max] (min exclusive with `positive`). `optional` lets blank be null.
 */
export function parseAmount(
  raw: string,
  opts: { min?: number; max: number; positive?: boolean; optional?: boolean; what?: string; decimals?: 1 | 2 }
): { value: number | null } | { error: string } {
  const what = opts.what ?? 'an amount';
  const text = raw.trim().replace(/^LKR\s*/i, '').replace(/,/g, '').trim();
  if (!text) return opts.optional ? { value: null } : { error: `Enter ${what}.` };
  if (!/^\d+(\.\d+)?$/.test(text)) return { error: 'Enter a number, like 80 or 12.5.' };
  const oneDecimal = opts.decimals === 1;
  if (!(oneDecimal ? /^\d+(\.\d)?$/ : /^\d+(\.\d{1,2})?$/).test(text)) {
    return { error: oneDecimal ? 'Use at most 1 decimal.' : 'Use at most 2 decimals.' };
  }
  const value = Number(text);
  const min = opts.min ?? 0;
  if (opts.positive ? value <= min : value < min) {
    return { error: opts.positive ? `Enter more than ${min}.` : `Enter ${min} or more.` };
  }
  if (value > opts.max) return { error: `Enter at most ${opts.max.toLocaleString('en-US')}.` };
  return { value };
}

// ------------------------------------------------------------ a rider's pay

/** What the pay dialog edits; numbers stay text until saved. */
export interface PayDraft {
  payType: RiderPayType;
  /** DEFAULT = follows the store default model. */
  model: 'DEFAULT' | PayModel;
  percent: string;
  fixed: string;
  base: string;
  perKm: string;
  min: string;
  /** DISTANCE only (owner, 2026-10-10): base + per km, or per-km tiers. */
  distanceMode: DistanceMode;
  /** One LKR text per km row, km 1 first (TIERS). */
  tiers: string[];
}

export type PayDraftErrors = Partial<Record<'percent' | 'fixed' | 'base' | 'perKm' | 'min' | 'tiers', string>> & {
  /** Per km row (TIERS). */
  tierRows?: (string | undefined)[];
};

/** A new rider (approve): Company - the backend's own default - with numbers ready from the store default. */
export function newPayDraft(defaults: PayParams | null): PayDraft {
  return fillDraftBlanks(
    {
      payType: 'COMPANY',
      model: 'DEFAULT',
      percent: '',
      fixed: '',
      base: '',
      perKm: '',
      min: '',
      distanceMode: distanceModeOf(defaults),
      tiers: [],
    },
    defaults
  );
}

/**
 * A rider's current pay as a draft: own values first, else the store
 * default (so switching model shows sensible numbers). An older API row has
 * only `commission_percent`: an own % means own PERCENT.
 */
export function payDraftFrom(
  pay: Pick<RiderPay, 'pay_type' | 'commission_percent'> & Partial<Pick<RiderPay, 'pay_model' | 'own'>>,
  defaults: PayParams | null
): PayDraft {
  const own = pay.own;
  const model: PayDraft['model'] =
    pay.pay_type !== 'COMMISSION' ? 'DEFAULT' : (pay.pay_model ?? (pay.commission_percent != null ? 'PERCENT' : 'DEFAULT'));
  return fillDraftBlanks(
    {
      payType: pay.pay_type ?? 'COMPANY',
      model,
      percent: numberText(pay.commission_percent),
      fixed: numberText(own?.fixed_lkr),
      base: numberText(own?.base_lkr),
      perKm: numberText(own?.per_km_lkr),
      min: model === 'DEFAULT' ? '' : numberText(own?.min_lkr),
      // Owner, 2026-10-10: null = the store default's way and tiers.
      distanceMode: own?.distance_mode ?? distanceModeOf(defaults),
      tiers: tiersToRows(own?.km_tiers),
    },
    defaults
  );
}

/**
 * Fills blank number boxes from the store default (it may load after the
 * dialog opens). The minimum stays blank. No km rows yet: the store
 * default's tiers, else rows that pay what base + per km pays.
 */
export function fillDraftBlanks(draft: PayDraft, defaults: PayParams | null): PayDraft {
  const filled = defaults
    ? {
        ...draft,
        percent: draft.percent || numberText(defaults.percent),
        fixed: draft.fixed || numberText(defaults.fixed_lkr),
        base: draft.base || numberText(defaults.base_lkr),
        perKm: draft.perKm || numberText(defaults.per_km_lkr),
      }
    : { ...draft };
  if (filled.tiers.length === 0 && (defaults || filled.base || filled.perKm)) {
    filled.tiers = defaults?.km_tiers?.length
      ? tiersToRows(defaults.km_tiers)
      : linearToRows(Number(filled.base) || 0, Number(filled.perKm) || 0);
  }
  return filled;
}

/**
 * The PATCH /admin/riders/:id/pay body (and the approve body's pay fields)
 * for a draft. COMPANY: `{pay_type:'COMPANY'}` (Change pay adds
 * `commission_percent: null` as it always has). "Store default":
 * `{pay_type:'COMMISSION', commission_percent:null}` - the contract's
 * "follows the store default" (every own number is cleared server-side).
 * An own model sends its numbers and the optional minimum (null = none).
 */
export function payDraftToInput(draft: PayDraft): { input: RiderPayInput } | { errors: PayDraftErrors } {
  if (draft.payType === 'COMPANY') return { input: { pay_type: 'COMPANY' } };
  if (draft.model === 'DEFAULT') return { input: { pay_type: 'COMMISSION', commission_percent: null } };
  const errors: PayDraftErrors = {};
  const input: RiderPayInput = { pay_type: 'COMMISSION', pay_model: draft.model };
  if (draft.model === 'PERCENT') {
    const p = parseCommissionPercent(draft.percent);
    if ('error' in p) errors.percent = p.error;
    else input.commission_percent = p.value;
  } else if (draft.model === 'FIXED') {
    const f = parseAmount(draft.fixed, { max: MAX_PAY_LKR, what: 'the LKR per delivery' });
    if ('error' in f) errors.fixed = f.error;
    else input.fixed_lkr = f.value;
  } else if (draft.distanceMode === 'TIERS') {
    // Owner, 2026-10-10: per-km tiers (no cap; the minimum still applies).
    input.distance_mode = 'TIERS';
    const t = parseTierRows(draft.tiers);
    if ('error' in t) {
      errors.tiers = t.error;
      errors.tierRows = t.rowErrors;
    } else input.km_tiers = t.tiers;
  } else {
    input.distance_mode = 'LINEAR';
    const b = parseAmount(draft.base, { max: MAX_PAY_LKR, what: 'the base LKR' });
    if ('error' in b) errors.base = b.error;
    else input.base_lkr = b.value;
    const k = parseAmount(draft.perKm, { max: MAX_PER_KM_LKR, what: 'the LKR per km' });
    if ('error' in k) errors.perKm = k.error;
    else input.per_km_lkr = k.value;
  }
  const m = parseAmount(draft.min, { max: MAX_PAY_LKR, optional: true });
  if ('error' in m) errors.min = m.error;
  else input.min_lkr = m.value;
  return Object.keys(errors).length ? { errors } : { input };
}

// ------------------------------------------------------------------ boosts

/** Weekday chips for peak windows: 1 = Monday ... 7 = Sunday (the API's numbering). */
export const WEEKDAYS: { day: number; short: string; name: string }[] = [
  { day: 1, short: 'Mon', name: 'Monday' },
  { day: 2, short: 'Tue', name: 'Tuesday' },
  { day: 3, short: 'Wed', name: 'Wednesday' },
  { day: 4, short: 'Thu', name: 'Thursday' },
  { day: 5, short: 'Fri', name: 'Friday' },
  { day: 6, short: 'Sat', name: 'Saturday' },
  { day: 7, short: 'Sun', name: 'Sunday' },
];

/** A boost amount: LKR up to 10000, or a % up to 100; 2 decimals. */
export function parseBoost(mode: BoostMode, raw: string): { value: number } | { error: string } {
  const r = parseAmount(raw, { max: mode === 'PERCENT' ? 100 : MAX_PAY_LKR, what: 'the boost' });
  if ('error' in r) return r;
  return { value: r.value ?? 0 };
}

/** Rain boost auto-off quick choices. */
export type RainAutoOff = '1h' | '2h' | '3h' | 'none';
export const RAIN_AUTO_OFF: { id: RainAutoOff; text: string }[] = [
  { id: '1h', text: '1 h' },
  { id: '2h', text: '2 h' },
  { id: '3h', text: '3 h' },
  { id: 'none', text: 'Until I turn it off' },
];

/** The ISO auto-off time for a quick choice, or null for "until I turn it off". */
export function rainAutoOffAt(choice: RainAutoOff, now = new Date()): string | null {
  const hours = choice === '1h' ? 1 : choice === '2h' ? 2 : choice === '3h' ? 3 : 0;
  return hours ? new Date(now.getTime() + hours * 3_600_000).toISOString() : null;
}

/** A Colombo clock time for an ISO instant: "6:30 PM". */
export function colomboClock(iso: string): string {
  const d = new Date(Date.parse(iso) + 330 * 60_000);
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}
