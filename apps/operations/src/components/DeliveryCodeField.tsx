import { forwardRef, useId } from 'react';

/** The customer's proof-of-delivery code is exactly this many digits (backend migration 016). */
export const DELIVERY_CODE_LENGTH = 4;

export const isCompleteDeliveryCode = (code: string) => new RegExp(`^[0-9]{${DELIVERY_CODE_LENGTH}}$`).test(code);

/**
 * The 4-digit code the customer shows in their Blynk app. Numeric keypad on
 * phones, digits only, and its error directly under the input. Used by the
 * delivery handover (operator acting as rider) and the admin "Mark delivered".
 */
export const DeliveryCodeField = forwardRef<
  HTMLInputElement,
  {
    value: string;
    onChange(code: string): void;
    error?: string | null;
    disabled?: boolean;
    label?: string;
    hint?: string;
    autoFocus?: boolean;
  }
>(function DeliveryCodeField(
  {
    value,
    onChange,
    error,
    disabled,
    label = "Customer's delivery code",
    hint = 'Ask the customer for the 4-digit code in their Blynk app.',
    autoFocus,
  },
  ref
) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <input
        ref={ref}
        id={id}
        className="input input--code"
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="one-time-code"
        maxLength={DELIVERY_CODE_LENGTH}
        value={value}
        disabled={disabled}
        autoFocus={autoFocus}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${hintId} ${errorId}` : hintId}
        onChange={(event) => onChange(event.target.value.replace(/\D/g, '').slice(0, DELIVERY_CODE_LENGTH))}
      />
      <span className="field__hint" id={hintId}>
        {hint}
      </span>
      {error ? (
        <p className="field__error-text" id={errorId} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
});
