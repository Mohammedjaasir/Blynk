import { useEffect, useState, type FormEvent } from 'react';
import { settings } from '../api/resources';
import type { BoostMode, DailyTargetTier, DistanceMode, PayModel, PeakWindow, RiderPayModelInput, RiderPaySettings } from '../api/types';
import { PageHeader } from '../components/Layout';
import { KmTierEditor, TierModeChoice } from '../components/KmTierEditor';
import { Switch } from '../components/RiderDocuments';
import { Spinner } from '../components/ui';
import '../components/rider-pay.css';
import { catalogErrorMessage } from '../lib/catalog';
import { linearToRows, parseTierRows, tiersToRows } from '../lib/kmTiers';
import { formatMoney } from '../lib/orders';
import {
  BOOST_MODE_LABEL,
  DISTANCE_MODE_OPTIONS,
  MAX_DAILY_TIERS,
  MAX_PAY_LKR,
  MAX_PEAK_WINDOWS,
  MAX_PER_KM_LKR,
  PAY_MODELS,
  PAY_MODEL_LABEL,
  RAIN_AUTO_OFF,
  WEEKDAYS,
  boostText,
  colomboClock,
  describePay,
  distanceModeOf,
  numberText,
  parseAmount,
  parseBoost,
  parseCommissionPercent,
  rainAutoOffAt,
  type RainAutoOff,
} from '../lib/riderPay';
import { formatHhmm } from '../lib/slots';
import { TIME_OPTIONS } from '../lib/storeSchedule';

/**
 * More -> Rider pay (owner, 2026-10-10: "give the option in ops and admin to
 * control the rider app charges"). One read of GET /admin/settings/rider-pay
 * feeds every card; each card saves through its own PATCH (model / bonuses /
 * rain-boost), and every PATCH returns the whole settings object, so the
 * screen always shows the server's own numbers.
 *
 * - Rain boost: one prominent switch with the amount and an auto-off (1 h /
 *   2 h / 3 h / until staff turn it off).
 * - Store default pay: % of the delivery fee, fixed LKR per delivery, or
 *   distance (base + LKR per km, or per-km tiers - owner, 2026-10-10), with
 *   an optional minimum per delivery.
 *   Riders on "Store default" follow it; a rider's own model is set in
 *   Riders -> Change pay.
 * - Bonuses: company riders switch, peak boost (time windows), daily
 *   targets (up to 5, each pays once when reached), long distance.
 * Times use the app's styled 15-minute lists and chips, never a bare native
 * time input (owner dislikes those).
 */
export function RiderPay() {
  const [data, setData] = useState<RiderPaySettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    settings.riderPay
      .get()
      .then(setData)
      .catch((err) => setLoadError(catalogErrorMessage(err)));
  }, []);

  return (
    <div className="page">
      <PageHeader title="Rider pay" description="What riders earn per delivery, boosts and bonuses." />
      <section className="card" aria-labelledby="rpay-how-title">
        <h2 className="section-label" id="rpay-how-title">
          How rider pay works
        </h2>
        <ul className="rpay-explain">
          <li>Each delivery pays a base: the pay model below (or the rider&apos;s own), never less than the minimum if you set one.</li>
          <li>Boosts add to that base: peak hours, rain and long distance.</li>
          <li>Each daily target pays once, when the rider reaches it that day.</li>
          <li>
            Bonuses and adjustments are kept from that day&apos;s cash. Anything the cash cannot cover is owed to the rider by Blynk.
          </li>
        </ul>
      </section>
      {loadError ? (
        <p className="field__error" role="alert">
          {loadError}
        </p>
      ) : !data ? (
        <Spinner label="Loading rider pay" />
      ) : (
        <>
          <RainBoostCard data={data} onSaved={setData} />
          <DefaultModelCard data={data} onSaved={setData} />
          <CompanyRidersCard data={data} onSaved={setData} />
          <PeakCard data={data} onSaved={setData} />
          <DailyTargetCard data={data} onSaved={setData} />
          <LongDistanceCard data={data} onSaved={setData} />
        </>
      )}
    </div>
  );
}

type CardProps = { data: RiderPaySettings; onSaved(s: RiderPaySettings): void };

// ------------------------------------------------------------- controls
function Segmented<T extends string>({
  label,
  options,
  value,
  onPick,
}: {
  label: string;
  options: ReadonlyArray<{ id: T; text: string }>;
  value: T;
  onPick(id: T): void;
}) {
  return (
    <div className="segmented rpay-segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          className={o.id === value ? 'segmented__item is-selected' : 'segmented__item'}
          aria-pressed={o.id === value}
          onClick={() => onPick(o.id)}
        >
          {o.text}
        </button>
      ))}
    </div>
  );
}

const BOOST_MODES: ReadonlyArray<{ id: BoostMode; text: string }> = [
  { id: 'FIXED', text: BOOST_MODE_LABEL.FIXED },
  { id: 'PERCENT', text: BOOST_MODE_LABEL.PERCENT },
];

function TimeSelect({ label, value, end, onChange }: { label: string; value: string; end?: boolean; onChange(v: string): void }) {
  const base = end ? [...TIME_OPTIONS.slice(1), '24:00'] : TIME_OPTIONS;
  const options = base.includes(value) ? base : [value, ...base];
  return (
    <select className="input pick-select" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((t) => (
        <option key={t} value={t}>
          {t === '24:00' ? 'Midnight' : formatHhmm(t)}
        </option>
      ))}
    </select>
  );
}

function Feedback({ error, notice }: { error: string | null; notice: string | null }) {
  return (
    <>
      {error ? (
        <p className="field__error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="quiet quiet--ok" role="status">
          {notice}
        </p>
      ) : null}
    </>
  );
}

// ------------------------------------------------------------ rain boost
function RainBoostCard({ data, onSaved }: CardProps) {
  const rain = data.rain_boost;
  const [mode, setMode] = useState<BoostMode>(rain.mode);
  const [amount, setAmount] = useState(numberText(rain.amount));
  const [autoOff, setAutoOff] = useState<RainAutoOff>('2h');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function turnOn() {
    const parsed = parseBoost(mode, amount);
    if ('error' in parsed) {
      setError(parsed.error);
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const s = await settings.riderPay.updateRainBoost({ on: true, mode, amount: parsed.value, auto_off_at: rainAutoOffAt(autoOff) });
      onSaved(s);
      setNotice(`Rain boost is on: ${boostText(s.rain_boost.mode, s.rain_boost.amount)} per delivery.`);
    } catch (err) {
      setError(catalogErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function turnOff() {
    setError(null);
    setSaving(true);
    try {
      onSaved(await settings.riderPay.updateRainBoost({ on: false }));
      setNotice('Rain boost is off.');
    } catch (err) {
      setError(catalogErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={rain.active ? 'card rpay-rain is-on' : 'card rpay-rain'} aria-labelledby="rpay-rain-title">
      <div className="settings-head">
        <h2 className="section-label" id="rpay-rain-title">
          Rain boost
        </h2>
        <Switch
          label="Rain boost"
          checked={rain.active}
          disabled={saving}
          onToggle={() => {
            setNotice(null);
            void (rain.active ? turnOff() : turnOn());
          }}
        />
      </div>
      <p className="rpay-rain__status" data-testid="rain-status" aria-live="polite">
        {rain.active
          ? `On · ${boostText(rain.mode, rain.amount)} per delivery · ${
              rain.auto_off_at ? `turns off at ${colomboClock(rain.auto_off_at)}` : 'until you turn it off'
            }`
          : 'Off. Turn it on when it rains - riders see the boost in their app.'}
      </p>
      <Segmented<BoostMode> label="Rain boost type" options={BOOST_MODES} value={mode} onPick={setMode} />
      <label className="field">
        <span className="field__label">{mode === 'PERCENT' ? 'Boost (% of base pay)' : 'Boost (LKR per delivery)'}</span>
        <input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </label>
      <div className="field">
        <span className="field__label" id="rpay-rain-off-label">
          Turns off by itself
        </span>
        <div className="specialty-chips" role="group" aria-labelledby="rpay-rain-off-label">
          {RAIN_AUTO_OFF.map((o) => (
            <button
              key={o.id}
              type="button"
              className={o.id === autoOff ? 'specialty-chip is-selected' : 'specialty-chip'}
              aria-pressed={o.id === autoOff}
              onClick={() => setAutoOff(o.id)}
            >
              {o.id === 'none' ? o.text : `After ${o.text}`}
            </button>
          ))}
        </div>
      </div>
      {rain.active ? (
        <button type="button" className="button button--ghost" disabled={saving} onClick={() => void turnOn()}>
          Update rain boost
        </button>
      ) : null}
      <Feedback error={error} notice={notice} />
    </section>
  );
}

// ---------------------------------------------------- store default model
function DefaultModelCard({ data, onSaved }: CardProps) {
  const def = data.default_model;
  const [model, setModel] = useState<PayModel>(def.model);
  const [percent, setPercent] = useState(numberText(def.percent));
  const [fixed, setFixed] = useState(numberText(def.fixed_lkr));
  const [base, setBase] = useState(numberText(def.base_lkr));
  const [perKm, setPerKm] = useState(numberText(def.per_km_lkr));
  const [min, setMin] = useState(numberText(def.min_lkr));
  // Owner, 2026-10-10: distance pay by base + per km, or per-km tiers.
  const [distanceMode, setDistanceMode] = useState<DistanceMode>(distanceModeOf(def));
  const [tierRows, setTierRows] = useState<string[]>(tiersToRows(def.km_tiers));
  const [tierErrors, setTierErrors] = useState<(string | undefined)[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(event: FormEvent) {
    event.preventDefault();
    setNotice(null);
    setTierErrors([]);
    const body: RiderPayModelInput = { model, min_lkr: null };
    if (model === 'PERCENT') {
      const p = parseCommissionPercent(percent);
      if ('error' in p) return setError(p.error);
      body.percent = p.value;
    } else if (model === 'FIXED') {
      const f = parseAmount(fixed, { max: MAX_PAY_LKR, what: 'the LKR per delivery' });
      if ('error' in f) return setError(f.error);
      body.fixed_lkr = f.value ?? 0;
    } else if (distanceMode === 'TIERS') {
      const t = parseTierRows(tierRows);
      if ('error' in t) {
        setTierErrors(t.rowErrors);
        return setError(t.error);
      }
      body.distance_mode = 'TIERS';
      body.km_tiers = t.tiers;
    } else {
      const b = parseAmount(base, { max: MAX_PAY_LKR, what: 'the base LKR' });
      if ('error' in b) return setError(b.error);
      const k = parseAmount(perKm, { max: MAX_PER_KM_LKR, what: 'the LKR per km' });
      if ('error' in k) return setError(k.error);
      body.distance_mode = 'LINEAR';
      body.base_lkr = b.value ?? 0;
      body.per_km_lkr = k.value ?? 0;
    }
    const m = parseAmount(min, { max: MAX_PAY_LKR, optional: true });
    if ('error' in m) return setError(`Minimum: ${m.error}`);
    body.min_lkr = m.value;
    setError(null);
    setSaving(true);
    try {
      const s = await settings.riderPay.updateModel(body);
      onSaved(s);
      setNotice(`Store default saved: ${describePay(s.default_model)}.`);
    } catch (err) {
      setError(catalogErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card" aria-labelledby="rpay-model-title">
      <h2 className="section-label" id="rpay-model-title">
        Store default pay
      </h2>
      <p className="quiet">Now: {describePay(def)}. Riders on &quot;Store default&quot; follow this; set a rider&apos;s own pay in Riders.</p>
      <form className="form" onSubmit={save} noValidate>
        <Segmented<PayModel>
          label="Pay model"
          options={PAY_MODELS.map((m) => ({ id: m, text: PAY_MODEL_LABEL[m] }))}
          value={model}
          onPick={setModel}
        />
        {model === 'PERCENT' ? (
          <div className="field">
            <label className="field rpay-label">
              <span className="field__label">% of the delivery fee</span>
              <input className="input" inputMode="decimal" value={percent} onChange={(e) => setPercent(e.target.value)} />
            </label>
            <span className="field__hint">Share of the standard delivery fee, 0 to 100.</span>
          </div>
        ) : null}
        {model === 'FIXED' ? (
          <div className="field">
            <label className="field rpay-label">
              <span className="field__label">LKR per delivery</span>
              <input className="input" inputMode="decimal" value={fixed} onChange={(e) => setFixed(e.target.value)} />
            </label>
            <span className="field__hint">The same amount for every delivery.</span>
          </div>
        ) : null}
        {model === 'DISTANCE' ? (
          <TierModeChoice<DistanceMode>
            label="Distance pay"
            options={DISTANCE_MODE_OPTIONS}
            value={distanceMode}
            onPick={(next) => {
              setDistanceMode(next);
              setTierErrors([]);
              // No tiers stored yet: start with rows that pay what base + per km pays.
              if (next === 'TIERS' && tierRows.length === 0) setTierRows(linearToRows(Number(base) || 0, Number(perKm) || 0));
            }}
          />
        ) : null}
        {model === 'DISTANCE' && distanceMode === 'TIERS' ? (
          <KmTierEditor
            label="Pay per km"
            rows={tierRows}
            onChange={(next) => {
              setTierRows(next);
              setTierErrors([]);
            }}
            rowErrors={tierErrors}
            note="Road distance, store to drop-off. No maximum; the minimum below still applies."
          />
        ) : null}
        {model === 'DISTANCE' && distanceMode === 'LINEAR' ? (
          <div className="rpay-row">
            <label className="field">
              <span className="field__label">Base LKR per delivery</span>
              <input className="input" inputMode="decimal" value={base} onChange={(e) => setBase(e.target.value)} />
            </label>
            <div className="field">
              <label className="field rpay-label">
                <span className="field__label">LKR per km</span>
                <input className="input" inputMode="decimal" value={perKm} onChange={(e) => setPerKm(e.target.value)} />
              </label>
              <span className="field__hint">Road distance, store to drop-off.</span>
            </div>
          </div>
        ) : null}
        <div className="field">
          <label className="field rpay-label">
            <span className="field__label">Minimum per delivery (LKR, optional)</span>
            <input className="input" inputMode="decimal" value={min} onChange={(e) => setMin(e.target.value)} />
          </label>
          <span className="field__hint">Blank = no minimum. A delivery never pays less than this.</span>
        </div>
        <button type="submit" className="button" disabled={saving}>
          {saving ? <Spinner label="Saving" /> : 'Save default pay'}
        </button>
      </form>
      <Feedback error={error} notice={notice} />
    </section>
  );
}

// -------------------------------------------------------- company riders
function CompanyRidersCard({ data, onSaved }: CardProps) {
  const on = data.bonus_rules.company_riders;
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function toggle() {
    setNotice(null);
    setError(null);
    setSaving(true);
    try {
      const s = await settings.riderPay.updateBonuses({ company_riders: !on });
      onSaved(s);
      setNotice(s.bonus_rules.company_riders ? 'Company riders now get bonuses too.' : 'Bonuses are for commission riders only.');
    } catch (err) {
      setError(catalogErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card" aria-labelledby="rpay-company-title">
      <div className="settings-head">
        <h2 className="section-label" id="rpay-company-title">
          Bonuses for company riders
        </h2>
        <Switch label="Bonuses for company riders" checked={on} disabled={saving} onToggle={() => void toggle()} />
      </div>
      <p className="quiet">
        {on
          ? 'Company riders get peak, rain, daily target and long distance bonuses too.'
          : 'Off: peak, rain, daily target and long distance bonuses are for commission riders only.'}
      </p>
      <Feedback error={error} notice={notice} />
    </section>
  );
}

// ------------------------------------------------------------ peak boost
const NEW_WINDOW: PeakWindow = { days: [1, 2, 3, 4, 5, 6, 7], start: '18:00', end: '21:00' };

function PeakCard({ data, onSaved }: CardProps) {
  const peak = data.bonus_rules.peak;
  const [enabled, setEnabled] = useState(peak.enabled);
  const [mode, setMode] = useState<BoostMode>(peak.mode);
  const [amount, setAmount] = useState(numberText(peak.amount));
  const [windows, setWindows] = useState<PeakWindow[]>(peak.windows.map((w) => ({ ...w, days: [...w.days] })));
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const setWindow = (i: number, patch: Partial<PeakWindow>) =>
    setWindows((list) => list.map((w, j) => (j === i ? { ...w, ...patch } : w)));

  async function save(event: FormEvent) {
    event.preventDefault();
    setNotice(null);
    const parsed = parseBoost(mode, amount);
    if ('error' in parsed) return setError(parsed.error);
    for (const [i, w] of windows.entries()) {
      if (w.days.length === 0) return setError(`Window ${i + 1}: pick at least one day.`);
      if (w.start >= w.end) return setError(`Window ${i + 1}: the end must be after the start.`);
    }
    if (enabled && windows.length === 0) return setError('Add at least one time window.');
    setError(null);
    setSaving(true);
    try {
      const s = await settings.riderPay.updateBonuses({
        peak: {
          enabled,
          mode,
          amount: parsed.value,
          windows: windows.map((w) => ({ days: [...w.days].sort((a, b) => a - b), start: w.start, end: w.end })),
        },
      });
      onSaved(s);
      setNotice(s.bonus_rules.peak.enabled ? 'Peak boost saved.' : 'Peak boost is off.');
    } catch (err) {
      setError(catalogErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card" aria-labelledby="rpay-peak-title">
      <div className="settings-head">
        <h2 className="section-label" id="rpay-peak-title">
          Peak boost
        </h2>
        <Switch label="Peak boost" checked={enabled} onToggle={() => setEnabled((v) => !v)} />
      </div>
      <p className="quiet">Extra on every delivery finished inside these hours (Sri Lanka time). Save to apply.</p>
      <form className="form" onSubmit={save} noValidate>
        <Segmented<BoostMode> label="Peak boost type" options={BOOST_MODES} value={mode} onPick={setMode} />
        <label className="field">
          <span className="field__label">{mode === 'PERCENT' ? 'Peak boost (% of base pay)' : 'Peak boost (LKR per delivery)'}</span>
          <input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <ul className="rpay-windows" aria-label="Peak windows">
          {windows.map((w, i) => (
            <li key={i} className="rpay-window" aria-label={`Window ${i + 1}`}>
              <div className="specialty-chips rpay-days" role="group" aria-label={`Window ${i + 1} days`}>
                {WEEKDAYS.map((d) => {
                  const on = w.days.includes(d.day);
                  return (
                    <button
                      key={d.day}
                      type="button"
                      className={on ? 'specialty-chip is-selected' : 'specialty-chip'}
                      aria-pressed={on}
                      aria-label={d.name}
                      onClick={() => setWindow(i, { days: on ? w.days.filter((x) => x !== d.day) : [...w.days, d.day] })}
                    >
                      {d.short}
                    </button>
                  );
                })}
              </div>
              <div className="rpay-window__times">
                <TimeSelect label={`Window ${i + 1} starts`} value={w.start} onChange={(v) => setWindow(i, { start: v })} />
                <span aria-hidden="true">to</span>
                <TimeSelect label={`Window ${i + 1} ends`} value={w.end} end onChange={(v) => setWindow(i, { end: v })} />
                <button
                  type="button"
                  className="button button--sm button--ghost"
                  aria-label={`Remove window ${i + 1}`}
                  onClick={() => setWindows((list) => list.filter((_, j) => j !== i))}
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
        <button
          type="button"
          className="button button--ghost"
          disabled={windows.length >= MAX_PEAK_WINDOWS}
          onClick={() => setWindows((list) => [...list, { ...NEW_WINDOW, days: [...NEW_WINDOW.days] }])}
        >
          Add time window
        </button>
        <button type="submit" className="button" disabled={saving}>
          {saving ? <Spinner label="Saving" /> : 'Save peak boost'}
        </button>
      </form>
      <Feedback error={error} notice={notice} />
    </section>
  );
}

// ---------------------------------------------------------- daily target
type TierDraft = { deliveries: string; amount: string };

function DailyTargetCard({ data, onSaved }: CardProps) {
  const rule = data.bonus_rules.daily_target;
  const [enabled, setEnabled] = useState(rule.enabled);
  const [tiers, setTiers] = useState<TierDraft[]>(
    rule.tiers.map((t) => ({ deliveries: String(t.deliveries), amount: numberText(t.amount_lkr) }))
  );
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const setTier = (i: number, patch: Partial<TierDraft>) => setTiers((list) => list.map((t, j) => (j === i ? { ...t, ...patch } : t)));

  function addTier() {
    const last = tiers.reduce((m, t) => Math.max(m, Number(t.deliveries) || 0), 0);
    setTiers((list) => [...list, { deliveries: String(Math.min(100, last ? last + 5 : 10)), amount: '' }]);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setNotice(null);
    const out: DailyTargetTier[] = [];
    for (const [i, t] of tiers.entries()) {
      const d = t.deliveries.trim();
      if (!/^\d+$/.test(d) || Number(d) < 1 || Number(d) > 100) return setError(`Target ${i + 1}: deliveries must be a whole number from 1 to 100.`);
      const a = parseAmount(t.amount, { max: MAX_PAY_LKR, positive: true, what: 'the bonus' });
      if ('error' in a) return setError(`Target ${i + 1}: ${a.error}`);
      out.push({ deliveries: Number(d), amount_lkr: a.value ?? 0 });
    }
    if (new Set(out.map((t) => t.deliveries)).size !== out.length) return setError('Two targets have the same number of deliveries.');
    if (enabled && out.length === 0) return setError('Add at least one target.');
    setError(null);
    setSaving(true);
    try {
      const s = await settings.riderPay.updateBonuses({
        daily_target: { enabled, tiers: out.sort((a, b) => a.deliveries - b.deliveries) },
      });
      onSaved(s);
      setTiers(s.bonus_rules.daily_target.tiers.map((t) => ({ deliveries: String(t.deliveries), amount: numberText(t.amount_lkr) })));
      setNotice(s.bonus_rules.daily_target.enabled ? 'Daily targets saved.' : 'Daily targets are off.');
    } catch (err) {
      setError(catalogErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card" aria-labelledby="rpay-target-title">
      <div className="settings-head">
        <h2 className="section-label" id="rpay-target-title">
          Daily target
        </h2>
        <Switch label="Daily target" checked={enabled} onToggle={() => setEnabled((v) => !v)} />
      </div>
      <p className="quiet">
        Each target pays once, when the rider reaches that many deliveries in a day. Reaching a higher target also pays the lower
        ones. Up to {MAX_DAILY_TIERS}. Save to apply.
      </p>
      <form className="form" onSubmit={save} noValidate>
        {tiers.length ? (
          <ul className="rpay-tiers" aria-label="Daily targets">
            {tiers.map((t, i) => (
              <li key={i} className="rpay-tier">
                <label className="field">
                  <span className="field__label">Target {i + 1}: deliveries</span>
                  <input className="input" inputMode="numeric" value={t.deliveries} onChange={(e) => setTier(i, { deliveries: e.target.value })} />
                </label>
                <label className="field">
                  <span className="field__label">Target {i + 1}: bonus (LKR)</span>
                  <input className="input" inputMode="decimal" value={t.amount} onChange={(e) => setTier(i, { amount: e.target.value })} />
                </label>
                <button
                  type="button"
                  className="button button--sm button--ghost rpay-remove"
                  aria-label={`Remove target ${i + 1}`}
                  onClick={() => setTiers((list) => list.filter((_, j) => j !== i))}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <button type="button" className="button button--ghost" disabled={tiers.length >= MAX_DAILY_TIERS} onClick={addTier}>
          Add target
        </button>
        <button type="submit" className="button" disabled={saving}>
          {saving ? <Spinner label="Saving" /> : 'Save daily target'}
        </button>
      </form>
      <Feedback error={error} notice={notice} />
    </section>
  );
}

// --------------------------------------------------------- long distance
function LongDistanceCard({ data, onSaved }: CardProps) {
  const rule = data.bonus_rules.long_distance;
  const [enabled, setEnabled] = useState(rule.enabled);
  const [overKm, setOverKm] = useState(numberText(rule.over_km));
  const [amount, setAmount] = useState(numberText(rule.amount_lkr));
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(event: FormEvent) {
    event.preventDefault();
    setNotice(null);
    const km = parseAmount(overKm, { min: 0.5, max: 50, decimals: 1, what: 'the distance' });
    if ('error' in km) return setError(`Distance: ${km.error}`);
    const a = parseAmount(amount, { max: MAX_PAY_LKR, what: 'the bonus' });
    if ('error' in a) return setError(`Bonus: ${a.error}`);
    setError(null);
    setSaving(true);
    try {
      const s = await settings.riderPay.updateBonuses({
        long_distance: { enabled, over_km: km.value ?? 0.5, amount_lkr: a.value ?? 0 },
      });
      onSaved(s);
      const r = s.bonus_rules.long_distance;
      setNotice(r.enabled ? `Long distance saved: ${formatMoney(r.amount_lkr)} over ${numberText(r.over_km)} km.` : 'Long distance bonus is off.');
    } catch (err) {
      setError(catalogErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card" aria-labelledby="rpay-long-title">
      <div className="settings-head">
        <h2 className="section-label" id="rpay-long-title">
          Long distance
        </h2>
        <Switch label="Long distance" checked={enabled} onToggle={() => setEnabled((v) => !v)} />
      </div>
      <p className="quiet">Extra on a delivery whose road distance from the store is over this. Save to apply.</p>
      <form className="form" onSubmit={save} noValidate>
        <div className="rpay-row">
          <div className="field">
            <label className="field rpay-label">
              <span className="field__label">Over (km)</span>
              <input className="input" inputMode="decimal" value={overKm} onChange={(e) => setOverKm(e.target.value)} />
            </label>
            <span className="field__hint">0.5 to 50 km.</span>
          </div>
          <label className="field">
            <span className="field__label">Bonus (LKR)</span>
            <input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
        </div>
        <button type="submit" className="button" disabled={saving}>
          {saving ? <Spinner label="Saving" /> : 'Save long distance'}
        </button>
      </form>
      <Feedback error={error} notice={notice} />
    </section>
  );
}
