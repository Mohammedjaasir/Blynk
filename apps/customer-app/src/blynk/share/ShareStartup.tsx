import { router, usePathname } from 'expo-router';
import { useEffect, useState } from 'react';
import { useSession } from '@/blynk/auth/session';
import { applyPendingReferral } from '@/blynk/rewards/api';
import { Toast } from '@/blynk/ui/kit';
import { DEMO } from '@/demo/mode';
import { takePendingRoute } from './startup';

/*
 * Mounted once at the root (renders nothing but a short toast):
 * - a shared link's route (`/app/#/p/<id>`, read at start-up) opens on top of Home once Home
 *   shows, like the Flutter shop's generateInitialRoutes (intro, then shop, then the product);
 * - when someone signs in, a friend's code kept from a `?ref=` link is applied once
 *   (Flutter PendingReferralSync), with a short toast on success; refusals are quiet.
 */
export function ShareStartup() {
  const path = usePathname();
  const session = useSession();
  const userId = session?.user.id ?? null;
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (path !== '/home') return;
    const route = takePendingRoute();
    if (route) router.push(route as never);
  }, [path]);

  useEffect(() => {
    if (DEMO || !userId) return;
    let alive = true;
    void applyPendingReferral().then((text) => { if (alive && text) setToast(text); });
    return () => { alive = false; };
  }, [userId]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  return toast ? <Toast text={toast} top={12} /> : null;
}
