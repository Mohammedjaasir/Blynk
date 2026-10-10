import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { settings as settingsApi } from '../api/resources';
import type { DayHours, DayKey, DeliverySlotSettings, StoreHoliday, StoreSchedule } from '../api/types';
import { errorMessage } from '../lib/apiErrors';
import {
  CLOSURE_REASONS,
  DAYS_AHEAD,
  DAYS_AHEAD_LABEL,
  DAY_KEYS,
  DAY_NAMES,
  LEAD_CHOICES,
  MAX_CLOSURE_REASON,
  MAX_HOLIDAYS,
  MAX_HOLIDAY_REASON,
  MAX_SLOT_ORDERS,
  QUARTER_HOURS,
  REOPEN_DAYS,
  SLOT_LENGTHS,
  SLOT_LENGTH_LABEL,
  SMS_ON_CLOSED_DAYS_HINT,
  colomboDateKey,
  colomboToIso,
  dateKeyLabel,
  formatDateKey,
  formatHHMM,
  formatReopen,
  leadLabel,
  statusLine,
  upcomingDateKeys,
  validateHours,
} from '../lib/schedule';
import { ConfirmDialog, Field, Spinner, useToast } from './ui';

/**
 * Store schedule settings (owner, 2026-10-10: "make sure the timing will be
 * decided by ops and admin"): whether the store is open right now (with a
 * close-now switch), the regular opening hours, holidays, and scheduled
 * delivery slots - plus "Send offer/birthday texts on closed days" (owner,
 * 2026-10-10). One GET /admin/settings/store-schedule feeds all the panels;
 * every PATCH returns the whole schedule, which replaces it.
 */
export function StoreScheduleSettings() {
  const [schedule, setSchedule] = useState<StoreSchedule | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    settingsApi
      .getStoreSchedule()
      .then((s) => !cancelled && setSchedule(s))
      .catch((err) => !cancelled && setLoadError(errorMessage(err, 'Could not load the store schedule.')));
    return () => {
      cancelled = true;
    };
  }, []);

  if (loadError || !schedule) {
    return (
      <section className="panel" aria-label="Store schedule">
        <h2 className="panel__title">Store schedule</h2>
        {loadError ? <p className="field__error">{loadError}</p> : <Spinner label="Loading the store schedule" />}
      </section>
    );
  }
  return (
    <>
      <StoreClosurePanel schedule={schedule} onSaved={setSchedule} />
      <OpeningHoursPanel schedule={schedule} onSaved={setSchedule} />
      <HolidaysPanel schedule={schedule} onSaved={setSchedule} />
      <DeliverySlotsPanel schedule={schedule} onSaved={setSchedule} />
      <ClosedDaySmsPanel schedule={schedule} onSaved={setSchedule} />
    </>
  );
}

type PanelProps = { schedule: StoreSchedule; onSaved(next: StoreSchedule): void };

/** "HH:MM" from the API, tolerating a trailing ":SS". */
const hhmm = (value: string) => value.slice(0, 5);

/** A styled 15-minute select (no native time input - owner, 2026-10-10). */
function TimeSelect({
  value,
  onChange,
  label,
  disabled,
}: {
  value: string;
  onChange(value: string): void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <select
      className="input time-select"
      aria-label={label}
      value={hhmm(value)}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    >
      {QUARTER_HOURS.map((t) => (
        <option key={t} value={t}>
          {formatHHMM(t)}
        </option>
      ))}
    </select>
  );
}

/** Weekday key of a "YYYY-MM-DD" calendar day. */
const dayKeyOf = (dateKey: string): DayKey =>
  (['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const)[new Date(`${dateKey}T00:00:00.000Z`).getUTCDay()]!;

// ------------------------------------------------------------- close now

/**
 * The live status line and the "Close the store now" switch (owner,
 * 2026-10-10): a reason (typed or a quick chip) and an optional reopen time;
 * closing asks for confirmation, reopening is one click.
 */
function StoreClosurePanel({ schedule, onSaved }: PanelProps) {
  const toast = useToast();
  const { closure, status, hours } = schedule;
  const closedNow =
    closure.closed && (!closure.reopens_at || Date.parse(closure.reopens_at) > Date.now());
  const days = useMemo(() => upcomingDateKeys(REOPEN_DAYS), []);
  const tomorrow = days[1]!;
  const [closing, setClosing] = useState(false);
  const [reason, setReason] = useState('');
  const [reopenAt, setReopenAt] = useState(false);
  const [reopenDay, setReopenDay] = useState(tomorrow);
  const [reopenTime, setReopenTime] = useState(hhmm(hours.days[dayKeyOf(tomorrow)].open));
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [saving, setSaving] = useState(false);

  function startClosing(on: boolean) {
    setError(null);
    if (closedNow) {
      if (!on) void reopen();
      return;
    }
    setClosing(on);
  }

  function check(): { reason: string; reopens_at: string | null } | null {
    const text = reason.trim();
    if (!text) {
      setError('Say why the store is closed - customers see it.');
      return null;
    }
    if (text.length > MAX_CLOSURE_REASON) {
      setError(`The reason can be at most ${MAX_CLOSURE_REASON} characters.`);
      return null;
    }
    const at = reopenAt ? colomboToIso(reopenDay, reopenTime) : null;
    if (at && Date.parse(at) <= Date.now()) {
      setError('Pick a reopen time in the future.');
      return null;
    }
    setError(null);
    return { reason: text, reopens_at: at };
  }

  async function close() {
    const body = check();
    setConfirm(false);
    if (!body) return;
    setSaving(true);
    try {
      onSaved(await settingsApi.setStoreClosure({ closed: true, reason: body.reason, reopens_at: body.reopens_at }));
      setClosing(false);
      setReason('');
      toast.success('The store is closed.');
    } catch (err) {
      setError(errorMessage(err, 'Could not close the store.'));
    } finally {
      setSaving(false);
    }
  }

  async function reopen() {
    setSaving(true);
    try {
      onSaved(await settingsApi.setStoreClosure({ closed: false }));
      toast.success('The store is open again.');
    } catch (err) {
      setError(errorMessage(err, 'Could not reopen the store.'));
    } finally {
      setSaving(false);
    }
  }

  const pendingReopen = reopenAt ? colomboToIso(reopenDay, reopenTime) : null;

  return (
    <section className="panel" id="store-status" aria-label="Store status">
      <h2 className="panel__title">Store status</h2>
      <p className={`store-status ${status.is_open_now ? 'store-status--open' : 'store-status--closed'}`} role="status">
        {statusLine(status)}
      </p>
      <div className="form">
        <label className="toggle">
          <input
            type="checkbox"
            checked={closedNow || closing}
            disabled={saving}
            onChange={(e) => startClosing(e.target.checked)}
          />
          <span>
            Close the store now
            <em>
              {closedNow
                ? `Closed${closure.closed_at ? ` since ${formatReopen(closure.closed_at)}` : ''}. Switch off to open again.`
                : 'Stops new orders straight away, e.g. for rain. Opening hours stay as they are.'}
            </em>
          </span>
        </label>

        {!closedNow && closing ? (
          <form
            className="form store-close"
            noValidate
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              if (check()) setConfirm(true);
            }}
          >
            <Field label="Reason customers see" hint={`Up to ${MAX_CLOSURE_REASON} characters.`}>
              <input
                className="input"
                value={reason}
                maxLength={MAX_CLOSURE_REASON}
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
            <div className="specialty-chips" role="group" aria-label="Quick reasons">
              {CLOSURE_REASONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  className={reason.trim() === r ? 'specialty-chip is-selected' : 'specialty-chip'}
                  aria-pressed={reason.trim() === r}
                  onClick={() => setReason(r)}
                >
                  {r}
                </button>
              ))}
            </div>
            <div className="field">
              <span className="field__label" id="reopen-label">
                Open again
              </span>
              <div className="segmented" role="group" aria-labelledby="reopen-label">
                <button
                  type="button"
                  className={!reopenAt ? 'segmented__item is-selected' : 'segmented__item'}
                  aria-pressed={!reopenAt}
                  onClick={() => setReopenAt(false)}
                >
                  When staff reopen
                </button>
                <button
                  type="button"
                  className={reopenAt ? 'segmented__item is-selected' : 'segmented__item'}
                  aria-pressed={reopenAt}
                  onClick={() => setReopenAt(true)}
                >
                  At a set time
                </button>
              </div>
            </div>
            {reopenAt ? (
              <div className="form__row">
                <select
                  className="input time-select"
                  aria-label="Reopen day"
                  value={reopenDay}
                  onChange={(e) => setReopenDay(e.target.value)}
                >
                  {days.map((d) => (
                    <option key={d} value={d}>
                      {dateKeyLabel(d)}
                    </option>
                  ))}
                </select>
                <TimeSelect label="Reopen time" value={reopenTime} onChange={setReopenTime} />
              </div>
            ) : null}
            {error ? (
              <p className="field__error" role="alert">
                {error}
              </p>
            ) : null}
            <div className="form__actions">
              <button type="button" className="button button--ghost" disabled={saving} onClick={() => startClosing(false)}>
                Keep open
              </button>
              <button type="submit" className="button button--danger" disabled={saving}>
                {saving ? <Spinner label="Saving" /> : 'Close the store'}
              </button>
            </div>
          </form>
        ) : error ? (
          <p className="field__error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
      {confirm ? (
        <ConfirmDialog
          title="Close the store now"
          message={`Customers cannot order for delivery now${
            schedule.delivery_slots.enabled ? ' (they can still book a later slot)' : ''
          }. They see "${reason.trim()}". ${
            pendingReopen ? `The store opens again ${formatReopen(pendingReopen)}.` : 'It stays closed until staff reopen it.'
          }`}
          confirmLabel="Close the store"
          destructive
          onConfirm={() => void close()}
          onCancel={() => setConfirm(false)}
        />
      ) : null}
    </section>
  );
}

// --------------------------------------------------------- opening hours

function firstOpen(days: Record<DayKey, DayHours>): { open: string; close: string } {
  const day = DAY_KEYS.map((k) => days[k]).find((d) => !d.closed) ?? days.mon;
  return { open: hhmm(day.open), close: hhmm(day.close) };
}

/** Same hours every day, or a row per day with its own Closed switch (owner, 2026-10-10). */
function OpeningHoursPanel({ schedule, onSaved }: PanelProps) {
  const toast = useToast();
  const { hours } = schedule;
  const [same, setSame] = useState(hours.same_every_day);
  const [pair, setPair] = useState(firstOpen(hours.days));
  const [days, setDays] = useState<Record<DayKey, DayHours>>(hours.days);
  const [errors, setErrors] = useState<ReturnType<typeof validateHours>>({ days: {} });
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Re-sync only when the stored hours change, not on another panel's save.
  const stored = JSON.stringify(hours);
  useEffect(() => {
    setSame(hours.same_every_day);
    setPair(firstOpen(hours.days));
    setDays(hours.days);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stored]);

  function switchMode(nextSame: boolean) {
    if (nextSame === same) return;
    setErrors({ days: {} });
    if (nextSame) {
      setPair(firstOpen(days));
    } else {
      setDays(Object.fromEntries(DAY_KEYS.map((k) => [k, { closed: false, ...pair }])) as Record<DayKey, DayHours>);
    }
    setSame(nextSame);
  }

  const setDay = (key: DayKey, patch: Partial<DayHours>) => setDays((d) => ({ ...d, [key]: { ...d[key], ...patch } }));

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaveError(null);
    const found = validateHours(same, pair, days);
    setErrors(found);
    if (found.same || found.form || Object.keys(found.days).length > 0) return;
    setSaving(true);
    try {
      const next = await settingsApi.setStoreHours(
        same
          ? { same_every_day: true, open: pair.open, close: pair.close }
          : {
              same_every_day: false,
              days: Object.fromEntries(
                DAY_KEYS.map((k) => [k, { closed: days[k].closed, open: hhmm(days[k].open), close: hhmm(days[k].close) }])
              ) as Record<DayKey, DayHours>,
            }
      );
      onSaved(next);
      toast.success('Opening hours saved.');
    } catch (err) {
      setSaveError(errorMessage(err, 'Could not save the opening hours.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel" id="opening-hours" aria-label="Opening hours">
      <h2 className="panel__title">Opening hours</h2>
      <form className="form" onSubmit={save} noValidate>
        <p className="panel__body">
          Customers can order for delivery during these hours (Sri Lanka time).
          {hours.updated_at ? ` Changed ${new Date(hours.updated_at).toLocaleString()}.` : ''}
        </p>
        <div className="segmented" role="group" aria-label="Hours mode">
          <button
            type="button"
            className={same ? 'segmented__item is-selected' : 'segmented__item'}
            aria-pressed={same}
            onClick={() => switchMode(true)}
          >
            Same hours every day
          </button>
          <button
            type="button"
            className={!same ? 'segmented__item is-selected' : 'segmented__item'}
            aria-pressed={!same}
            onClick={() => switchMode(false)}
          >
            Different per day
          </button>
        </div>

        {same ? (
          <div className="field">
            <div className="hours-pair">
              <TimeSelect label="Opens" value={pair.open} onChange={(open) => setPair((p) => ({ ...p, open }))} />
              <span className="hours-pair__to">to</span>
              <TimeSelect label="Closes" value={pair.close} onChange={(close) => setPair((p) => ({ ...p, close }))} />
            </div>
            {errors.same ? <span className="field__error">{errors.same}</span> : null}
          </div>
        ) : (
          <ul className="hours-days" aria-label="Hours per day">
            {DAY_KEYS.map((key) => {
              const day = days[key];
              const name = DAY_NAMES[key];
              return (
                <li key={key} className={`hours-day${day.closed ? ' hours-day--closed' : ''}`}>
                  <span className="hours-day__name">{name}</span>
                  <label className="hours-day__closed">
                    <input
                      type="checkbox"
                      checked={day.closed}
                      aria-label={`${name} closed`}
                      onChange={(e) => setDay(key, { closed: e.target.checked })}
                    />
                    <span>Closed</span>
                  </label>
                  <div className="hours-pair">
                    <TimeSelect
                      label={`${name} opens`}
                      value={day.open}
                      disabled={day.closed}
                      onChange={(open) => setDay(key, { open })}
                    />
                    <span className="hours-pair__to">to</span>
                    <TimeSelect
                      label={`${name} closes`}
                      value={day.close}
                      disabled={day.closed}
                      onChange={(close) => setDay(key, { close })}
                    />
                  </div>
                  {errors.days[key] ? <span className="field__error hours-day__error">{errors.days[key]}</span> : null}
                </li>
              );
            })}
          </ul>
        )}
        {errors.form ? (
          <p className="field__error" role="alert">
            {errors.form}
          </p>
        ) : null}
        {saveError ? (
          <p className="field__error" role="alert">
            {saveError}
          </p>
        ) : null}
        <div className="form__actions">
          <button type="submit" className="button" disabled={saving}>
            {saving ? <Spinner label="Saving" /> : 'Save hours'}
          </button>
        </div>
      </form>
    </section>
  );
}

// -------------------------------------------------------------- holidays

/** The next 12 months as "YYYY-MM" from this Colombo month. */
function upcomingMonths(today: string): string[] {
  const [y, m] = today.split('-').map(Number) as [number, number];
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 + i, 1));
    return d.toISOString().slice(0, 7);
  });
}

const MONTH_LABEL = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/** Days of a "YYYY-MM" month from `today` on, as "YYYY-MM-DD". */
function daysOfMonth(month: string, today: string): string[] {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: count }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`).filter((d) => d >= today);
}

/** Whole days off: add a date (+ optional reason) or remove one; the full list is saved (owner, 2026-10-10). */
function HolidaysPanel({ schedule, onSaved }: PanelProps) {
  const toast = useToast();
  const today = colomboDateKey();
  const months = useMemo(() => upcomingMonths(today), [today]);
  const [month, setMonth] = useState(months[0]!);
  const monthDays = daysOfMonth(month, today);
  const [date, setDate] = useState(monthDays[0] ?? today);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const holidays = schedule.holidays;

  function pickMonth(next: string) {
    setMonth(next);
    const first = daysOfMonth(next, today)[0];
    if (first) setDate(first);
  }

  async function saveList(next: StoreHoliday[], done: string) {
    setSaving(true);
    setError(null);
    try {
      onSaved(await settingsApi.setStoreHolidays([...next].sort((a, b) => a.date.localeCompare(b.date))));
      toast.success(done);
      return true;
    } catch (err) {
      setError(errorMessage(err, 'Could not save the holidays.'));
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function add(event: FormEvent) {
    event.preventDefault();
    const text = reason.trim();
    if (date < today) {
      setError('Pick today or a later day.');
      return;
    }
    if (holidays.some((h) => h.date === date)) {
      setError(`${formatDateKey(date)} is already a holiday.`);
      return;
    }
    if (holidays.length >= MAX_HOLIDAYS) {
      setError(`At most ${MAX_HOLIDAYS} holidays. Remove one first.`);
      return;
    }
    if (text.length > MAX_HOLIDAY_REASON) {
      setError(`The reason can be at most ${MAX_HOLIDAY_REASON} characters.`);
      return;
    }
    const added = await saveList([...holidays, { date, reason: text || null }], `${formatDateKey(date)} added as a holiday.`);
    if (added) setReason('');
  }

  return (
    <section className="panel" id="holidays" aria-label="Holidays">
      <h2 className="panel__title">Holidays</h2>
      <p className="panel__body">The store takes no delivery orders on these days.</p>
      {holidays.length === 0 ? (
        <p className="form__note">No holidays coming up.</p>
      ) : (
        <ul className="holiday-list" aria-label="Upcoming holidays">
          {holidays.map((h) => (
            <li key={h.date} className="holiday-list__row">
              <span className="holiday-list__date">{formatDateKey(h.date)}</span>
              <span className="holiday-list__reason">{h.reason ?? ''}</span>
              <button
                type="button"
                className="button button--ghost button--sm"
                disabled={saving}
                aria-label={`Remove ${formatDateKey(h.date)}`}
                onClick={() =>
                  void saveList(
                    holidays.filter((x) => x.date !== h.date),
                    `${formatDateKey(h.date)} removed.`
                  )
                }
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <form className="form holiday-add" onSubmit={add} noValidate>
        <div className="form__row">
          <select className="input time-select" aria-label="Holiday month" value={month} onChange={(e) => pickMonth(e.target.value)}>
            {months.map((m) => (
              <option key={m} value={m}>
                {MONTH_LABEL.format(new Date(`${m}-01T00:00:00.000Z`))}
              </option>
            ))}
          </select>
          <select className="input time-select" aria-label="Holiday day" value={date} onChange={(e) => setDate(e.target.value)}>
            {monthDays.map((d) => (
              <option key={d} value={d}>
                {formatDateKey(d)}
              </option>
            ))}
          </select>
        </div>
        <Field label="Reason (optional)" hint="e.g. Poya day. Customers see it.">
          <input className="input" value={reason} maxLength={MAX_HOLIDAY_REASON} onChange={(e) => setReason(e.target.value)} />
        </Field>
        {error ? (
          <p className="field__error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="form__actions">
          <button type="submit" className="button" disabled={saving}>
            {saving ? <Spinner label="Saving" /> : 'Add holiday'}
          </button>
        </div>
      </form>
    </section>
  );
}

// -------------------------------------------------------- delivery slots

/** Scheduled delivery slots - off by default (owner, 2026-10-10). */
function DeliverySlotsPanel({ schedule, onSaved }: PanelProps) {
  const toast = useToast();
  const stored = schedule.delivery_slots;
  const [form, setForm] = useState<DeliverySlotSettings>(stored);
  const [maxText, setMaxText] = useState(String(stored.max_orders_per_slot));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const key = JSON.stringify(stored);
  useEffect(() => {
    setForm(stored);
    setMaxText(String(stored.max_orders_per_slot));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const set = <K extends keyof DeliverySlotSettings>(k: K, v: DeliverySlotSettings[K]) => setForm((f) => ({ ...f, [k]: v }));
  const parsedMax = /^\d+$/.test(maxText.trim()) ? Number(maxText.trim()) : NaN;
  const step = (by: number) => {
    const base = Number.isFinite(parsedMax) ? parsedMax : stored.max_orders_per_slot;
    setMaxText(String(Math.min(MAX_SLOT_ORDERS, Math.max(1, base + by))));
  };

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!Number.isInteger(parsedMax) || parsedMax < 1 || parsedMax > MAX_SLOT_ORDERS) {
      setError(`Orders per slot must be a whole number from 1 to ${MAX_SLOT_ORDERS}.`);
      return;
    }
    setError(null);
    setSaving(true);
    try {
      onSaved(
        await settingsApi.setDeliverySlots({
          enabled: form.enabled,
          slot_minutes: form.slot_minutes,
          days_ahead: form.days_ahead,
          max_orders_per_slot: parsedMax,
          min_lead_minutes: form.min_lead_minutes,
        })
      );
      toast.success(form.enabled ? 'Delivery slots saved.' : 'Delivery slots are off.');
    } catch (err) {
      setError(errorMessage(err, 'Could not save the delivery slots.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel" id="delivery-slots" aria-label="Delivery slots">
      <h2 className="panel__title">Delivery slots</h2>
      <form className="form" onSubmit={save} noValidate>
        <label className="toggle">
          <input type="checkbox" checked={form.enabled} onChange={(e) => set('enabled', e.target.checked)} />
          <span>
            Let customers pick a delivery slot
            <em>
              They can book a later time, even while the store is closed (e.g. tonight for tomorrow morning). When off, orders
              are taken only while the store is open.
            </em>
          </span>
        </label>
        <fieldset className="slot-settings" disabled={!form.enabled}>
          <div className="field">
            <span className="field__label" id="slot-length-label">
              Slot length
            </span>
            <div className="segmented" role="group" aria-labelledby="slot-length-label">
              {SLOT_LENGTHS.map((m) => (
                <button
                  key={m}
                  type="button"
                  className={form.slot_minutes === m ? 'segmented__item is-selected' : 'segmented__item'}
                  aria-pressed={form.slot_minutes === m}
                  onClick={() => set('slot_minutes', m)}
                >
                  {SLOT_LENGTH_LABEL[m]}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <span className="field__label" id="days-ahead-label">
              Book ahead
            </span>
            <div className="segmented" role="group" aria-labelledby="days-ahead-label">
              {DAYS_AHEAD.map((d) => (
                <button
                  key={d}
                  type="button"
                  className={form.days_ahead === d ? 'segmented__item is-selected' : 'segmented__item'}
                  aria-pressed={form.days_ahead === d}
                  onClick={() => set('days_ahead', d)}
                >
                  {DAYS_AHEAD_LABEL[d]}
                </button>
              ))}
            </div>
            <span className="field__hint">Today plus this many days. 1 day = today and tomorrow.</span>
          </div>
          <div className="field">
            <span className="field__label" id="slot-max-label">
              Orders per slot
            </span>
            <div className="stepper" role="group" aria-labelledby="slot-max-label">
              <button type="button" className="stepper__button" aria-label="Fewer orders per slot" onClick={() => step(-1)}>
                −
              </button>
              <input
                className="input stepper__value"
                inputMode="numeric"
                aria-label="Orders per slot"
                value={maxText}
                onChange={(e) => setMaxText(e.target.value)}
              />
              <button type="button" className="stepper__button" aria-label="More orders per slot" onClick={() => step(1)}>
                +
              </button>
            </div>
            <span className="field__hint">A full slot is not offered any more. 1 to {MAX_SLOT_ORDERS}.</span>
          </div>
          <Field label="Earliest slot from now" hint="The first slot offered starts at least this long after the order.">
            <select
              className="input time-select"
              value={form.min_lead_minutes}
              onChange={(e) => set('min_lead_minutes', Number(e.target.value))}
            >
              {LEAD_CHOICES.map((m) => (
                <option key={m} value={m}>
                  {leadLabel(m)}
                </option>
              ))}
            </select>
          </Field>
        </fieldset>
        {error ? (
          <p className="field__error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="form__actions">
          <button type="submit" className="button" disabled={saving}>
            {saving ? <Spinner label="Saving" /> : 'Save slots'}
          </button>
        </div>
      </form>
    </section>
  );
}

// ------------------------------------------------------ texts on closed days

/**
 * "Send offer/birthday texts on closed days" (owner, 2026-10-10: "give all
 * the options to control to ops and admin"). On (the default) keeps the old
 * rule; off holds offer, test and birthday SMS while the store is closed.
 */
function ClosedDaySmsPanel({ schedule, onSaved }: PanelProps) {
  const toast = useToast();
  const stored = schedule.sms?.sms_on_closed_days ?? true;
  const [on, setOn] = useState(stored);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => setOn(stored), [stored]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (on === stored) {
      toast.success('Nothing changed.');
      return;
    }
    setError(null);
    setSaving(true);
    try {
      onSaved(await settingsApi.setStoreSms({ sms_on_closed_days: on }));
      toast.success(on ? 'Texts go out on closed days too.' : 'No texts on closed days.');
    } catch (err) {
      setError(errorMessage(err, 'Could not save the text setting.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel" id="closed-day-sms" aria-label="Texts on closed days">
      <h2 className="panel__title">Texts on closed days</h2>
      <form className="form" onSubmit={save} noValidate>
        <label className="toggle">
          <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} />
          <span>
            Send offer/birthday texts on closed days
            <em>{on ? SMS_ON_CLOSED_DAYS_HINT.on : SMS_ON_CLOSED_DAYS_HINT.off}</em>
          </span>
        </label>
        {schedule.sms?.updated_at ? <p className="form__note">Changed {new Date(schedule.sms.updated_at).toLocaleString()}.</p> : null}
        {error ? (
          <p className="field__error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="form__actions">
          <button type="submit" className="button" disabled={saving}>
            {saving ? <Spinner label="Saving" /> : 'Save'}
          </button>
        </div>
      </form>
    </section>
  );
}
