import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { trackPurchase } from '@/blynk/analytics/track';
import { needsRegistration, useSession } from '@/blynk/auth/session';
import { formatLkr } from '@/blynk/lib/money';
import { getOrder } from '@/blynk/orders/api';
import { rememberPlaced } from '@/blynk/orders/checkout';
import { placeErrorCopy } from '@/blynk/orders/errors';
import { clockTime } from '@/blynk/orders/status';
import type { Order } from '@/blynk/orders/types';
import { Body, Button, Card, Page, StateView } from '@/blynk/ui/kit';
import { openSignIn } from '@/blynk/ui/signIn';
import { C, F } from '@/lib/theme';
import { PAY } from './copy';
import { canPayAgain, nextPoll, phaseOf, POLL, type PayPhase } from './result';

/**
 * /payment/return and /payment/cancel (PayHere's return_url / cancel_url, ?order=<uuid>).
 * Never trusts the URL: polls GET /orders/:id (every 2.5 s, up to a minute) and shows paid,
 * still waiting, failed (try again until it expires), not paid (cancelled at PayHere), or
 * expired/cancelled. Paid goes on to the "Order placed" screen.
 */
export function PaymentResult({ from }: { from: 'return' | 'cancel' }) {
  const params = useLocalSearchParams<{ order?: string }>();
  const id = typeof params.order === 'string' ? params.order : '';
  const session = useSession();
  const signedIn = !!session && !needsRegistration(session);
  const [order, setOrder] = useState<Order | null>(null);
  const [elapsed, setElapsed] = useState(0);
  // when the last answer came (the expiry check uses it; nothing reads the clock while rendering)
  const [checkedAt, setCheckedAt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [round, setRound] = useState(0);

  useEffect(() => {
    if (!signedIn || !id) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const t0 = Date.now();
    const step = () => {
      getOrder(id)
        .then((o) => {
          if (!alive) return;
          const el = Date.now() - t0;
          setOrder(o);
          setElapsed(el);
          setCheckedAt(Date.now());
          setError(null);
          const n = nextPoll(phaseOf(o, { now: Date.now(), from, elapsedMs: el }), el);
          if (n.again) timer = setTimeout(step, n.delayMs);
        })
        .catch((e) => {
          if (!alive) return;
          const el = Date.now() - t0;
          setError(placeErrorCopy(e).message);
          setElapsed(el);
          if (el < POLL.limitMs) timer = setTimeout(step, POLL.everyMs * 2);
        });
    };
    step();
    return () => { alive = false; if (timer) clearTimeout(timer); };
  }, [id, signedIn, from, round]);

  const phase: PayPhase = phaseOf(order, { now: checkedAt, from, elapsedMs: elapsed });

  // paid: on to "Order placed" (it says "Paid online"); a cash order has nothing to pay here
  useEffect(() => {
    if (phase === 'paid') {
      // "Order placed" shows this (paid) order without asking again
      if (order) { rememberPlaced(order); trackPurchase(order); }
      router.replace({ pathname: '/placed', params: { id } });
    }
    if (phase === 'cod') router.replace({ pathname: '/order/[id]', params: { id } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, id]);

  const title = PAY.payTitle;
  if (!signedIn) return <Page title={title}><StateView title={PAY.signIn} message={PAY.signInSub} action={PAY.login} onAction={openSignIn} /></Page>;
  if (!id) return <Page title={title}><StateView title={PAY.orderNotFoundTitle} message={PAY.noOrderInLink} action={PAY.home} onAction={() => router.dismissTo('/home')} /></Page>;

  const by = clockTime(order?.payment_expires_at);
  const payAgain = () => router.replace({ pathname: '/payment/pay', params: { order: id } } as never);
  const viewOrder = () => router.replace({ pathname: '/order/[id]', params: { id } });
  const checkAgain = () => { setElapsed(0); setRound((r) => r + 1); };

  let head: string;
  let sub: string | null = null;
  let spinner = false;
  let tone: 'problem' | 'neutral' | 'positive' = 'neutral';
  switch (phase) {
    case 'checking': head = PAY.checking; spinner = true; break;
    case 'waiting': head = PAY.waiting; sub = PAY.waitingSub; spinner = true; break;
    case 'paid': head = PAY.paidTitle; tone = 'positive'; spinner = true; break;
    case 'failed': head = PAY.failedTitle; sub = PAY.failedSub(by); tone = 'problem'; break;
    case 'notPaid': head = PAY.notPaidTitle; sub = PAY.notPaidSub(by); break;
    case 'timeout': head = PAY.timeoutTitle; sub = PAY.timeoutSub; break;
    case 'expired': head = PAY.expiredTitle; sub = PAY.expiredSub; tone = 'problem'; break;
    case 'cancelled': head = PAY.cancelledTitle; sub = PAY.cancelledSub; break;
    default: head = PAY.checking; spinner = true;
  }
  if (!order && error) { head = PAY.errorTitle; sub = error; spinner = false; tone = 'problem'; }

  return (
    <Page title={title}>
      <Animated.View key={phase} entering={FadeIn.duration(180)}>
        <Card style={{ alignItems: 'center', paddingVertical: 26 }}>
          {spinner ? <ActivityIndicator color={C.brandInk} size="large" /> : <ResultMark tone={tone} />}
          <Text style={{ fontFamily: F.bold, fontSize: 18, color: tone === 'problem' ? C.problem : C.ink, marginTop: 14, textAlign: 'center' }} accessibilityRole="header">{head}</Text>
          {!!sub && <Body sub style={{ marginTop: 6, textAlign: 'center' }}>{sub}</Body>}
          {!!order && (
            <Text style={{ fontFamily: F.medium, fontSize: 13, color: C.sub, marginTop: 14 }}>
              {`${order.order_number} · ${formatLkr(order.total_amount)}`}
            </Text>
          )}
          {!!error && !!order && <Text style={{ fontFamily: F.medium, fontSize: 12.5, color: C.problem, marginTop: 8, textAlign: 'center' }}>{error}</Text>}
        </Card>
      </Animated.View>

      {canPayAgain(phase) && <Button label={phase === 'failed' ? PAY.tryAgain : PAY.payNow} onPress={payAgain} />}
      {phase === 'timeout' && <Button label={PAY.checkAgain} onPress={checkAgain} />}
      {!order && !!error && <Button label={PAY.checkAgain} onPress={checkAgain} />}
      {phase !== 'checking' && phase !== 'paid' && (
        <Button label={PAY.viewOrder} kind={canPayAgain(phase) || phase === 'timeout' ? 'quiet' : 'primary'} onPress={viewOrder} style={{ marginTop: 8 }} />
      )}
      {(phase === 'expired' || phase === 'cancelled') && <Button label={PAY.home} kind="quiet" onPress={() => router.dismissTo('/home')} style={{ marginTop: 4 }} />}
    </Page>
  );
}

function ResultMark({ tone }: { tone: 'problem' | 'neutral' | 'positive' }) {
  const bg = tone === 'problem' ? '#FBE9E7' : tone === 'positive' ? C.greenTint : C.brandTint;
  const fg = tone === 'problem' ? C.problem : tone === 'positive' ? C.greenDark : C.brandText;
  return (
    <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontFamily: F.black, fontSize: 26, color: fg }}>{tone === 'problem' ? '!' : tone === 'positive' ? '✓' : 'i'}</Text>
    </View>
  );
}
