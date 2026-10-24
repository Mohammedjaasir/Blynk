import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { needsRegistration, useSession } from '@/blynk/auth/session';
import { AskUsPrompt, openAskUs, useAskUsOn } from '@/blynk/requests/AskUs';
import { fetchMyRequests } from '@/blynk/requests/api';
import { ASK_COPY, requestDate, statusChip, type MyRequest } from '@/blynk/requests/model';
import { Badge, Card, ListSkeleton, Page, StateView } from '@/blynk/ui/kit';
import { openSignIn } from '@/blynk/ui/signIn';
import { DEMO } from '@/demo/mode';
import { C, F } from '@/lib/theme';

/*
 * My requests (migration 056): the products this customer asked us to stock (GET
 * /me/product-requests), newest first, each with its status - New, Planned, Added (with a link to
 * the product) or Not stocking. "Ask us" for another one.
 */
export default function MyRequests() {
  const session = useSession();
  const signedIn = !!session && !needsRegistration(session);
  const on = useAskUsOn();
  const [list, setList] = useState<MyRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const load = useCallback(() => setTick((n) => n + 1), []);
  useEffect(() => {
    if (DEMO || !signedIn || !on) return;
    const ctrl = new AbortController();
    fetchMyRequests(ctrl.signal)
      .then((l) => { setList(l); setError(null); })
      .catch((e) => { if (!ctrl.signal.aborted) setError((e as Error).message || ASK_COPY.loadFailed); });
    return () => ctrl.abort();
  }, [signedIn, on, tick, session?.user.id]);

  const right = on && signedIn ? (
    <Pressable onPress={() => openAskUs()} hitSlop={8} accessibilityRole="button"><Text style={s.link}>{ASK_COPY.cta}</Text></Pressable>
  ) : undefined;

  let body: React.ReactNode;
  if (DEMO || !on) body = <StateView title={ASK_COPY.myRequests} message={ASK_COPY.soon} />;
  else if (!signedIn) body = <StateView title={ASK_COPY.loginTitle} message={ASK_COPY.loginSub} action={ASK_COPY.login} onAction={openSignIn} />;
  else if (error && !list) body = <StateView title={ASK_COPY.loadFailedTitle} message={error} action={ASK_COPY.tryAgain} onAction={load} />;
  else if (!list) body = <ListSkeleton rows={3} h={92} />;
  else if (!list.length) body = <StateView title={ASK_COPY.empty} message={ASK_COPY.emptySub} action={ASK_COPY.cta} onAction={() => openAskUs()} />;
  else {
    body = (
      <>
        {list.map((r, i) => <RequestRow key={r.id} r={r} index={i} />)}
        <AskUsPrompt style={{ marginTop: 4 }} />
      </>
    );
  }
  return <Page title={ASK_COPY.myRequests} right={right}>{body}</Page>;
}

function RequestRow({ r, index }: { r: MyRequest; index: number }) {
  const chip = statusChip(r.status);
  const when = r.createdAt ? requestDate(r.createdAt) : null;
  return (
    <Animated.View entering={FadeInDown.delay(Math.min(index, 6) * 50).duration(260)}>
      <Card>
        <View style={s.top}>
          <Text style={s.name} numberOfLines={2}>{r.name}</Text>
          <Badge tone={chip.tone} label={chip.label} />
        </View>
        <Text style={s.meta}>{[r.categoryName, when ? ASK_COPY.asked(when) : null].filter(Boolean).join(' · ')}</Text>
        {!!r.note && <Text style={s.note} numberOfLines={2}>{r.note}</Text>}
        <Text style={[s.status, r.status === 'ADDED' && { color: C.greenDark }]}>{chip.sub}</Text>
        {r.status === 'ADDED' && !!r.productId && (
          <Pressable onPress={() => router.push({ pathname: '/p/[id]', params: { id: r.productId! } })} hitSlop={8} style={{ alignSelf: 'flex-start', marginTop: 8 }} accessibilityRole="link">
            <Text style={s.link}>{ASK_COPY.viewProduct} →</Text>
          </Pressable>
        )}
      </Card>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  name: { flex: 1, fontFamily: F.bold, fontSize: 15.5, color: C.ink },
  meta: { fontFamily: F.regular, fontSize: 12, color: C.sub, marginTop: 3 },
  note: { fontFamily: F.regular, fontSize: 13, color: C.text, marginTop: 6, lineHeight: 18 },
  status: { fontFamily: F.medium, fontSize: 12.5, color: C.sub, marginTop: 8 },
  link: { fontFamily: F.semi, fontSize: 13.5, color: C.brandText },
});
