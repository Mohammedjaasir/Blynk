import { useId } from 'react';
import {
  CUSTOMER_GROUPS,
  DAYS_RANGE,
  GROUP_HINT,
  GROUP_LABEL,
  audienceFromDraft,
  hasDays,
  type AudienceDraft,
  type CustomerGroup,
} from '../lib/customerGroups';
import './growth.css';

/**
 * "Send to" (customer groups, 2026-10-24; plan 2026-10-24-groups-ratings-requests.md A):
 * the five groups as big radio rows; the chosen group's numbers (days, minimum spend)
 * open under it. The page shows the live count it gets from the API (`countText`).
 *
 * `extras` are options a page keeps from before groups existed (SMS offers' "Ordered in
 * last 30 / 90 days"): picked, `extraSelected` names it and no group is checked.
 */
export function CustomerGroupPicker({
  draft,
  onChange,
  countText,
  extras = [],
  extraSelected = null,
  onExtra,
  name = 'customer-group',
}: {
  draft: AudienceDraft;
  onChange(next: AudienceDraft): void;
  /** "120 customers (140 devices)" - the live count for the chosen group, or a spinner text. */
  countText?: string | null;
  extras?: ReadonlyArray<{ id: string; label: string }>;
  extraSelected?: string | null;
  onExtra?(id: string): void;
  name?: string;
}) {
  const idBase = useId();
  const built = audienceFromDraft(draft);
  const group = extraSelected ? null : draft.group;

  const pick = (g: CustomerGroup) => onChange({ ...draft, group: g });

  return (
    <fieldset className="choice group-picker">
      <legend className="field__label">Send to</legend>
      {CUSTOMER_GROUPS.map((g) => (
        <div key={g} className="group-picker__item">
          <label className={`choice__option sms-choice${group === g ? ' is-selected' : ''}`}>
            <input type="radio" name={name} value={g} checked={group === g} onChange={() => pick(g)} />
            <span>
              <strong>{GROUP_LABEL[g]}</strong>
            </span>
          </label>
          {group === g && hasDays(g) ? (
            <div className="group-picker__fields">
              <label className="field">
                <span className="field__label">Days</span>
                <input
                  id={`${idBase}-days`}
                  className="input"
                  inputMode="numeric"
                  aria-label={`Days for ${GROUP_LABEL[g]}`}
                  value={draft.days[g]}
                  onChange={(e) => onChange({ ...draft, days: { ...draft.days, [g]: e.target.value } })}
                />
                <span className="field__hint">
                  {DAYS_RANGE[g].min} to {DAYS_RANGE[g].max}
                </span>
              </label>
              {g === 'BIG_SPENDERS' ? (
                <label className="field">
                  <span className="field__label">Minimum spend (LKR)</span>
                  <input
                    className="input"
                    inputMode="numeric"
                    aria-label="Minimum spend (LKR)"
                    value={draft.min_spend_lkr}
                    onChange={(e) => onChange({ ...draft, min_spend_lkr: e.target.value })}
                  />
                </label>
              ) : null}
            </div>
          ) : null}
        </div>
      ))}
      {extras.map((x) => (
        <label key={x.id} className={`choice__option sms-choice${extraSelected === x.id ? ' is-selected' : ''}`}>
          <input type="radio" name={name} value={x.id} checked={extraSelected === x.id} onChange={() => onExtra?.(x.id)} />
          <span>
            <strong>{x.label}</strong>
          </span>
        </label>
      ))}
      {group ? <p className="field__hint">{GROUP_HINT[group]}</p> : null}
      {group && built.problem ? (
        <p className="field__error-text" role="alert">
          {built.problem}
        </p>
      ) : countText ? (
        <p className="group-picker__count" data-testid="group-count" aria-live="polite">
          {countText}
        </p>
      ) : null}
    </fieldset>
  );
}
