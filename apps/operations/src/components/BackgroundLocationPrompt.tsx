import { useEffect, useId, useRef, useState } from 'react';
import { setBackgroundPrompter } from '../lib/location-mode';

/**
 * The explanation screen shown before Android's own location prompt, the
 * first time (per app run) one of the operator's deliveries goes on the road
 * in the Android app (lib/location-mode.ts decides when). Mounted once, in
 * the signed-in shell; it renders nothing until asked. Unmounting (sign-out)
 * answers any open question with "Not now".
 */
export function BackgroundLocationPrompt() {
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const pending = useRef<((agreed: boolean) => void) | null>(null);

  useEffect(() => {
    setBackgroundPrompter(
      () =>
        new Promise<boolean>((resolve) => {
          pending.current?.(false);
          pending.current = resolve;
          setOpen(true);
        })
    );
    return () => {
      setBackgroundPrompter(null);
      pending.current?.(false);
      pending.current = null;
    };
  }, []);

  function answer(agreed: boolean) {
    pending.current?.(agreed);
    pending.current = null;
    setOpen(false);
  }

  if (!open) return null;
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="modal__panel">
        <h2 className="modal__title" id={titleId}>
          Keep sharing your location when the screen is off?
        </h2>
        <div className="modal__body">
          <p>You're on the road with a delivery. The customer and the store follow your position on the map until you arrive.</p>
          <p>
            Blynk Ops can keep sharing it while your phone is locked or you're in another app. You'll see a notification while
            it does, and it stops by itself when you arrive, the delivery ends, or you sign out.
          </p>
          <p>Next, Android asks for location access - choose "While using the app".</p>
        </div>
        <div className="modal__actions">
          <button type="button" className="button button--ghost" onClick={() => answer(false)}>
            Not now
          </button>
          <button type="button" className="button" onClick={() => answer(true)}>
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}
