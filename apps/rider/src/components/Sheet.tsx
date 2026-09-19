import { useEffect, useId, useRef, type ReactNode } from 'react';

/**
 * A bottom sheet for the two deliberate moments: confirming cash and
 * reporting a failed delivery. Modal, focus-trapped, closes on Escape or a
 * tap outside, and hands focus back to whatever opened it.
 */
export function Sheet({ title, onClose, children }: { title: string; onClose(): void; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const node = panel.current!;
    const focusables = () =>
      Array.from(node.querySelectorAll<HTMLElement>('button, textarea, input, a[href]')).filter(
        (el) => !el.hasAttribute('disabled')
      );
    (node.querySelector<HTMLElement>('[data-autofocus]') ?? focusables()[0])?.focus();

    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        close.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      opener?.focus?.();
    };
  }, []);

  return (
    <div className="sheet-backdrop" onClick={() => close.current()}>
      <div
        ref={panel}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id={titleId} className="sheet__title">
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}
