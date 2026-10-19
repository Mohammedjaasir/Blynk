import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LocalNotifications } from '@capacitor/local-notifications';
import { orders } from '../api/resources';
import { isNativeApp } from '../api/native-client';
import { NEW_ORDER_POLL_MS, newOrdersSince, newOrderText, type SeenOrder } from '../lib/newOrders';

/**
 * New-order alert (owner, 2026-10-19: "Ops app should send notifications when order received").
 * While the app runs - on any tab, also in the background until Android stops it - it checks the
 * packing queue every 20 s; a newly placed order chimes, vibrates, shows a banner here and a phone
 * notification (Capacitor local notifications; no Firebase needed). With the app fully closed the
 * server's "New order" push reaches the phone once Firebase is set up for the app.
 */
export function NewOrderAlert() {
  const navigate = useNavigate();
  const seen = useRef<Set<string> | null>(null);
  const [banner, setBanner] = useState<{ title: string; body: string } | null>(null);

  useEffect(() => {
    if (isNativeApp()) {
      void LocalNotifications.requestPermissions().catch(() => {});
      const sub = LocalNotifications.addListener('localNotificationActionPerformed', () => navigate('/orders'));
      return () => {
        void sub.then((s) => s.remove()).catch(() => {});
      };
    }
    return undefined;
  }, [navigate]);

  useEffect(() => {
    let alive = true;
    let next = 1;
    const check = async () => {
      try {
        const list: SeenOrder[] = (await orders.needingPacking()).orders;
        if (!alive) return;
        const { fresh, seen: s } = newOrdersSince(seen.current, list);
        seen.current = s;
        if (!fresh.length) return;
        const text = newOrderText(fresh);
        setBanner(text);
        ring();
        if (isNativeApp()) {
          await LocalNotifications.schedule({
            notifications: [{ id: next++, title: text.title, body: text.body, extra: { to: '/orders' } }],
          }).catch(() => {});
        }
      } catch {
        // offline or signed out for a moment: try again next time
      }
    };
    void check();
    const timer = setInterval(() => void check(), NEW_ORDER_POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  if (!banner) return null;
  return (
    <div
      role="alert"
      data-testid="new-order-banner"
      style={{
        position: 'fixed', left: 12, right: 12, top: 12, zIndex: 1000, display: 'flex', alignItems: 'center', gap: 12,
        background: '#1A1D2E', color: '#fff', borderRadius: 14, padding: '12px 14px', boxShadow: '0 6px 20px rgba(0,0,0,0.25)',
      }}
    >
      <div style={{ flex: 1 }}>
        <strong>{banner.title}</strong>
        <div style={{ fontSize: 13, opacity: 0.85 }}>{banner.body}</div>
      </div>
      <button
        type="button"
        className="button button--sm"
        onClick={() => {
          setBanner(null);
          navigate('/orders');
        }}
      >
        Open
      </button>
      <button type="button" className="button button--ghost button--sm" aria-label="Dismiss" onClick={() => setBanner(null)} style={{ color: '#fff' }}>
        ×
      </button>
    </div>
  );
}

/** A short two-tone chime (Web Audio, no sound file) and a buzz. */
function ring() {
  try {
    navigator.vibrate?.([300, 150, 300]);
  } catch {
    // no vibration on this device
  }
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    [880, 1320, 880, 1320].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f;
      o.connect(g);
      g.connect(ctx.destination);
      const t = ctx.currentTime + i * 0.22;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.4, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
      o.start(t);
      o.stop(t + 0.21);
    });
    setTimeout(() => void ctx.close().catch(() => {}), 1200);
  } catch {
    // sound not available
  }
}
