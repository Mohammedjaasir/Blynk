import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Text, View } from 'react-native';
import { updateProfile } from '@/blynk/api/account';
import { needsRegistration, useSession } from '@/blynk/auth/session';
import { PolicyRow } from '@/blynk/legal/PolicyLinks';
import { formatLkr } from '@/blynk/lib/money';
import { getOrder } from '@/blynk/orders/api';
import { placedFromMemory } from '@/blynk/orders/checkout';
import { placeErrorCopy } from '@/blynk/orders/errors';
import { awaitingPayment, clockTime } from '@/blynk/orders/status';
import type { Order } from '@/blynk/orders/types';
import { Body, Button, Card, Field, Notice, Page, StateView } from '@/blynk/ui/kit';
import { openSignIn } from '@/blynk/ui/signIn';
import { C, F } from '@/lib/theme';
import { checkoutRefusal, startPayHereCheckout } from './api';
import { PAY } from './copy';
import { formEntries, formNeedsEmail, submitWebForm, type CheckoutForm } from './form';
import { emailStep, validEmail } from './method';
import { PayHereBrowser } from './PayHereBrowser';

type Stage = 'loading' | 'email' | 'starting' | 'redirect' | 'browser' | 'problem';
type Problem = { title: string; message: string; action: 'retry' | 'order' | 'home' };

/**
 * /payment/pay?order=<id>: pay an AWAITING_PAYMENT order with PayHere. Asks for an email first
 * when the profile has none (PayHere needs one; customers save it with PATCH /me), then
 * POST /payments/payhere/checkout and posts the returned form: in this tab on the web, in an
 * in-app browser on a phone. Used right after "Continue to pay", by "Pay now" on the order
 * screens and by "Try again" after a failed card (allowed until the order expires).
 */
export function PayScreen() {
  const params = useLocalSearchParams<{ order?: string }>();
  const orderId = typeof params.order === 'string' ? params.order : '';
  const session = useSession();
  const signedIn = !!session && !needsRegistration(session);
  const [order, setOrder] = useState<Order | null>(() => (orderId ? placedFromMemory(orderId) : null));
  const [stage, setStage] = useState<Stage>('loading');
  const [problem, setProblem] = useState<Problem | null>(null);
  const [email, setEmail] = useState('');
  const [emailErr, setEmailErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [browser, setBrowser] = useState<{ form: CheckoutForm; entries: [string, string][] } | null>(null);
  const started = useRef(false);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const fail = (p: Problem) => { if (mounted.current) { setProblem(p); setStage('problem'); } };
  const toResult = (kind: 'return' | 'cancel') => router.replace({ pathname: `/payment/${kind}`, params: { order: orderId } } as never);

  /** POST checkout, then hand the form to PayHere. `typed` = the email the customer just gave. */
  const pay = async (typed?: string) => {
    setStage('starting');
    try {
      const f = await startPayHereCheckout(orderId);
      if (!mounted.current) return;
      const known = typed || session?.user.email || '';
      if (formNeedsEmail(f) && !validEmail(known)) { setStage('email'); return; }
      const entries = formEntries(f, known);
      if (Platform.OS === 'web' && typeof document !== 'undefined') {
        setStage('redirect');
        submitWebForm(document, f.action_url, entries);
      } else {
        setBrowser({ form: f, entries });
        setStage('browser');
      }
    } catch (e) {
      switch (checkoutRefusal(e)) {
        case 'paid': toResult('return'); return;
        case 'expired': fail({ title: PAY.expiredTitle, message: PAY.expiredSub, action: 'order' }); return;
        case 'notAwaiting': case 'notOnline': router.replace({ pathname: '/order/[id]', params: { id: orderId } }); return;
        case 'unavailable': fail({ title: PAY.failedTitle, message: PAY.unavailable, action: 'order' }); return;
        case 'notFound': fail({ title: 'Order not found', message: 'This order could not be found.', action: 'home' }); return;
        default: fail({ title: PAY.failedTitle, message: placeErrorCopy(e).message, action: 'retry' });
      }
    }
  };

  const begin = (o: Order) => {
    if (o.payment_status === 'PAID') { toResult('return'); return; }
    if (!awaitingPayment(o)) { router.replace({ pathname: '/order/[id]', params: { id: o.id } }); return; }
    if (emailStep(session?.user.email, session?.user.role) !== 'none') { setStage('email'); return; }
    void pay();
  };

  useEffect(() => {
    if (!signedIn || !orderId || started.current) return;
    started.current = true;
    const fresh = order;
    // the order the cart just placed: start at once (after this render)
    if (fresh) { void Promise.resolve().then(() => { if (mounted.current) begin(fresh); }); return; }
    getOrder(orderId)
      .then((o) => { if (mounted.current) { setOrder(o); begin(o); } })
      .catch((e) => fail({ title: "Couldn't load this order", message: placeErrorCopy(e).message, action: 'retry' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn, orderId]);

  const saveEmail = async () => {
    const v = email.trim();
    if (!validEmail(v)) { setEmailErr(PAY.emailBad); return; }
    setEmailErr(null);
    if (emailStep(session?.user.email, session?.user.role) === 'askAndSave') {
      setSaving(true);
      try {
        await updateProfile({ email: v });
      } catch (e) {
        if (mounted.current) { setSaving(false); setEmailErr(placeErrorCopy(e).message); }
        return;
      }
      if (!mounted.current) return;
      setSaving(false);
    }
    void pay(v);
  };

  const retry = () => {
    setProblem(null);
    if (order) begin(order);
    else { started.current = false; setStage('loading'); getOrder(orderId).then((o) => { setOrder(o); begin(o); }).catch((e) => fail({ title: "Couldn't load this order", message: placeErrorCopy(e).message, action: 'retry' })); }
  };

  if (!signedIn) {
    return <Page title={PAY.payTitle}><StateView title={PAY.signIn} message={PAY.signInSub} action="Log in" onAction={openSignIn} /></Page>;
  }

  const by = clockTime(order?.payment_expires_at);
  return (
    <Page title={PAY.payTitle}>
      {order && (
        <Card>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ fontFamily: F.regular, fontSize: 13, color: C.sub }}>{PAY.order}</Text>
            <Text style={{ fontFamily: F.semi, fontSize: 13.5, color: C.ink }} selectable>{order.order_number}</Text>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 }}>
            <Text style={{ fontFamily: F.regular, fontSize: 13, color: C.sub }}>{PAY.amount}</Text>
            <Text style={{ fontFamily: F.bold, fontSize: 17, color: C.ink }}>{formatLkr(order.total_amount)}</Text>
          </View>
          {!!by && <Text style={{ fontFamily: F.semi, fontSize: 13, color: C.brandText, marginTop: 10 }}>{PAY.payBy(by)}</Text>}
        </Card>
      )}

      {(stage === 'loading' || stage === 'starting') && (
        <View style={{ alignItems: 'center', paddingTop: 40 }}>
          <ActivityIndicator color={C.brandInk} />
          <Body sub style={{ marginTop: 12 }}>{PAY.preparing}</Body>
        </View>
      )}

      {stage === 'redirect' && (
        <View style={{ alignItems: 'center', paddingTop: 40, paddingHorizontal: 20 }}>
          <ActivityIndicator color={C.brandInk} />
          <Text style={{ fontFamily: F.semi, fontSize: 16, color: C.ink, marginTop: 14 }}>{PAY.redirecting}</Text>
          <Body sub style={{ marginTop: 6, textAlign: 'center' }}>{PAY.redirectSub}</Body>
        </View>
      )}

      {stage === 'email' && (
        <Card>
          <Text style={{ fontFamily: F.bold, fontSize: 16, color: C.ink }}>{PAY.emailTitle}</Text>
          <Body sub style={{ marginTop: 4 }}>{PAY.emailSub}</Body>
          <Field
            label={PAY.emailLabel}
            value={email}
            onChange={(t) => { setEmail(t); setEmailErr(null); }}
            placeholder={PAY.emailHint}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            autoCorrect={false}
            error={emailErr}
            maxLength={255}
            onSubmitEditing={() => void saveEmail()}
          />
          <Button label={saving ? PAY.emailSaving : PAY.emailSave} busy={saving} onPress={() => void saveEmail()} style={{ marginTop: 16 }} />
        </Card>
      )}

      {stage === 'browser' && (
        <View style={{ alignItems: 'center', paddingTop: 40 }}>
          <ActivityIndicator color={C.brandInk} />
          <Body sub style={{ marginTop: 12 }}>{PAY.redirecting}</Body>
        </View>
      )}

      {stage === 'problem' && problem && (
        <>
          <Notice tone="problem">{`${problem.title}. ${problem.message}`}</Notice>
          {problem.action === 'retry' && <Button label={PAY.tryAgain} onPress={retry} />}
          {problem.action !== 'home' && <Button label={PAY.viewOrder} kind={problem.action === 'retry' ? 'quiet' : 'primary'} onPress={() => router.replace({ pathname: '/order/[id]', params: { id: orderId } })} style={{ marginTop: 8 }} />}
          {problem.action === 'home' && <Button label={PAY.home} onPress={() => router.dismissTo('/home')} />}
        </>
      )}

      <PolicyRow center style={{ marginTop: 22 }} />

      {browser && stage === 'browser' && (
        <PayHereBrowser
          form={browser.form}
          entries={browser.entries}
          onBack={(kind) => { setBrowser(null); toResult(kind); }}
          onClose={() => { setBrowser(null); toResult('cancel'); }}
        />
      )}
    </Page>
  );
}
