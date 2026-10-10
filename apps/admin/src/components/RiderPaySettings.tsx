import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';
import { settings as settingsApi } from '../api/resources';
import type { BoostMode, PayModel, RainBoost, RiderPaySettings as RiderPaySettingsData } from '../api/types';
import { errorMessage } from '../lib/apiErrors';
import { formatMoney } from '../lib/orders';
import {
  BOOST_MODE_LABEL,
  MAX_DAILY_TIERS,
  MAX_PAY_LKR,
  MAX_PEAK_WINDOWS,
  PAY_MODELS,
  PAY_MODEL_LABEL,
  RAIN_AUTO_OFF,
  WEEKDAYS,
  boostText,
  colomboTime,
  describePay,
  modelDraftFrom,
  modelDraftToInput,
  numberText,
  parseAmount,
  parseBoost,
  parseClock,
  rainAutoOffAt,
  type ModelDraft,
  type PayDraftErrors,
  type RainAutoOff,
} from '../lib/riderPay';
import { Switch } from './Switch';
import { Field, Spinner, useToast } from './ui';
import './riderDocuments.css';
import './riderPay.css';

/**
 * Settings -> Rider pay (owner, 2026-10-10: "give the option in ops and admin
 * to control the rider app charges"). One card, each part saved on its own:
 *
 * - Rain boost: the big switch, +LKR or +% per delivery, auto-off after
 *   1 / 2 / 3 hours or until turned off (PATCH .../rider-pay/rain-boost).
 * - Store default pay: % of the delivery fee, fixed LKR per delivery or
 *   distance (base + LKR per km), with an optional minimum per delivery
 *   (PATCH .../rider-pay/model). The % here IS the old default commission -
 *   the separate "Rider commission" card is gone so there is one % control.
 * - Bonus rules: company riders too?, peak boost windows, daily targets (up
 *   to 5 tiers) and long distance (PATCH .../rider-pay/bonuses, one section
 *   per save).
 *
 * Against an API from before the pay controls (GET /admin/settings/rider-pay
 * fails) the card shows `fallback` - the old default-commission card.
 */
export function RiderPaySettings({ fallback }: { fallback: ReactNode }) {
  const [settings, setSettings] = useState<RiderPaySettingsData | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    settingsApi
      .getRiderPay()
      .then((s) => {
        if (cancelled) return;
        if (s?.default_model && s.bonus_rules && s.rain_boost) setSettings(s);
        else setFailed(true);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, []);

  if (failed) return <>{fallback}</>;

  return (
    <section className="panel rp-settings" aria-label="Rider pay" id="rider-pay">
      <h2 className="panel__title">Rider pay</h2>
      {!settings ? (
        <Spinner label="Loading rider pay" />
      ) : (
        <>
          <ul className="rp-explain" aria-label="How rider pay works">
            <li>
              Each delivery pays a commission rider the base - the pay model below, never less than the minimum - plus any
              boost running at that moment.
            </li>
            <li>Each daily target pays once, when the rider reaches it that day.</li>
            <li>
              Bonuses and adjustments are kept from that day's cash. Anything the cash cannot cover is owed to the rider.
            </li>
            <li>Company riders are salaried and get no per-delivery pay; past deliveries keep what they earned.</li>
          </ul>
          <RainBoostBlock initial={settings.rain_boost} onSaved={setSettings} />
          <DefaultModelBlock initial={settings} onSaved={setSettings} />
          <BonusRulesBlock initial={settings} onSaved={setSettings} />
        </>
      )}
    </section>
  );
}

/** Joins a form's first server message, or the fallback. */
const serverText = (err: unknown, fallback: string) => errorMessage(err, fallback);

function BoostModeControl({
  mode,
  onChange,
  label,
}: {
  mode: BoostMode;
  onChange(next: BoostMode): void;
  label: string;
}) {
  const id = useId();
  return (
    <div className="field">
      <span className="field__label" id={id}>
        {label}
      </span>
      <div className="segmented" role="group" aria-labelledby={id}>
        {(['FIXED', 'PERCENT'] as BoostMode[]).map((m) => (
          <button
            key={m}
            type="button"
            className={m === mode ? 'segmented__item is-selected' : 'segmented__item'}
            aria-pressed={m === mode}
            onClick={() => onChange(m)}
          >
            {BOOST_MODE_LABEL[m]}
          </button>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------ rain boost

function rainStatus(rain: RainBoost): string {
  if (!rain.active) return 'Off';
  const until = rain.auto_off_at ? `until ${colomboTime(rain.auto_off_at)}` : 'until turned off';
  return `On: ${boostText(rain.mode, rain.amount)} per delivery, ${until}`;
}

/** The rain boost switch (owner, 2026-10-10): prominent, with auto-off. */
function RainBoostBlock({ initial, onSaved }: { initial: RainBoost; onSaved(s: RiderPaySettingsData): void }) {
  const toast = useToast();
  const autoOffId = useId();
  const [rain, setRain] = useState(initial);
  const [mode, setMode] = useState<BoostMode>(initial.mode);
  const [amount, setAmount] = useState(numberText(initial.amount));
  // null = keep the auto-off already set (only while the boost is running).
  const [autoOff, setAutoOff] = useState<RainAutoOff | null>(initial.active ? null : '2H');
  const [amountError, setAmountError] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function send(on: boolean) {
    let body: Parameters<typeof settingsApi.setRainBoost>[0] = { on: false };
    if (on) {
      const parsed = parseBoost(amount, mode);
      if ('error' in parsed) {
        setAmountError(parsed.error);
        return;
      }
      body = { on: true, mode, amount: parsed.value };
      const choice = autoOff ?? (rain.active ? null : '2H');
      if (choice !== null) body.auto_off_at = rainAutoOffAt(choice);
    }
    setAmountError(undefined);
    setError(null);
    setSaving(true);
    try {
      const updated = await settingsApi.setRainBoost(body);
      setRain(updated.rain_boost);
      setMode(updated.rain_boost.mode);
      setAmount(numberText(updated.rain_boost.amount));
      setAutoOff(updated.rain_boost.active ? null : '2H');
      onSaved(updated);
      toast.success(updated.rain_boost.active ? `Rain boost ${rainStatus(updated.rain_boost).replace(/^On: /, 'on: ')}.` : 'Rain boost is off.');
    } catch (err) {
      setError(serverText(err, 'Could not change the rain boost.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={rain.active ? 'rp-rain is-on' : 'rp-rain'} role="group" aria-label="Rain boost">
      <div className="rp-block__head">
        <div>
          <h3 className="rp-rain__title">Rain boost</h3>
          <p className="rp-block__status" data-testid="rain-status">
            <span className="rp-rain__state">{rainStatus(rain)}</span>
          </p>
        </div>
        <Switch checked={rain.active} disabled={saving} label="Rain boost" onChange={(next) => void send(next)}>
          {rain.active ? 'On' : 'Off'}
        </Switch>
      </div>
      <div className="rp-inline">
        <BoostModeControl mode={mode} onChange={setMode} label="Rain boost type" />
        <Field label={mode === 'PERCENT' ? 'Rain boost (%)' : 'Rain boost (LKR)'} error={amountError}>
          <input className="input rp-num" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
      </div>
      <div className="field">
        <span className="field__label" id={autoOffId}>
          Turns off by itself
        </span>
        <div className="rd-choices" role="group" aria-labelledby={autoOffId}>
          {RAIN_AUTO_OFF.map((c) => (
            <button
              key={c.key}
              type="button"
              className={c.key === autoOff ? 'rd-choice is-selected' : 'rd-choice'}
              aria-pressed={c.key === autoOff}
              onClick={() => setAutoOff(c.key)}
            >
              {c.hours === null ? c.label : `After ${c.label}`}
            </button>
          ))}
        </div>
        <span className="field__hint">
          {rain.active && autoOff === null
            ? `Keeps the current end (${rain.auto_off_at ? colomboTime(rain.auto_off_at) : 'until turned off'}) unless you pick another.`
            : 'Counted from when you switch it on or press Update.'}
        </span>
      </div>
      {error ? <p className="field__error">{error}</p> : null}
      {rain.active ? (
        <div className="form__actions">
          <button type="button" className="button button--ghost" disabled={saving} onClick={() => void send(true)}>
            Update rain boost
          </button>
        </div>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------- store default pay

function DefaultModelBlock({ initial, onSaved }: { initial: RiderPaySettingsData; onSaved(s: RiderPaySettingsData): void }) {
  const toast = useToast();
  const modelId = useId();
  const [current, setCurrent] = useState(initial.default_model);
  const [draft, setDraft] = useState<ModelDraft>(() => modelDraftFrom(initial.default_model));
  const [errors, setErrors] = useState<PayDraftErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<ModelDraft>) => setDraft((d) => ({ ...d, ...patch }));

  async function save(event: FormEvent) {
    event.preventDefault();
    const read = modelDraftToInput(draft);
    if ('errors' in read) {
      setErrors(read.errors);
      return;
    }
    setErrors({});
    setError(null);
    setSaving(true);
    try {
      const updated = await settingsApi.setRiderPayModel(read.input);
      setCurrent(updated.default_model);
      setDraft(modelDraftFrom(updated.default_model));
      onSaved(updated);
      toast.success(`Store default pay: ${describePay(updated.default_model)}.`);
    } catch (err) {
      setError(serverText(err, 'Could not save the store default pay.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="form rp-block" aria-label="Store default pay" onSubmit={save} noValidate>
      <div className="rp-block__head">
        <h3 className="rp-block__title">Store default pay</h3>
        <p className="rp-block__status">Now {describePay(current)}</p>
      </div>
      <div className="field">
        <span className="field__label" id={modelId}>
          Commission riders are paid
        </span>
        <div className="segmented segmented--wrap" role="group" aria-labelledby={modelId}>
          {PAY_MODELS.map((m: PayModel) => (
            <button
              key={m}
              type="button"
              className={m === draft.model ? 'segmented__item is-selected' : 'segmented__item'}
              aria-pressed={m === draft.model}
              onClick={() => set({ model: m })}
            >
              {PAY_MODEL_LABEL[m]}
            </button>
          ))}
        </div>
      </div>
      {draft.model === 'PERCENT' ? (
        <Field
          label="Default commission (%)"
          hint="Share of the standard delivery fee, 0 to 100. Free deliveries still earn it."
          error={errors.percent}
        >
          <input className="input rp-num" inputMode="decimal" value={draft.percent} onChange={(e) => set({ percent: e.target.value })} />
        </Field>
      ) : null}
      {draft.model === 'FIXED' ? (
        <Field label="LKR per delivery" hint="The same amount for every delivery." error={errors.fixed}>
          <input className="input rp-num" inputMode="decimal" value={draft.fixed} onChange={(e) => set({ fixed: e.target.value })} />
        </Field>
      ) : null}
      {draft.model === 'DISTANCE' ? (
        <div className="rp-inline">
          <Field label="Base LKR per delivery" error={errors.base}>
            <input className="input rp-num" inputMode="decimal" value={draft.base} onChange={(e) => set({ base: e.target.value })} />
          </Field>
          <Field label="LKR per km" hint="Road distance, store to drop-off." error={errors.perKm}>
            <input className="input rp-num" inputMode="decimal" value={draft.perKm} onChange={(e) => set({ perKm: e.target.value })} />
          </Field>
        </div>
      ) : null}
      <Field label="Minimum per delivery (LKR, optional)" hint="Blank = no minimum." error={errors.min}>
        <input className="input rp-num" inputMode="decimal" value={draft.min} onChange={(e) => set({ min: e.target.value })} />
      </Field>
      <p className="form__note">
        Riders on "Store default" follow this. Riders with their own pay keep it (change it under Rider earnings).
      </p>
      {error ? <p className="field__error">{error}</p> : null}
      <div className="form__actions">
        <button type="submit" className="button" disabled={saving}>
          {saving ? <Spinner label="Saving" /> : 'Save default pay'}
        </button>
      </div>
    </form>
  );
}

// ------------------------------------------------------------ bonus rules

interface WindowDraft {
  days: number[];
  start: string;
  end: string;
}

interface TierDraft {
  deliveries: string;
  amount: string;
}

function BonusRulesBlock({ initial, onSaved }: { initial: RiderPaySettingsData; onSaved(s: RiderPaySettingsData): void }) {
  const toast = useToast();
  const [companyRiders, setCompanyRiders] = useState(initial.bonus_rules.company_riders);
  const [companyError, setCompanyError] = useState<string | null>(null);
  const [companySaving, setCompanySaving] = useState(false);

  async function saveCompany(next: boolean) {
    setCompanySaving(true);
    setCompanyError(null);
    try {
      const updated = await settingsApi.setRiderPayBonuses({ company_riders: next });
      setCompanyRiders(updated.bonus_rules.company_riders);
      onSaved(updated);
      toast.success(
        updated.bonus_rules.company_riders ? 'Company riders get the bonuses too.' : 'Bonuses are for commission riders only.'
      );
    } catch (err) {
      setCompanyError(serverText(err, 'Could not save who gets bonuses.'));
    } finally {
      setCompanySaving(false);
    }
  }

  return (
    <div className="rp-block" role="group" aria-label="Bonus rules">
      <div className="rp-block__head">
        <h3 className="rp-block__title">Bonuses</h3>
        <Switch checked={companyRiders} disabled={companySaving} label="Company riders get bonuses too" onChange={(n) => void saveCompany(n)}>
          Company riders get bonuses too
        </Switch>
      </div>
      <p className="rp-block__status">
        {companyRiders ? 'Boosts and targets pay every rider.' : 'Boosts and targets pay commission riders only.'}
      </p>
      {companyError ? <p className="field__error">{companyError}</p> : null}
      <PeakBlock initial={initial} onSaved={onSaved} />
      <DailyTargetBlock initial={initial} onSaved={onSaved} />
      <LongDistanceBlock initial={initial} onSaved={onSaved} />
    </div>
  );
}

function PeakBlock({ initial, onSaved }: { initial: RiderPaySettingsData; onSaved(s: RiderPaySettingsData): void }) {
  const toast = useToast();
  const peak = initial.bonus_rules.peak;
  const [enabled, setEnabled] = useState(peak.enabled);
  const [mode, setMode] = useState<BoostMode>(peak.mode);
  const [amount, setAmount] = useState(numberText(peak.amount));
  const [windows, setWindows] = useState<WindowDraft[]>(() => peak.windows.map((w) => ({ ...w, days: [...w.days] })));
  const [errors, setErrors] = useState<{ amount?: string; windows?: string; rows: Record<number, string> }>({ rows: {} });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const setWindow = (i: number, patch: Partial<WindowDraft>) =>
    setWindows((list) => list.map((w, j) => (j === i ? { ...w, ...patch } : w)));

  async function save(event: FormEvent) {
    event.preventDefault();
    const next: typeof errors = { rows: {} };
    const parsed = parseBoost(amount, mode);
    if ('error' in parsed) next.amount = parsed.error;
    const out = windows.map((w, i) => {
      const start = parseClock(w.start);
      const end = parseClock(w.end);
      if (w.days.length === 0) next.rows[i] = 'Pick at least one day.';
      else if (!start || !end) next.rows[i] = 'Use times like 17:00 (24-hour); the end may be 24:00.';
      else if (start === '24:00' || start >= end) next.rows[i] = 'The window must end after it starts.';
      return { days: [...w.days].sort((a, b) => a - b), start: start ?? '', end: end ?? '' };
    });
    if (enabled && windows.length === 0) next.windows = 'Add at least one time window.';
    setErrors(next);
    if (next.amount || next.windows || Object.keys(next.rows).length || 'error' in parsed) return;
    setError(null);
    setSaving(true);
    try {
      const updated = await settingsApi.setRiderPayBonuses({ peak: { enabled, mode, amount: parsed.value, windows: out } });
      const p = updated.bonus_rules.peak;
      setEnabled(p.enabled);
      setMode(p.mode);
      setAmount(numberText(p.amount));
      setWindows(p.windows.map((w) => ({ ...w, days: [...w.days] })));
      onSaved(updated);
      toast.success(p.enabled ? `Peak boost on: ${boostText(p.mode, p.amount)} per delivery.` : 'Peak boost saved (off).');
    } catch (err) {
      setError(serverText(err, 'Could not save the peak boost.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="form rp-block" aria-label="Peak boost" onSubmit={save} noValidate>
      <div className="rp-block__head">
        <Switch checked={enabled} label="Peak boost on" onChange={setEnabled}>
          Peak boost
        </Switch>
      </div>
      <p className="rp-block__status">Extra on each delivery finished inside a time window (Sri Lanka time).</p>
      <div className="rp-inline">
        <BoostModeControl mode={mode} onChange={setMode} label="Peak boost type" />
        <Field label={mode === 'PERCENT' ? 'Peak boost (%)' : 'Peak boost (LKR)'} error={errors.amount}>
          <input className="input rp-num" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
      </div>
      <div className="rp-list">
        {windows.map((w, i) => (
          <div key={i} className="rp-window" role="group" aria-label={`Peak window ${i + 1}`}>
            <div className="rd-choices" role="group" aria-label="Days">
              {WEEKDAYS.map((d) => {
                const on = w.days.includes(d.day);
                return (
                  <button
                    key={d.day}
                    type="button"
                    className={on ? 'rd-choice is-selected' : 'rd-choice'}
                    aria-pressed={on}
                    aria-label={d.long}
                    onClick={() => setWindow(i, { days: on ? w.days.filter((x) => x !== d.day) : [...w.days, d.day] })}
                  >
                    {d.short}
                  </button>
                );
              })}
            </div>
            <input
              className="input rp-time"
              inputMode="numeric"
              placeholder="17:00"
              aria-label="Starts"
              value={w.start}
              onChange={(e) => setWindow(i, { start: e.target.value })}
            />
            <span aria-hidden="true">to</span>
            <input
              className="input rp-time"
              inputMode="numeric"
              placeholder="20:00"
              aria-label="Ends"
              value={w.end}
              onChange={(e) => setWindow(i, { end: e.target.value })}
            />
            <button
              type="button"
              className="button button--ghost button--sm"
              onClick={() => setWindows((list) => list.filter((_, j) => j !== i))}
            >
              Remove
            </button>
            {errors.rows[i] ? <p className="rp-error">{errors.rows[i]}</p> : null}
          </div>
        ))}
      </div>
      {errors.windows ? <p className="rp-error">{errors.windows}</p> : null}
      {windows.length < MAX_PEAK_WINDOWS ? (
        <div>
          <button
            type="button"
            className="button button--ghost button--sm"
            onClick={() => setWindows((list) => [...list, { days: [1, 2, 3, 4, 5], start: '17:00', end: '20:00' }])}
          >
            + Add time window
          </button>
        </div>
      ) : null}
      {error ? <p className="field__error">{error}</p> : null}
      <div className="form__actions">
        <button type="submit" className="button" disabled={saving}>
          {saving ? <Spinner label="Saving" /> : 'Save peak boost'}
        </button>
      </div>
    </form>
  );
}

function DailyTargetBlock({ initial, onSaved }: { initial: RiderPaySettingsData; onSaved(s: RiderPaySettingsData): void }) {
  const toast = useToast();
  const target = initial.bonus_rules.daily_target;
  const [enabled, setEnabled] = useState(target.enabled);
  const [tiers, setTiers] = useState<TierDraft[]>(() =>
    target.tiers.map((t) => ({ deliveries: String(t.deliveries), amount: numberText(t.amount_lkr) }))
  );
  const [errors, setErrors] = useState<{ list?: string; rows: Record<number, string> }>({ rows: {} });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const setTier = (i: number, patch: Partial<TierDraft>) => setTiers((list) => list.map((t, j) => (j === i ? { ...t, ...patch } : t)));

  async function save(event: FormEvent) {
    event.preventDefault();
    const next: typeof errors = { rows: {} };
    const out = tiers.map((t, i) => {
      const n = t.deliveries.trim();
      const count = /^\d+$/.test(n) ? Number(n) : NaN;
      const amt = parseAmount(t.amount, { max: MAX_PAY_LKR, positive: true, what: 'the bonus in LKR' });
      if (!(count >= 1 && count <= 100)) next.rows[i] = 'Deliveries: a whole number from 1 to 100.';
      else if ('error' in amt) next.rows[i] = amt.error;
      return { deliveries: count, amount_lkr: 'error' in amt ? 0 : (amt.value as number) };
    });
    if (new Set(out.map((t) => t.deliveries)).size !== out.length) next.list = 'Two targets have the same number of deliveries.';
    if (enabled && tiers.length === 0) next.list = 'Add at least one target.';
    setErrors(next);
    if (next.list || Object.keys(next.rows).length) return;
    setError(null);
    setSaving(true);
    try {
      const updated = await settingsApi.setRiderPayBonuses({
        daily_target: { enabled, tiers: [...out].sort((a, b) => a.deliveries - b.deliveries) },
      });
      const d = updated.bonus_rules.daily_target;
      setEnabled(d.enabled);
      setTiers(d.tiers.map((t) => ({ deliveries: String(t.deliveries), amount: numberText(t.amount_lkr) })));
      onSaved(updated);
      toast.success(d.enabled ? `Daily target on: ${d.tiers.length} target${d.tiers.length === 1 ? '' : 's'}.` : 'Daily target saved (off).');
    } catch (err) {
      setError(serverText(err, 'Could not save the daily target.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="form rp-block" aria-label="Daily target" onSubmit={save} noValidate>
      <div className="rp-block__head">
        <Switch checked={enabled} label="Daily target on" onChange={setEnabled}>
          Daily target
        </Switch>
      </div>
      <p className="rp-block__status">A one-off bonus when a rider reaches a number of deliveries in a day. Each target pays once.</p>
      <div className="rp-list">
        {tiers.map((t, i) => (
          <div key={i} className="rp-tier" role="group" aria-label={`Target ${i + 1}`}>
            <input
              className="input rp-num"
              inputMode="numeric"
              aria-label="Deliveries"
              value={t.deliveries}
              onChange={(e) => setTier(i, { deliveries: e.target.value })}
            />
            <span>deliveries pays</span>
            <input
              className="input rp-num"
              inputMode="decimal"
              aria-label="Bonus (LKR)"
              value={t.amount}
              onChange={(e) => setTier(i, { amount: e.target.value })}
            />
            <span>LKR</span>
            <button type="button" className="button button--ghost button--sm" onClick={() => setTiers((list) => list.filter((_, j) => j !== i))}>
              Remove
            </button>
            {errors.rows[i] ? <p className="rp-error">{errors.rows[i]}</p> : null}
          </div>
        ))}
      </div>
      {errors.list ? <p className="rp-error">{errors.list}</p> : null}
      {tiers.length < MAX_DAILY_TIERS ? (
        <div>
          <button
            type="button"
            className="button button--ghost button--sm"
            onClick={() => setTiers((list) => [...list, { deliveries: '', amount: '' }])}
          >
            + Add target
          </button>
        </div>
      ) : (
        <p className="form__note">Up to {MAX_DAILY_TIERS} targets.</p>
      )}
      {error ? <p className="field__error">{error}</p> : null}
      <div className="form__actions">
        <button type="submit" className="button" disabled={saving}>
          {saving ? <Spinner label="Saving" /> : 'Save daily target'}
        </button>
      </div>
    </form>
  );
}

function LongDistanceBlock({ initial, onSaved }: { initial: RiderPaySettingsData; onSaved(s: RiderPaySettingsData): void }) {
  const toast = useToast();
  const rule = initial.bonus_rules.long_distance;
  const [enabled, setEnabled] = useState(rule.enabled);
  const [km, setKm] = useState(numberText(rule.over_km));
  const [amount, setAmount] = useState(numberText(rule.amount_lkr));
  const [errors, setErrors] = useState<{ km?: string; amount?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(event: FormEvent) {
    event.preventDefault();
    const next: typeof errors = {};
    const k = parseAmount(km, { min: 0.5, max: 50, what: 'the distance in km' });
    if ('error' in k) next.km = k.error.replace('Enter 0.5 or more.', 'At least 0.5 km.');
    else if (!/^\d+(\.\d)?$/.test(km.trim())) next.km = 'Use at most 1 decimal, like 5 or 7.5.';
    const a = parseAmount(amount, { max: MAX_PAY_LKR, what: 'the bonus in LKR' });
    if ('error' in a) next.amount = a.error;
    setErrors(next);
    if (next.km || next.amount || 'error' in k || 'error' in a) return;
    setError(null);
    setSaving(true);
    try {
      const updated = await settingsApi.setRiderPayBonuses({
        long_distance: { enabled, over_km: k.value as number, amount_lkr: a.value as number },
      });
      const l = updated.bonus_rules.long_distance;
      setEnabled(l.enabled);
      setKm(numberText(l.over_km));
      setAmount(numberText(l.amount_lkr));
      onSaved(updated);
      toast.success(l.enabled ? `Long distance on: +${formatMoney(l.amount_lkr)} over ${numberText(l.over_km)} km.` : 'Long distance saved (off).');
    } catch (err) {
      setError(serverText(err, 'Could not save the long distance bonus.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="form rp-block" aria-label="Long distance" onSubmit={save} noValidate>
      <div className="rp-block__head">
        <Switch checked={enabled} label="Long distance bonus on" onChange={setEnabled}>
          Long distance
        </Switch>
      </div>
      <p className="rp-block__status">Extra on a delivery whose road distance from the store is longer than this.</p>
      <div className="rp-inline">
        <Field label="Over (km)" hint="0.5 to 50 km." error={errors.km}>
          <input className="input rp-num" inputMode="decimal" value={km} onChange={(e) => setKm(e.target.value)} />
        </Field>
        <Field label="Bonus (LKR)" error={errors.amount}>
          <input className="input rp-num" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
      </div>
      {error ? <p className="field__error">{error}</p> : null}
      <div className="form__actions">
        <button type="submit" className="button" disabled={saving}>
          {saving ? <Spinner label="Saving" /> : 'Save long distance'}
        </button>
      </div>
    </form>
  );
}
