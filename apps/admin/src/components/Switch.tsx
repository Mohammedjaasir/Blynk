import type { ReactNode } from 'react';
import './riderDocuments.css';

/**
 * A styled on/off switch (owner, 2026-10-10: no plain native checkboxes):
 * a button with role="switch", an ink track and a yellow knob when on.
 * `label` is the accessible name; `children` is the visible text beside it.
 */
export function Switch({
  checked,
  onChange,
  label,
  children,
  disabled = false,
}: {
  checked: boolean;
  onChange(next: boolean): void;
  label: string;
  children?: ReactNode;
  disabled?: boolean;
}) {
  const button = (
    <button
      type="button"
      role="switch"
      className="rd-switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    />
  );
  if (!children) return button;
  return (
    <span className="rd-switch-row">
      {button}
      <span aria-hidden="true">{children}</span>
    </span>
  );
}
