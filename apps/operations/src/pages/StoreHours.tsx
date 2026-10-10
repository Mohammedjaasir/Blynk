import { useEffect, useId, useMemo, useState, type FormEvent } from 'react';
import { settings } from '../api/resources';
import type { DayHours, DayKey, StoreHoliday, StoreSchedule } from '../api/types';
import { PageHeader } from '../components/Layout';
import { ConfirmDialog, EmptyState, Spinner } from '../components/ui';
import { catalogErrorMessage } from '../lib/catalog';
import { formatDateTime } from '../lib/inventory';
import { addDays, colomboDate, colomboInstant, dayLabelForDate, formatHhmm, formatMoment, formatSlotDate } from '../lib/slots';
import {
  DAYS_AHEAD_CHOICES,
  DAY_KEYS,
  DAY_NAMES,
  LEAD_STEP,
  MAX_CLOSURE_REASON,
  MAX_HOLIDAYS,
  MAX_HOLIDAY_REASON,
  MAX_LEAD_MINUTES,
  MAX_ORDERS_PER_SLOT,
  MAX_REOPEN_DAYS,
  MIN_ORDERS_PER_SLOT,
  SLOT_MINUTE_CHOICES,
  SMS_ON_CLOSED_DAYS_HINT,
  TIME_OPTIONS,
  buildHoursBody,
  daysAheadLabel,
  firstOpenPair,
  leadLabel,
  nextOpeningAfterToday,
  reopenError,
  slotLengthLabel,
  statusLine,
} from '../lib/storeSchedule';

/**
 * More -> Opening hours (owner, 2026-10-10: "make sure the timing will be
 * decided by ops and admin"). One read of GET /admin/settings/store-schedule
 * feeds the cards - close the store now, opening hours, holidays, delivery
 * slots and "Send offer/birthday texts on closed days" (owner, 2026-10-10) -
 * and each card's PATCH returns the whole schedule, so the
 * status line at the top is always the server's own. Times are picked from
 * styled 15-minute lists, chips and steppers, never a bare native time input
 * (owner dislikes those).
 */
export function StoreHours() {
  const [schedule, setSchedule] = useState<StoreSchedule | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    settings.storeSchedule
      .get()
      .then(setSchedule)
      .catch((err) => setLoadError(catalogErrorMessage(err)));
  }, []);

  return (
    <div className="page">
      <PageHeader title="Opening hours" description="When customers can order, closing the store now, holidays and delivery slots." />
      {loadError ? (
        <p className="field__error">{loadError}</p>
      ) : !schedule ? (
        <Spinner label="Loading opening hours" />
      ) : (
        <>
          <p
            className={schedule.status.is_open_now ? 'store-status store-status--open' : 'store-status store-status--closed'}
            data-testid="store-status"
            aria-live="polite"
          >
            <span className="store-status__dot" aria-hidden="true" />
            {statusLine(schedule.status)}
          </p>
          <ClosureCard schedule={schedule} onSaved={setSchedule} />
          <HoursCard schedule={schedule} onSaved={setSchedule} />
          <HolidaysCard schedule={schedule} onSaved={setSchedule} />
          <DeliverySlotsCard schedule={schedule} onSaved={setSchedule} />
          <ClosedDaySmsCard schedule={schedule} onSaved={setSchedule} />
        </>
      )}
    </div>
  );
}

type CardProps = { schedule: StoreSchedule; onSaved(s: StoreSchedule): void };

// ------------------------------------------------------------- controls
/** A styled 15-minute list ("8:00 AM"), the app's own select look. */
function TimeSelect({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange(v: string): void;
  disabled?: boolean;
}) {
  const options = TIME_OPTIONS.includes(value) ? TIME_OPTIONS : [value, ...TIME_OPTIONS];
  return (
    <select className="input pick-select" aria-label={label} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      {options.map((t) => (
        <option key={t} value={t}>
          {formatHhmm(t)}
        </option>
      ))}
    </select>
  );
}

/** One bordered − value + control (the qty-stepper look). */
function Stepper({
  label,
  value,
  min,
  max,
  step = 1,
  format = String,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  format?(n: number): string;
  onChange(n: number): void;
}) {
  return (
    <div className="qty-stepper settings-stepper" role="group" aria-label={label}>
      <button
        type="button"
        className="qty-stepper__button"
        aria-label={`Less ${label.toLowerCase()}`}
        disabled={value - step < min}
        onClick={() => onChange(Math.max(min, value - step))}
      >
        −
      </button>
      <span className="qty-stepper__value settings-stepper__value" aria-live="polite">
        {format(value)}
      </span>
      <button
        type="button"
        className="qty-stepper__button"
        aria-label={`More ${label.toLowerCase()}`}
        disabled={value + step > max}
        onClick={() => onChange(Math.min(max, value + step))}
      >
        +
      </button>
    </div>
  );
}

function Switch({ label, checked, disabled, onToggle }: { label: string; checked: boolean; disabled?: boolean; onToggle(): void }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} className="switch" disabled={disabled} onClick={onToggle}>
      <span className="switch__thumb" aria-hidden="true" />
    </button>
  );
}

function Chips({
  label,
  options,
  value,
  onPick,
}: {
  label: string;
  options: ReadonlyArray<{ id: string; text: string }>;
  value: string | null;
  onPick(id: string): void;
}) {
  return (
    <div className="specialty-chips" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          className={o.id === value ? 'specialty-chip is-selected' : 'specialty-chip'}
          aria-pressed={o.id === value}
          onClick={() => onPick(o.id)}
        >
          {o.text}
        </button>
      ))}
    </div>
  );
}

/** The next `count` Colombo days from today as select options. */
function dayOptions(count: number, now = new Date()): Array<{ value: string; text: string }> {
  const today = colomboDate(now);
  return Array.from({ length: count }, (_, i) => {
    const ymd = addDays(today, i);
    const rel = dayLabelForDate(ymd, now);
    return { value: ymd, text: rel === 'Today' || rel === 'Tomorrow' ? `${rel} · ${formatSlotDate(colomboInstant(ymd, '12:00'))}` : rel };
  });
}

function Feedback({ error, notice, updatedAt }: { error: string | null; notice: string | null; updatedAt?: string | null }) {
  return (
    <>
      {error ? <p className="field__error" role="alert">{error}</p> : null}
      {notice ? <p className="quiet quiet--ok" role="status">{notice}</p> : null}
      {updatedAt ? <p className="quiet">Last changed {formatDateTime(updatedAt)}</p> : null}
    </>
  );
}

// ------------------------------------------------------- close the store
const REASON_CHIPS = ['Rain', 'Holiday', 'Stock-taking', 'Power cut', 'Staff shortage'];
type ReopenMode = 'none' | 'hour' | 'next' | 'pick';

function ClosureCard({ schedule, onSaved }: CardProps) {
  const reasonId = useId();
  const closedNow = schedule.status.closed_kind === 'CLOSED_NOW';
  const [closing, setClosing] = useState(false);
  const [reason, setReason] = useState('');
  const [mode, setMode] = useState<ReopenMode>('none');
  const [pickDay, setPickDay] = useState(() => addDays(colomboDate(new Date()), 1));
  const [pickTime, setPickTime] = useState('08:00');
  const [pending, setPending] = useState<{ reason: string; reopensAt: Date | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const nextOpening = useMemo(() => nextOpeningAfterToday(schedule.hours, schedule.holidays), [schedule.hours, schedule.holidays]);
  const pickDays = useMemo(() => dayOptions(MAX_REOPEN_DAYS), []);

  function reopenAt(now = new Date()): Date | null {
    if (mode === 'hour') return new Date(now.getTime() + 60 * 60_000);
    if (mode === 'next') return nextOpening;
    if (mode === 'pick') return colomboInstant(pickDay, pickTime);
    return null;
  }

  function askToClose(event: FormEvent) {
    event.preventDefault();
    setNotice(null);
    const text = reason.trim();
    if (!text) {
      setError('Write why the store is closing - customers see it.');
      return;
    }
    if (text.length > MAX_CLOSURE_REASON) {
      setError(`The reason can be at most ${MAX_CLOSURE_REASON} characters.`);
      return;
    }
    const at = reopenAt();
    const err = reopenError(at);
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    setPending({ reason: text, reopensAt: at });
  }

  async function close() {
    if (!pending) return;
    const { reason: text, reopensAt } = pending;
    setPending(null);
    setSaving(true);
    try {
      onSaved(await settings.storeSchedule.updateClosure({ closed: true, reason: text, reopens_at: reopensAt ? reopensAt.toISOString() : null }));
      setClosing(false);
      setReason('');
      setMode('none');
      setNotice('The store is closed. Customers cannot order until it reopens.');
    } catch (err) {
      setError(catalogErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function reopen() {
    setNotice(null);
    setError(null);
    setSaving(true);
    try {
      onSaved(await settings.storeSchedule.updateClosure({ closed: false }));
      setNotice('The store is open again.');
    } catch (err) {
      setError(catalogErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const reopenChips: Array<{ id: ReopenMode; text: string }> = [
    { id: 'none', text: 'Until I reopen' },
    { id: 'hour', text: 'In 1 hour' },
    ...(nextOpening ? [{ id: 'next' as const, text: formatMoment(nextOpening) }] : []),
    { id: 'pick', text: 'Pick' },
  ];

  return (
    <section className="card" aria-labelledby="closure-title">
      <div className="settings-head">
        <h2 className="section-label" id="closure-title">
          Close the store now
        </h2>
        <Switch
          label="Close the store now"
          checked={closedNow || closing}
          disabled={saving}
          onToggle={() => {
            setError(null);
            setNotice(null);
            if (closedNow) void reopen();
            else setClosing((c) => !c);
          }}
        />
      </div>
      {closedNow ? (
        <>
          <p className="card__row">
            <span className="card__label">Reason</span>
            <span className="card__value">{schedule.closure.reason ?? schedule.status.closed_reason ?? '-'}</span>
          </p>
          <p className="card__row">
            <span className="card__label">Reopens</span>
            <span className="card__value">
              {schedule.status.reopens_at ? formatMoment(schedule.status.reopens_at) : 'When staff reopen it'}
            </span>
          </p>
          <button type="button" className="button" disabled={saving} onClick={() => void reopen()}>
            {saving ? <Spinner label="Saving" /> : 'Reopen now'}
          </button>
        </>
      ) : closing ? (
        <form className="form" onSubmit={askToClose} noValidate>
          <div className="field">
            <label className="field__label" htmlFor={reasonId}>
              Reason (customers see this)
            </label>
            <input
              id={reasonId}
              className="input"
              value={reason}
              maxLength={MAX_CLOSURE_REASON}
              onChange={(e) => setReason(e.target.value)}
              aria-invalid={error && !reason.trim() ? true : undefined}
            />
            <Chips
              label="Quick reasons"
              options={REASON_CHIPS.map((r) => ({ id: r, text: r }))}
              value={reason.trim()}
              onPick={(r) => setReason(r)}
            />
          </div>
          <div className="field">
            <span className="field__label">Reopen</span>
            <Chips label="Reopen" options={reopenChips} value={mode} onPick={(m) => setMode(m as ReopenMode)} />
            {mode === 'pick' ? (
              <div className="pick-row">
                <select className="input pick-select" aria-label="Reopen day" value={pickDay} onChange={(e) => setPickDay(e.target.value)}>
                  {pickDays.map((d) => (
                    <option key={d.value} value={d.value}>
                      {d.text}
                    </option>
                  ))}
                </select>
                <TimeSelect label="Reopen time" value={pickTime} onChange={setPickTime} />
              </div>
            ) : null}
            <span className="field__hint">The store opens again by itself at this time.</span>
          </div>
          <button type="submit" className="button button--danger" disabled={saving}>
            {saving ? <Spinner label="Saving" /> : 'Close the store'}
          </button>
        </form>
      ) : (
        <p className="quiet">Rain, a holiday or stock-taking? Close now and customers see why. Orders already placed are not affected.</p>
      )}
      {pending ? (
        <ConfirmDialog
          title="Close the store now?"
          message={`Customers cannot place orders ${pending.reopensAt ? `until ${formatMoment(pending.reopensAt)}` : 'until you reopen it'}. They will see: "${pending.reason}".`}
          confirmLabel="Close the store"
          destructive
          onConfirm={() => void close()}
          onCancel={() => setPending(null)}
        />
      ) : null}
      <Feedback error={error} notice={notice} updatedAt={schedule.closure.updated_at} />
    </section>
  );
}

// --------------------------------------------------------- opening hours
function HoursCard({ schedule, onSaved }: CardProps) {
  const [same, setSame] = useState(schedule.hours.same_every_day);
  const [pair, setPair] = useState(() => firstOpenPair(schedule.hours));
  const [days, setDays] = useState<Record<DayKey, DayHours>>(schedule.hours.days);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function setDay(k: DayKey, patch: Partial<DayHours>) {
    setDays((d) => ({ ...d, [k]: { ...d[k], ...patch } }));
  }

  function switchMode(nextSame: boolean) {
    if (nextSame === same) return;
    if (!nextSame) {
      // Start each day from the one pair, so only the differences need picking.
      setDays(Object.fromEntries(DAY_KEYS.map((k) => [k, { closed: false, ...pair }])) as Record<DayKey, DayHours>);
    } else {
      setPair(firstOpenPair({ ...schedule.hours, days }));
    }
    setSame(nextSame);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setNotice(null);
    const built = buildHoursBody(same, pair, days);
    if ('error' in built) {
      setError(built.error);
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const saved = await settings.storeSchedule.updateHours(built.body);
      onSaved(saved);
      setSame(saved.hours.same_every_day);
      setPair(firstOpenPair(saved.hours));
      setDays(saved.hours.days);
      setNotice('Opening hours saved.');
    } catch (err) {
      setError(catalogErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card" aria-labelledby="hours-title">
      <h2 className="section-label" id="hours-title">
        Opening hours
      </h2>
      <form className="form" onSubmit={save} noValidate>
        <div className="segmented" role="group" aria-label="Hours mode">
          {[
            { v: true, text: 'Same hours every day' },
            { v: false, text: 'Different per day' },
          ].map((o) => (
            <button
              key={String(o.v)}
              type="button"
              className={o.v === same ? 'segmented__item is-selected' : 'segmented__item'}
              aria-pressed={o.v === same}
              onClick={() => switchMode(o.v)}
            >
              {o.text}
            </button>
          ))}
        </div>
        {same ? (
          <div className="hours-pair">
            <div className="field">
              <span className="field__label">Opens</span>
              <TimeSelect label="Opens" value={pair.open} onChange={(open) => setPair((p) => ({ ...p, open }))} />
            </div>
            <div className="field">
              <span className="field__label">Closes</span>
              <TimeSelect label="Closes" value={pair.close} onChange={(close) => setPair((p) => ({ ...p, close }))} />
            </div>
          </div>
        ) : (
          <ul className="hours-days" aria-label="Hours per day">
            {DAY_KEYS.map((k) => {
              const d = days[k];
              return (
                <li key={k} className={d.closed ? 'hours-day is-closed' : 'hours-day'}>
                  <span className="hours-day__name">{DAY_NAMES[k]}</span>
                  <div className="segmented segmented--sm" role="group" aria-label={`${DAY_NAMES[k]} open or closed`}>
                    {[
                      { closed: false, text: 'Open' },
                      { closed: true, text: 'Closed' },
                    ].map((o) => (
                      <button
                        key={o.text}
                        type="button"
                        className={o.closed === d.closed ? 'segmented__item is-selected' : 'segmented__item'}
                        aria-pressed={o.closed === d.closed}
                        aria-label={`${DAY_NAMES[k]} ${o.text.toLowerCase()}`}
                        onClick={() => setDay(k, { closed: o.closed })}
                      >
                        {o.text}
                      </button>
                    ))}
                  </div>
                  {d.closed ? (
                    <span className="hours-day__closed">Closed all day</span>
                  ) : (
                    <span className="hours-day__times">
                      <TimeSelect label={`${DAY_NAMES[k]} opens`} value={d.open} onChange={(open) => setDay(k, { open })} />
                      <span aria-hidden="true">–</span>
                      <TimeSelect label={`${DAY_NAMES[k]} closes`} value={d.close} onChange={(close) => setDay(k, { close })} />
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <button type="submit" className="button" disabled={saving}>
          {saving ? <Spinner label="Saving" /> : 'Save hours'}
        </button>
      </form>
      <Feedback error={error} notice={notice} updatedAt={schedule.hours.updated_at} />
      <p className="page__note">Customers can order (as soon as possible) only inside these hours.</p>
    </section>
  );
}

// -------------------------------------------------------------- holidays
const HOLIDAY_CHIPS = ['Public holiday', 'Staff holiday', 'Stock-taking'];

function HolidaysCard({ schedule, onSaved }: CardProps) {
  const reasonId = useId();
  const taken = new Set(schedule.holidays.map((h) => h.date));
  const choices = dayOptions(MAX_REOPEN_DAYS).filter((d) => !taken.has(d.value));
  const [date, setDate] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const picked = choices.some((c) => c.value === date) ? date : choices[0]?.value ?? '';

  async function send(list: StoreHoliday[], done: string) {
    setNotice(null);
    setError(null);
    setSaving(true);
    try {
      onSaved(await settings.storeSchedule.updateHolidays(list));
      setNotice(done);
      return true;
    } catch (err) {
      setError(catalogErrorMessage(err));
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function add(event: FormEvent) {
    event.preventDefault();
    const text = reason.trim();
    if (!picked) {
      setError('Pick a day.');
      return;
    }
    if (text.length > MAX_HOLIDAY_REASON) {
      setError(`The reason can be at most ${MAX_HOLIDAY_REASON} characters.`);
      return;
    }
    if (schedule.holidays.length >= MAX_HOLIDAYS) {
      setError(`At most ${MAX_HOLIDAYS} holidays. Remove one first.`);
      return;
    }
    const list = [...schedule.holidays, { date: picked, reason: text || null }].sort((a, b) => a.date.localeCompare(b.date));
    if (await send(list, `Holiday added: ${formatSlotDate(colomboInstant(picked, '12:00'))}.`)) {
      setReason('');
      setDate('');
    }
  }

  return (
    <section className="card" aria-labelledby="holidays-title">
      <h2 className="section-label" id="holidays-title">
        Holidays
      </h2>
      {schedule.holidays.length === 0 ? (
        <EmptyState title="No holidays planned" message="Add a day and the store stays closed all that day." />
      ) : (
        <ul className="cat-list" aria-label="Holidays">
          {schedule.holidays.map((h) => {
            const when = dayLabelForDate(h.date);
            const date = formatSlotDate(colomboInstant(h.date, '12:00'));
            return (
              <li key={h.date} className="cat-row cat-row--flat holiday-row">
                <div className="cat-row__main">
                  <p className="cat-row__title">{when === date ? date : `${when} · ${date}`}</p>
                  {h.reason ? <p className="cat-row__meta">{h.reason}</p> : null}
                </div>
                <button
                  type="button"
                  className="button button--ghost button--sm"
                  disabled={saving}
                  aria-label={`Remove holiday ${date}`}
                  onClick={() =>
                    void send(
                      schedule.holidays.filter((x) => x.date !== h.date),
                      `Holiday removed: ${date}.`
                    )
                  }
                >
                  Remove
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <form className="form" onSubmit={add} noValidate>
        <div className="field">
          <span className="field__label">Day</span>
          <select className="input pick-select" aria-label="Holiday day" value={picked} onChange={(e) => setDate(e.target.value)}>
            {choices.map((d) => (
              <option key={d.value} value={d.value}>
                {d.text}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="field__label" htmlFor={reasonId}>
            Reason (optional)
          </label>
          <input id={reasonId} className="input" value={reason} maxLength={MAX_HOLIDAY_REASON} onChange={(e) => setReason(e.target.value)} />
          <Chips label="Quick holiday reasons" options={HOLIDAY_CHIPS.map((r) => ({ id: r, text: r }))} value={reason.trim()} onPick={setReason} />
        </div>
        <button type="submit" className="button" disabled={saving || !picked}>
          {saving ? <Spinner label="Saving" /> : 'Add holiday'}
        </button>
      </form>
      <Feedback error={error} notice={notice} />
    </section>
  );
}

// --------------------------------------------------------- delivery slots
function DeliverySlotsCard({ schedule, onSaved }: CardProps) {
  const s = schedule.delivery_slots;
  const [enabled, setEnabled] = useState(s.enabled);
  const [slotMinutes, setSlotMinutes] = useState(s.slot_minutes);
  const [daysAhead, setDaysAhead] = useState(s.days_ahead);
  const [maxOrders, setMaxOrders] = useState(s.max_orders_per_slot);
  const [lead, setLead] = useState(s.min_lead_minutes);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(event: FormEvent) {
    event.preventDefault();
    setNotice(null);
    if (!Number.isInteger(maxOrders) || maxOrders < MIN_ORDERS_PER_SLOT || maxOrders > MAX_ORDERS_PER_SLOT) {
      setError(`Orders per slot must be ${MIN_ORDERS_PER_SLOT} to ${MAX_ORDERS_PER_SLOT}.`);
      return;
    }
    if (lead < 0 || lead > MAX_LEAD_MINUTES || lead % LEAD_STEP !== 0) {
      setError(`Lead time must be 0 to ${MAX_LEAD_MINUTES} minutes in ${LEAD_STEP}-minute steps.`);
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const saved = await settings.storeSchedule.updateDeliverySlots({
        enabled,
        slot_minutes: slotMinutes,
        days_ahead: daysAhead,
        max_orders_per_slot: maxOrders,
        min_lead_minutes: lead,
      });
      onSaved(saved);
      const d = saved.delivery_slots;
      setEnabled(d.enabled);
      setSlotMinutes(d.slot_minutes);
      setDaysAhead(d.days_ahead);
      setMaxOrders(d.max_orders_per_slot);
      setLead(d.min_lead_minutes);
      setNotice(d.enabled ? 'Delivery slots saved. Customers can pick a slot.' : 'Delivery slots saved. Slots are off.');
    } catch (err) {
      setError(catalogErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card" aria-labelledby="slots-title">
      <div className="settings-head">
        <h2 className="section-label" id="slots-title">
          Delivery slots
        </h2>
        <Switch label="Delivery slots" checked={enabled} onToggle={() => setEnabled((v) => !v)} />
      </div>
      <p className="quiet">
        {enabled
          ? 'Customers can choose a delivery time, and order for later while the store is closed.'
          : 'Off: every order is delivered as soon as possible.'}
      </p>
      <form className="form" onSubmit={save} noValidate>
        <div className="field">
          <span className="field__label" id="slot-length-label">
            Slot length
          </span>
          <Chips
            label="Slot length"
            options={SLOT_MINUTE_CHOICES.map((m) => ({ id: String(m), text: slotLengthLabel(m) }))}
            value={String(slotMinutes)}
            onPick={(id) => setSlotMinutes(Number(id) as typeof slotMinutes)}
          />
        </div>
        <div className="field">
          <span className="field__label">Days customers can book</span>
          <Chips
            label="Days ahead"
            options={DAYS_AHEAD_CHOICES.map((d) => ({ id: String(d), text: daysAheadLabel(d) }))}
            value={String(daysAhead)}
            onPick={(id) => setDaysAhead(Number(id) as typeof daysAhead)}
          />
        </div>
        <div className="field">
          <span className="field__label">Max orders per slot</span>
          <Stepper label="Max orders per slot" value={maxOrders} min={MIN_ORDERS_PER_SLOT} max={MAX_ORDERS_PER_SLOT} onChange={setMaxOrders} />
          <span className="field__hint">A full slot is not offered to customers.</span>
        </div>
        <div className="field">
          <span className="field__label">Minimum time before a slot</span>
          <Stepper
            label="Minimum lead time"
            value={lead}
            min={0}
            max={MAX_LEAD_MINUTES}
            step={LEAD_STEP}
            format={leadLabel}
            onChange={setLead}
          />
          <span className="field__hint">Time to pack before the slot starts.</span>
        </div>
        <button type="submit" className="button" disabled={saving}>
          {saving ? <Spinner label="Saving" /> : 'Save delivery slots'}
        </button>
      </form>
      <Feedback error={error} notice={notice} updatedAt={s.updated_at} />
    </section>
  );
}

// ------------------------------------------------------ texts on closed days
/**
 * "Send offer/birthday texts on closed days" (owner, 2026-10-10: "give all
 * the options to control to ops and admin"). On (the default) keeps the old
 * rule; off holds offer, test and birthday SMS while the store is closed.
 */
function ClosedDaySmsCard({ schedule, onSaved }: CardProps) {
  const stored = schedule.sms?.sms_on_closed_days ?? true;
  const [on, setOn] = useState(stored);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(event: FormEvent) {
    event.preventDefault();
    setNotice(null);
    if (on === stored) {
      setNotice('Nothing changed.');
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const saved = await settings.storeSchedule.updateSms({ sms_on_closed_days: on });
      onSaved(saved);
      const now = saved.sms?.sms_on_closed_days ?? on;
      setOn(now);
      setNotice(now ? 'Saved. Texts go out on closed days too.' : 'Saved. No texts on closed days.');
    } catch (err) {
      setError(catalogErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card" aria-labelledby="closed-sms-title">
      <div className="settings-head">
        <h2 className="section-label" id="closed-sms-title">
          Send offer/birthday texts on closed days
        </h2>
        <Switch label="Send offer/birthday texts on closed days" checked={on} onToggle={() => setOn((v) => !v)} />
      </div>
      <p className="quiet">{on ? SMS_ON_CLOSED_DAYS_HINT.on : SMS_ON_CLOSED_DAYS_HINT.off}</p>
      <form className="form" onSubmit={save} noValidate>
        <button type="submit" className="button" disabled={saving}>
          {saving ? <Spinner label="Saving" /> : 'Save'}
        </button>
      </form>
      <Feedback error={error} notice={notice} updatedAt={schedule.sms?.updated_at ?? null} />
    </section>
  );
}
