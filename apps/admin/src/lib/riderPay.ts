import type {
  AdjustmentReason,
  BonusKind,
  BoostMode,
  PayModel,
  PayParams,
  PeakWindow,
  RiderPay,
  RiderPayInput,
  RiderPayModelInput,
  RiderPayType,
} from '../api/types';
import { formatMoney } from './orders';

/**
 * Rider pay (owner, 2026-10-09). Riders are one of two types once approved:
 * a COMPANY rider is salaried (no per-delivery commission; Blynk keeps the
 * delivery charge) and a COMMISSION rider earns a % of the STANDARD delivery
 * fee - the store default, or the rider's own override - and keeps that
 * share out of the COD cash they collect.
 *
 * Rider pay controls (owner, 2026-10-10): a commission rider's base pay per
 * delivery is one of three models - % of the delivery fee, a fixed LKR, or
 * distance (base + LKR per km) - with an optional minimum, plus automatic
 * boosts. Deductions and extra pay are adjustments.
 */

export const PAY_TYPE_LABEL: Record<RiderPayType, string> = {
  COMPANY: 'Company',
  COMMISSION: 'Commission',
};

/** Store-default model choices in Settings (owner, 2026-10-10). */
export const PAY_MODEL_LABEL: Record<PayModel, string> = {
  PERCENT: '% of delivery fee',
  FIXED: 'Fixed per delivery',
  DISTANCE: 'Distance',
};

/** The shorter labels for a rider's own model in the pay dialog (owner, 2026-10-10). */
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

export const ADJUSTMENT_REASON_LABEL: Record<AdjustmentReason, string> = {
  CASH_SHORT: 'Cash short',
  DAMAGED_ITEM: 'Damaged item',
  LATE: 'Late',
  BONUS: 'Bonus',
  OTHER: 'Other',
};

export const ADJUSTMENT_REASONS: AdjustmentReason[] = ['CASH_SHORT', 'DAMAGED_ITEM', 'LATE', 'BONUS', 'OTHER'];

export const BONUS_KIND_LABEL: Record<BonusKind, string> = {
  PEAK_BOOST: 'Peak boost',
  RAIN_BOOST: 'Rain boost',
  LONG_DISTANCE: 'Long distance',
  DAILY_TARGET: 'Daily target',
};

export const BONUS_KINDS: BonusKind[] = ['PEAK_BOOST', 'RAIN_BOOST', 'LONG_DISTANCE', 'DAILY_TARGET'];

/** The contract's defaults (no rows yet). */
export const DEFAULT_PAY_PARAMS: PayParams = {
  model: 'PERCENT',
  percent: 80,
  fixed_lkr: 80,
  base_lkr: 50,
  per_km_lkr: 20,
  min_lkr: null,
};

/** 80 -> "80", 72.5 -> "72.5", 66.666 -> "66.67". */
export const formatPercent = (value: number) => String(Number(value.toFixed(2)));

/** A number for an input box: 80 -> "80", 12.5 -> "12.5". */
export const numberText = (value: number | null | undefined) =>
  typeof value === 'number' && Number.isFinite(value) ? String(Number(value.toFixed(2))) : '';

/** "80% of delivery fee", "LKR 80 per delivery", "LKR 50 + LKR 20/km"; with " · min LKR 100". */
export function describePay(params: PayParams): string {
  const base =
    params.model === 'FIXED'
      ? `${formatMoney(params.fixed_lkr)} per delivery`
      : params.model === 'DISTANCE'
        ? `${formatMoney(params.base_lkr)} + ${formatMoney(params.per_km_lkr)}/km`
        : `${formatPercent(params.percent)}% of delivery fee`;
  return typeof params.min_lkr === 'number' && params.min_lkr > 0 ? `${base} · min ${formatMoney(params.min_lkr)}` : base;
}

/** "+LKR 30" or "+10%" per delivery. */
export function boostText(mode: BoostMode, amount: number): string {
  return mode === 'PERCENT' ? `+${formatPercent(amount)}%` : `+${formatMoney(amount)}`;
}

/** Signed money: "+LKR 100", "−LKR 200", "LKR 0". */
export function signedMoney(value: number): string {
  if (value > 0) return `+${formatMoney(value)}`;
  if (value < 0) return `−${formatMoney(Math.abs(value))}`;
  return formatMoney(0);
}

/**
 * "Company", "Commission · 75%" (own %), or "Commission · 80% (default)".
 * `defaultPercent` may be unknown (the setting did not load). With the rider
 * pay controls (owner, 2026-10-10) a rider's own model or a non-% store
 * default reads "Commission · Fixed" / "Commission · LKR 80 per delivery (default)".
 */
export function payLabel(
  payType: RiderPayType | undefined,
  ownPercent: number | null | undefined,
  defaultPercent?: number | null,
  ownModel?: PayModel | null,
  defaultModel?: PayParams | null
): string {
  if (payType !== 'COMMISSION') return PAY_TYPE_LABEL.COMPANY;
  if (ownModel === 'FIXED' || ownModel === 'DISTANCE') return `Commission · ${OWN_MODEL_LABEL[ownModel]}`;
  if (typeof ownPercent === 'number') return `Commission · ${formatPercent(ownPercent)}%`;
  if (defaultModel && defaultModel.model !== 'PERCENT') return `Commission · ${describePay(defaultModel)} (default)`;
  if (typeof defaultPercent === 'number') return `Commission · ${formatPercent(defaultPercent)}% (default)`;
  return 'Commission · default %';
}

/**
 * A commission % as the API accepts it: 0..100, at most 2 decimals. With
 * `optional`, blank means "use the store default" (null).
 */
export function parsePercent(raw: string, optional = false): { percent: number | null } | { error: string } {
  const text = raw.trim().replace(/%$/, '').trim();
  if (!text) return optional ? { percent: null } : { error: 'Enter a percentage from 0 to 100.' };
  if (!/^\d+(\.\d+)?$/.test(text)) return { error: 'Enter a number, like 80 or 72.5.' };
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return { error: 'Use at most 2 decimal places.' };
  const percent = Number(text);
  if (percent > 100) return { error: 'Enter a percentage from 0 to 100.' };
  return { percent };
}

/**
 * A money / km amount (owner, 2026-10-10): at most 2 decimals, within
 * [min, max] (min exclusive with `positive`). `optional` lets blank be null.
 */
export function parseAmount(
  raw: string,
  opts: { min?: number; max: number; positive?: boolean; optional?: boolean; what?: string }
): { value: number | null } | { error: string } {
  const what = opts.what ?? 'an amount';
  const text = raw.trim().replace(/^LKR\s*/i, '').replace(/,/g, '').trim();
  if (!text) return opts.optional ? { value: null } : { error: `Enter ${what}.` };
  if (!/^\d+(\.\d+)?$/.test(text)) return { error: 'Enter a number, like 80 or 12.5.' };
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return { error: 'Use at most 2 decimal places.' };
  const value = Number(text);
  const min = opts.min ?? 0;
  if (opts.positive ? value <= min : value < min) {
    return { error: opts.positive ? `Enter more than ${min}.` : `Enter ${min} or more.` };
  }
  if (value > opts.max) return { error: `Enter at most ${opts.max.toLocaleString('en-US')}.` };
  return { value };
}

// ------------------------------------------------------- a rider's pay

/** What the pay dialog edits; numbers stay text until saved (owner, 2026-10-10). */
export interface PayDraft {
  payType: RiderPayType;
  /** DEFAULT = follows the store default model. */
  model: 'DEFAULT' | PayModel;
  percent: string;
  fixed: string;
  base: string;
  perKm: string;
  min: string;
}

export type PayDraftErrors = Partial<Record<'percent' | 'fixed' | 'base' | 'perKm' | 'min', string>>;

/** A blank draft for a new rider (approve): Company, numbers from the store default. */
export function newPayDraft(defaults: PayParams | null): PayDraft {
  return {
    payType: 'COMPANY',
    model: 'DEFAULT',
    percent: defaults ? numberText(defaults.percent) : '',
    fixed: defaults ? numberText(defaults.fixed_lkr) : '',
    base: defaults ? numberText(defaults.base_lkr) : '',
    perKm: defaults ? numberText(defaults.per_km_lkr) : '',
    min: '',
  };
}

/**
 * A rider's current pay as a draft. Own values first, else the store default
 * (prefilled so switching model shows sensible numbers). Older rows carry
 * only `commission_percent`: an own % means own PERCENT.
 */
export function payDraftFrom(
  pay: Pick<RiderPay, 'pay_type' | 'commission_percent'> & Partial<Pick<RiderPay, 'pay_model' | 'own'>>,
  defaults: PayParams | null
): PayDraft {
  const own = pay.own;
  const model: PayDraft['model'] =
    pay.pay_type !== 'COMMISSION'
      ? 'DEFAULT'
      : (pay.pay_model ?? (typeof pay.commission_percent === 'number' ? 'PERCENT' : 'DEFAULT'));
  return {
    payType: pay.pay_type ?? 'COMPANY',
    model,
    percent: numberText(pay.commission_percent ?? defaults?.percent),
    fixed: numberText(own?.fixed_lkr ?? defaults?.fixed_lkr),
    base: numberText(own?.base_lkr ?? defaults?.base_lkr),
    perKm: numberText(own?.per_km_lkr ?? defaults?.per_km_lkr),
    min: model === 'DEFAULT' ? '' : numberText(own?.min_lkr),
  };
}

/** Fills blank number boxes from the store default (it may load after the dialog opens). */
export function fillDraftBlanks(draft: PayDraft, defaults: PayParams | null): PayDraft {
  if (!defaults) return draft;
  return {
    ...draft,
    percent: draft.percent || numberText(defaults.percent),
    fixed: draft.fixed || numberText(defaults.fixed_lkr),
    base: draft.base || numberText(defaults.base_lkr),
    perKm: draft.perKm || numberText(defaults.per_km_lkr),
  };
}

/** The API's limits (rider.pay-rules.ts lkrSchema): LKR per delivery and LKR per km. */
export const MAX_PAY_LKR = 10000;
export const MAX_PER_KM_LKR = 1000;

/**
 * The PATCH body (and approve body) for a draft (owner, 2026-10-10).
 * COMPANY clears every pay field. "Store default" clears the rider's own
 * values. An own model sends its numbers and clears the others, so the
 * rider's stored pay is exactly what the dialog shows.
 */
export function payDraftToInput(draft: PayDraft): { input: RiderPayInput } | { errors: PayDraftErrors } {
  if (draft.payType === 'COMPANY') return { input: { pay_type: 'COMPANY', commission_percent: null } };
  if (draft.model === 'DEFAULT') return { input: { pay_type: 'COMMISSION', pay_model: null, commission_percent: null } };
  // Only the chosen model's numbers and the floor are sent: the API keeps
  // exactly those and clears the rest (rider.pay.ts payValues).
  const errors: PayDraftErrors = {};
  const input: RiderPayInput = { pay_type: 'COMMISSION', pay_model: draft.model };
  if (draft.model === 'PERCENT') {
    const p = parsePercent(draft.percent);
    if ('error' in p) errors.percent = p.error;
    else input.commission_percent = p.percent;
  } else if (draft.model === 'FIXED') {
    const f = parseAmount(draft.fixed, { max: MAX_PAY_LKR, what: 'the LKR per delivery' });
    if ('error' in f) errors.fixed = f.error;
    else input.fixed_lkr = f.value;
  } else {
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

// ------------------------------------------- store-wide settings (owner, 2026-10-10)

/** The store default model as Settings edits it; numbers stay text until saved. */
export interface ModelDraft {
  model: PayModel;
  percent: string;
  fixed: string;
  base: string;
  perKm: string;
  min: string;
}

export function modelDraftFrom(p: PayParams): ModelDraft {
  return {
    model: p.model,
    percent: numberText(p.percent),
    fixed: numberText(p.fixed_lkr),
    base: numberText(p.base_lkr),
    perKm: numberText(p.per_km_lkr),
    min: numberText(p.min_lkr),
  };
}

/**
 * PATCH /admin/settings/rider-pay/model: the chosen model's numbers and the
 * floor (blank = no floor); the other models' numbers are omitted (kept).
 */
export function modelDraftToInput(d: ModelDraft): { input: RiderPayModelInput } | { errors: PayDraftErrors } {
  const errors: PayDraftErrors = {};
  const input: RiderPayModelInput = { model: d.model };
  if (d.model === 'PERCENT') {
    const p = parsePercent(d.percent);
    if ('error' in p) errors.percent = p.error;
    else input.percent = p.percent ?? undefined;
  } else if (d.model === 'FIXED') {
    const f = parseAmount(d.fixed, { max: MAX_PAY_LKR, what: 'the LKR per delivery' });
    if ('error' in f) errors.fixed = f.error;
    else input.fixed_lkr = f.value ?? undefined;
  } else {
    const b = parseAmount(d.base, { max: MAX_PAY_LKR, what: 'the base LKR' });
    if ('error' in b) errors.base = b.error;
    else input.base_lkr = b.value ?? undefined;
    const k = parseAmount(d.perKm, { max: MAX_PER_KM_LKR, what: 'the LKR per km' });
    if ('error' in k) errors.perKm = k.error;
    else input.per_km_lkr = k.value ?? undefined;
  }
  const m = parseAmount(d.min, { max: MAX_PAY_LKR, optional: true });
  if ('error' in m) errors.min = m.error;
  else input.min_lkr = m.value;
  return Object.keys(errors).length ? { errors } : { input };
}

/** A boost amount (peak / rain): above 0, at most LKR 10,000 or 100%. */
export function parseBoost(raw: string, mode: BoostMode): { value: number } | { error: string } {
  const r = parseAmount(raw.replace(/%$/, ''), {
    max: mode === 'PERCENT' ? 100 : MAX_PAY_LKR,
    positive: true,
    what: mode === 'PERCENT' ? 'the boost %' : 'the boost in LKR',
  });
  return 'error' in r ? r : { value: r.value as number };
}

/** Weekday chips for peak windows: 1 = Monday .. 7 = Sunday (the API's numbering). */
export const WEEKDAYS: { day: number; short: string; long: string }[] = [
  { day: 1, short: 'Mon', long: 'Monday' },
  { day: 2, short: 'Tue', long: 'Tuesday' },
  { day: 3, short: 'Wed', long: 'Wednesday' },
  { day: 4, short: 'Thu', long: 'Thursday' },
  { day: 5, short: 'Fri', long: 'Friday' },
  { day: 6, short: 'Sat', long: 'Saturday' },
  { day: 7, short: 'Sun', long: 'Sunday' },
];

export const MAX_PEAK_WINDOWS = 10;
export const MAX_DAILY_TIERS = 5;

/** "7:30" -> "07:30"; "24:00" allowed (end of day); null when not a time. */
export function parseClock(raw: string): string | null {
  const m = /^(\d{1,2})[:.](\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h === 24 && min === 0) return '24:00';
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}

/** "Mon–Fri 17:00–20:00" style summary of a window. */
export function windowText(w: PeakWindow): string {
  const days = [...w.days].sort((a, b) => a - b);
  const names = days.map((d) => WEEKDAYS[d - 1]?.short ?? String(d));
  const run = days.length > 2 && days.every((d, i) => i === 0 || d === days[i - 1] + 1);
  const dayText = days.length === 7 ? 'Every day' : run ? `${names[0]}–${names[names.length - 1]}` : names.join(', ');
  return `${dayText} ${w.start}–${w.end}`;
}

/** Rain boost auto-off quick choices (owner, 2026-10-10). */
export type RainAutoOff = '1H' | '2H' | '3H' | 'NONE';
export const RAIN_AUTO_OFF: { key: RainAutoOff; label: string; hours: number | null }[] = [
  { key: '1H', label: '1 h', hours: 1 },
  { key: '2H', label: '2 h', hours: 2 },
  { key: '3H', label: '3 h', hours: 3 },
  { key: 'NONE', label: 'Until turned off', hours: null },
];

/** The ISO auto-off time for a choice, from `now`; null = until turned off. */
export function rainAutoOffAt(choice: RainAutoOff, now = new Date()): string | null {
  const hours = RAIN_AUTO_OFF.find((c) => c.key === choice)?.hours ?? null;
  return hours === null ? null : new Date(now.getTime() + hours * 3_600_000).toISOString();
}

/** "6:30 PM" in Sri Lanka time. */
export function colomboTime(iso: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Colombo', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
}

// ------------------------------------------------ adjustments (owner, 2026-10-10)

export type AdjustmentKind = 'DEDUCTION' | 'EXTRA';
export const ADJUSTMENT_KIND_LABEL: Record<AdjustmentKind, string> = { DEDUCTION: 'Deduction', EXTRA: 'Extra pay' };
export const MAX_ADJUSTMENT_LKR = 100000;
export const MAX_ADJUSTMENT_DAYS_BACK = 400;
export const MAX_ADJUSTMENT_NOTE = 300;

/** Whole days between two YYYY-MM-DD keys (b - a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** The signed amount for an adjustment: a deduction is negative. */
export function signedAdjustment(kind: AdjustmentKind, raw: string): { value: number } | { error: string } {
  const r = parseAmount(raw, { max: MAX_ADJUSTMENT_LKR, positive: true, what: 'the amount' });
  if ('error' in r) return r;
  const v = r.value as number;
  return { value: kind === 'DEDUCTION' ? -v : v };
}

// --------------------------------------------- earnings figures (owner, 2026-10-10)

/** Bonuses on the deliveries plus daily-target bonuses. */
export const bonusesOf = (f: { delivery_bonuses?: number; day_bonuses?: number }) =>
  Number(((f.delivery_bonuses ?? 0) + (f.day_bonuses ?? 0)).toFixed(2));

/** "Peak boost LKR 60 · Daily target LKR 100" - only the non-zero kinds. */
export function bonusBreakdownText(b: Partial<Record<BonusKind, number>> | undefined): string {
  if (!b) return '';
  return BONUS_KINDS.filter((k) => (b[k] ?? 0) > 0)
    .map((k) => `${BONUS_KIND_LABEL[k]} ${formatMoney(b[k] as number)}`)
    .join(' · ');
}
