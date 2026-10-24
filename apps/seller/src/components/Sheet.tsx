import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { IconClose } from './icons';

/**
 * A bottom sheet on phones and a centred card on laptops, for the short forms
 * (send stock, ask for payment). A real dialog: focus moves in and comes back,
 * Escape and the backdrop close it, the page behind does not scroll.
 */
export function Sheet({
  title,
  eyebrow,
  lede,
  onClose,
  children,
  busy = false,
}: {
  title: string;
  eyebrow?: string;
  lede?: ReactNode;
  onClose(): void;
  children: ReactNode;
  /** While sending, Escape and the backdrop do nothing. */
  busy?: boolean;
}) {
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const busyRef = useRef(busy);
  busyRef.current = busy;

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    // Focus the dialog itself (not a box): on a phone that would pop the keyboard over the form.
    (panel.current?.querySelector<HTMLElement>('[data-autofocus]') ?? panel.current)?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape' && !busyRef.current) {
        event.stopPropagation();
        closeRef.current();
      }
      // Keep Tab inside the sheet.
      if (event.key === 'Tab' && panel.current) {
        const items = [...panel.current.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href]')].filter(
          (el) => !el.hasAttribute('disabled')
        );
        if (items.length === 0) return;
        const firstItem = items[0]!;
        const lastItem = items[items.length - 1]!;
        if (event.shiftKey && document.activeElement === firstItem) {
          event.preventDefault();
          lastItem.focus();
        } else if (!event.shiftKey && document.activeElement === lastItem) {
          event.preventDefault();
          firstItem.focus();
        }
      }
    }
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      before?.focus?.();
    };
  }, []);

  // On <body>: the page's fade-in makes its own stacking layer, which would trap the sheet under the header.
  return createPortal(
    <div className="sheet" role="presentation">
      <div
        className="sheet__backdrop"
        aria-hidden="true"
        onClick={() => {
          if (!busyRef.current) onClose();
        }}
      />
      <div
        ref={panel}
        className="sheet__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        tabIndex={-1}
      >
        <div className="sheet__core">
          <span className="sheet__grip" aria-hidden="true" />
          <header className="sheet__head">
            <div className="sheet__titles">
              {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
              <h2 id={`${id}-title`} className="sheet__title">
                {title}
              </h2>
              {lede ? <p className="muted sheet__lede">{lede}</p> : null}
            </div>
            <button type="button" className="sheet__close" aria-label="Close" onClick={onClose} disabled={busy}>
              <IconClose size={20} />
            </button>
          </header>
          <div className="sheet__body">{children}</div>
        </div>
      </div>
    </div>,
    document.body
  );
}
