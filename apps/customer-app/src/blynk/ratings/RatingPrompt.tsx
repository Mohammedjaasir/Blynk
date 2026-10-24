import { usePathname } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Sheet } from '@/blynk/account/ui';
import { needsRegistration, useSession } from '@/blynk/auth/session';
import { useFeatureOn } from '@/blynk/lib/featureGate';
import { storage } from '@/blynk/lib/storage';
import { onVisible } from '@/blynk/lib/visibility';
import { listOrders } from '@/blynk/orders/api';
import type { Order } from '@/blynk/orders/types';
import { useStore } from '@/blynk/store/StoreContext';
import { DEMO } from '@/demo/mode';
import { useKeyboardInset } from '@/lib/keyboard';
import { fetchRating } from './api';
import { PROMPT_KEY, promptCandidate, readPrompted, withPrompted, type RatingAnswer } from './model';
import { OrderRatingCard } from './RatingCard';
import { RATING_WORDS } from './words';

/*
 * The one-time "How was your order?" sheet: the next time the customer opens the app (or brings it
 * back) on Home after an order was delivered, once per order. Only the newest delivered order still
 * in its 14-day window and not rated; it is remembered as asked as soon as it is checked, so it
 * never comes back. Mounted once in the root layout.
 */

const SHOW_AFTER_MS = 1200;

export function RatingPromptHost() {
  const session = useSession();
  const store = useStore();
  const on = useFeatureOn(store, 'ratings');
  const pathname = usePathname();
  const ready = !DEMO && !!session && !needsRegistration(session) && on;
  const [open, setOpen] = useState<{ order: Order; answer: RatingAnswer } | null>(null);
  const [launch, setLaunch] = useState(0);
  const checked = useRef<string | null>(null);

  // coming back to the app counts as opening it again
  useEffect(() => onVisible(() => { checked.current = null; setLaunch((n) => n + 1); }), []);

  useEffect(() => {
    if (!ready || pathname !== '/home' || open) return;
    const uid = session!.user.id;
    const key = `${uid}:${launch}`;
    if (checked.current === key) return;
    let alive = true;
    const t = setTimeout(() => {
      checked.current = key;
      void (async () => {
        const { orders } = await listOrders(1, 10);
        const o = promptCandidate(orders, readPrompted(storage.get(PROMPT_KEY), uid));
        if (!o || !alive) return;
        const answer = await fetchRating(o.id);
        // asked once, whatever happens next
        storage.set(PROMPT_KEY, withPrompted(storage.get(PROMPT_KEY), uid, o.id));
        if (!answer.rating && alive) setOpen({ order: o, answer });
      })().catch(() => undefined);
    }, SHOW_AFTER_MS);
    return () => { alive = false; clearTimeout(t); };
  }, [ready, pathname, launch, session?.user.id]);

  if (!open || !ready) return null;
  return <PromptSheet order={open.order} answer={open.answer} onClose={() => setOpen(null)} />;
}

function PromptSheet({ order, answer, onClose }: { order: Order; answer: RatingAnswer; onClose: () => void }) {
  const kb = useKeyboardInset();
  return (
    <Sheet label={RATING_WORDS.promptLabel} onClose={onClose}>
      <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 620 }} contentContainerStyle={{ paddingBottom: kb }}>
        <View>
          <OrderRatingCard order={order} initial={answer} look="bare" onClose={onClose} />
        </View>
      </ScrollView>
    </Sheet>
  );
}
