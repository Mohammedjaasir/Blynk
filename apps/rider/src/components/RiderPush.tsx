import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { startRiderPush } from '../lib/riderPush';

/**
 * "New delivery assigned" (owner, 2026-10-21). Signed in, the phone registers for the server's
 * push: with the app closed Android shows it and a tap opens the delivery; with the app open
 * Android stays quiet, so this shows a banner, vibrates and the list re-reads at once.
 */
export function RiderPush() {
  const { status } = useAuth();
  const navigate = useNavigate();
  const [banner, setBanner] = useState<{ title: string; body: string; deliveryId: string | null } | null>(null);

  useEffect(() => {
    if (status !== 'authenticated') return undefined;
    let stop: (() => void) | null = null;
    let alive = true;
    void startRiderPush({
      onOpen: (id) => navigate(id ? `/deliveries/${id}` : '/'),
      onForeground: (title, body, deliveryId) => {
        setBanner({ title, body, deliveryId });
        try {
          navigator.vibrate?.([300, 150, 300]);
        } catch {
          // no vibration on this phone
        }
      },
    }).then((s) => {
      if (alive) stop = s;
      else s();
    });
    return () => {
      alive = false;
      stop?.();
    };
  }, [status, navigate]);

  useEffect(() => {
    if (!banner) return undefined;
    const t = setTimeout(() => setBanner(null), 12_000);
    return () => clearTimeout(t);
  }, [banner]);

  if (!banner) return null;
  return (
    <div className="rider-push" role="alert">
      <button
        type="button"
        className="rider-push__body"
        onClick={() => {
          const id = banner.deliveryId;
          setBanner(null);
          navigate(id ? `/deliveries/${id}` : '/');
        }}
      >
        <strong>{banner.title}</strong>
        {banner.body ? <span>{banner.body}</span> : null}
      </button>
      <button type="button" className="rider-push__close" aria-label="Close" onClick={() => setBanner(null)}>
        ×
      </button>
    </div>
  );
}
