import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, {
  Easing, FadeIn, FadeInDown, FadeOut, LinearTransition, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay,
  withSequence, withTiming, ZoomIn,
} from 'react-native-reanimated';
import { ApiError } from '@/blynk/api/client';
import { useFeatureOn } from '@/blynk/lib/featureGate';
import type { Order } from '@/blynk/orders/types';
import { useStore } from '@/blynk/store/StoreContext';
import { fetchWallet } from '@/blynk/wallet/api';
import { StarIcon } from '@/components/icons';
import { Confetti, PressScale, tap } from '@/components/ui';
import { DEMO } from '@/demo/mode';
import { withSpring } from '@/lib/motion';
import { C, F, T } from '@/lib/theme';
import { fetchRating, isAlreadyTipped, isWalletLow, sendRating, sendWalletTip } from './api';
import { TipChip } from './CheckoutTip';
import {
  COMMENT_MAX, keepTags, ratingStage, riderTipOf, starWord, TAG_COPY, tagsFor, TIP_COPY, toggleTag, walletTipChoices,
  type OrderRating, type RatingAnswer, type RatingTag,
} from './model';

/*
 * The rating card after delivery (migration 055): five big stars that spring as they fill, quick
 * chips in the customer's words, an optional comment, then a small celebration. Then, while the
 * order has no tip yet and the Blynk Wallet covers it, "Tip your rider" (LKR 50 / 100 / 200 from the
 * wallet; a 409 WALLET_LOW hides it). A rating can be changed for 24 h. Shown on the order screen,
 * the tracking screen once delivered, and in the one-time prompt (RatingPrompt.tsx). Hidden while
 * GET /store `ratings_enabled` is off or the API answered RATINGS_NOT_READY.
 */

type Props = {
  order: Order;
  /** The prompt passes what it already read (no second GET). */
  initial?: RatingAnswer | null;
  /** 'card': a white card on the grey page. 'bare': inside a sheet (no card, no margin). */
  look?: 'card' | 'bare';
  /** The sheet's "Not now" / "Done". */
  onClose?: () => void;
};

export function OrderRatingCard({ order, initial, look = 'card', onClose }: Props) {
  const store = useStore();
  const on = useFeatureOn(store, 'ratings');
  const delivered = order.order_status === 'DELIVERED';
  const [answer, setAnswer] = useState<RatingAnswer | null>(initial ?? null);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    if (DEMO || !on || !delivered || initial) return;
    const ctrl = new AbortController();
    fetchRating(order.id, ctrl.signal)
      .then((a) => setAnswer(a))
      .catch(() => { if (!ctrl.signal.aborted) setLoadFailed(true); });
    return () => ctrl.abort();
  }, [order.id, on, delivered]);

  if (DEMO || !on || !delivered || loadFailed || !answer) return null;
  if (ratingStage(order, answer.rating) === 'hidden') return null;
  return <RatingBody order={order} answer={answer} setAnswer={setAnswer} look={look} onClose={onClose} />;
}

function RatingBody({ order, answer, setAnswer, look, onClose }: {
  order: Order; answer: RatingAnswer; setAnswer: (a: RatingAnswer) => void; look: 'card' | 'bare'; onClose?: () => void;
}) {
  const stage = ratingStage(order, answer.rating);
  const [editing, setEditing] = useState(stage === 'ask');
  const [stars, setStars] = useState(answer.rating?.stars ?? 0);
  const [tags, setTags] = useState<RatingTag[]>(answer.rating?.tags ?? []);
  const [comment, setComment] = useState(answer.rating?.comment ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pop, setPop] = useState(0);
  const [burst, setBurst] = useState(0);
  const [justSent, setJustSent] = useState(false);
  const [size, setSize] = useState({ w: 0 });

  const pick = (n: number) => {
    tap();
    setStars(n);
    setTags((t) => keepTags(t, n));
    setPop((p) => p + 1);
    setError(null);
  };

  const submit = async () => {
    if (busy || !stars) return;
    setBusy(true);
    setError(null);
    try {
      const a = await sendRating(order.id, { stars, tags, comment });
      setAnswer({ rating: a.rating, tip: Math.max(a.tip, answer.tip) });
      setEditing(false);
      setJustSent(true);
      // a celebration for a happy rating only; a low one gets a quiet "sorry"
      if (stars >= 4) setBurst(Date.now());
    } catch (e) {
      setError(e instanceof ApiError && e.status < 500 && e.status !== 0 ? e.message : e instanceof ApiError ? e.message : "We couldn't send your rating. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const offered = tagsFor(stars);
  const tipped = Math.max(answer.tip, riderTipOf(order));
  const wrap = look === 'card' ? s.card : s.bare;

  return (
    <Animated.View layout={LinearTransition.duration(220)} style={wrap} onLayout={(e) => setSize({ w: e.nativeEvent.layout.width })}>
      {editing ? (
        <View>
          <Text style={s.title} accessibilityRole="header">{answer.rating ? 'Change your rating' : 'How was your order?'}</Text>
          <Text style={s.sub}>{answer.rating ? 'You can change it for 24 hours.' : `Order ${order.order_number} · tap a star`}</Text>
          <View style={s.starRow} accessibilityRole="radiogroup" accessibilityLabel="Rate this order from 1 to 5 stars">
            {[1, 2, 3, 4, 5].map((n) => (
              <PopStar key={n} index={n - 1} filled={n <= stars} pop={n <= stars ? pop : 0} onPress={() => pick(n)} label={`${n} star${n > 1 ? 's' : ''}`} selected={stars === n} />
            ))}
          </View>
          <Animated.Text key={stars} entering={FadeIn.duration(180)} style={[s.word, stars > 0 && { color: C.ink, fontFamily: F.semi }]}>{starWord(stars)}</Animated.Text>
          {stars > 0 && (
            <Animated.View entering={FadeIn.duration(200)}>
              <Text style={s.label}>{stars >= 4 ? 'What did you like?' : stars <= 2 ? 'What went wrong?' : 'Tell us more'}</Text>
              <View style={s.chips} key={offered.join()}>
                {offered.map((t, i) => (
                  <Animated.View key={t} entering={FadeInDown.delay(i * 30).duration(220)}>
                    <TagChip tag={t} on={tags.includes(t)} onPress={() => setTags((x) => toggleTag(x, t))} />
                  </Animated.View>
                ))}
              </View>
              <TextInput
                value={comment}
                onChangeText={(v) => setComment(v.slice(0, COMMENT_MAX))}
                placeholder="Anything else? (optional)"
                placeholderTextColor="#9A9AA2"
                multiline
                maxLength={COMMENT_MAX}
                accessibilityLabel="Comment (optional)"
                style={[s.comment, Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null]}
              />
              {!!error && <Text style={s.err} accessibilityRole="alert">{error}</Text>}
              <View style={s.actions}>
                {answer.rating && (
                  <Pressable onPress={() => { setEditing(false); setStars(answer.rating!.stars); setTags(answer.rating!.tags); setComment(answer.rating!.comment ?? ''); }} hitSlop={8}>
                    <Text style={s.link}>Cancel</Text>
                  </Pressable>
                )}
                <PressScale onPress={() => void submit()} disabled={busy} haptic scaleTo={0.96} style={[s.send, busy && { backgroundColor: C.brandSoft }]}>
                  {busy ? <ActivityIndicator color={C.brandInk} /> : <Text style={s.sendTxt}>{answer.rating ? 'Save rating' : 'Send rating'}</Text>}
                </PressScale>
              </View>
            </Animated.View>
          )}
          {!stars && !!onClose && (
            <Pressable onPress={onClose} hitSlop={8} style={{ alignSelf: 'center', marginTop: 14 }}><Text style={s.quiet}>Not now</Text></Pressable>
          )}
        </View>
      ) : (
        <Rated
          rating={answer.rating!}
          justSent={justSent}
          editable={ratingStage(order, answer.rating) === 'rated-editable'}
          onEdit={() => { setEditing(true); setJustSent(false); }}
        />
      )}

      {!editing && (
        <WalletTip
          orderId={order.id}
          tipped={tipped}
          onTipped={(amount) => setAnswer({ ...answer, tip: amount })}
        />
      )}

      {!editing && !!onClose && (
        <PressScale onPress={onClose} haptic scaleTo={0.96} style={[s.send, { alignSelf: 'stretch', marginTop: 16 }]}>
          <Text style={s.sendTxt}>Done</Text>
        </PressScale>
      )}

      <Confetti burstKey={burst} x={size.w / 2} y={70} count={30} />
    </Animated.View>
  );
}

/** The rating given: stars, the chips picked, "Change" while it can still change. */
function Rated({ rating, justSent, editable, onEdit }: { rating: OrderRating; justSent: boolean; editable: boolean; onEdit: () => void }) {
  const happy = rating.stars >= 4;
  return (
    <View>
      <View style={s.ratedHead}>
        {justSent ? (
          <Animated.Text entering={ZoomIn.springify().damping(9)} style={s.ratedEmoji}>{happy ? '🎉' : '🙏'}</Animated.Text>
        ) : null}
        <View style={{ flex: 1 }}>
          <Text style={s.title} accessibilityRole="header">
            {justSent ? (happy ? 'Thanks for rating!' : 'Thanks for telling us') : 'Your rating'}
          </Text>
          {justSent && !happy && <Text style={s.sub}>{"Sorry it wasn't great. We'll look into it."}</Text>}
        </View>
        {editable && (
          <Pressable onPress={onEdit} hitSlop={8} accessibilityRole="button" accessibilityLabel="Change your rating">
            <Text style={s.link}>Change</Text>
          </Pressable>
        )}
      </View>
      <View style={[s.miniStars]} accessible accessibilityLabel={`You rated ${rating.stars} out of 5 stars`}>
        {[1, 2, 3, 4, 5].map((n) => <StarIcon key={n} size={20} color={n <= rating.stars ? C.brandDeep : '#E3E3E8'} />)}
        <Text style={s.miniWord}>{starWord(rating.stars)}</Text>
      </View>
      {rating.tags.length > 0 && (
        <View style={[s.chips, { marginTop: 10 }]}>
          {rating.tags.map((t) => (
            <View key={t} style={[s.tag, s.tagOn, { height: 30 }]}><Text style={[s.tagTxt, s.tagTxtOn]}>{TAG_COPY[t].emoji} {TAG_COPY[t].label}</Text></View>
          ))}
        </View>
      )}
      {!!rating.comment && <Text style={[s.sub, { marginTop: 8 }]} numberOfLines={3}>“{rating.comment}”</Text>}
    </View>
  );
}

/**
 * "Tip your rider" from the Blynk Wallet: only when no tip is on the order and the balance covers
 * at least the smallest chip. Pick, then confirm (money moves on the second tap).
 */
function WalletTip({ orderId, tipped, onTipped }: { orderId: string; tipped: number; onTipped: (amount: number) => void }) {
  const [wallet, setWallet] = useState<{ enabled: boolean; balance: number } | null>(null);
  const [picked, setPicked] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);
  const [sent, setSent] = useState(0);
  const sending = useRef(false);

  useEffect(() => {
    if (DEMO || tipped > 0) return;
    let alive = true;
    fetchWallet(1, 1).then((w) => { if (alive) setWallet({ enabled: w.enabled, balance: w.balance }); }).catch(() => undefined);
    return () => { alive = false; };
  }, [tipped > 0]);

  if (sent > 0) {
    return (
      <Animated.View entering={FadeIn.duration(220)} style={s.tipDone}>
        <HeartPop />
        <Text style={[s.tipDoneTxt, { flex: 1 }]}>{TIP_COPY.thanks(sent)}</Text>
      </Animated.View>
    );
  }
  if (tipped > 0) {
    return <View style={s.tipDone}><Text style={s.tipDoneTxt}>{TIP_COPY.tipped(tipped)}</Text></View>;
  }
  const choices = hidden ? [] : walletTipChoices(wallet, tipped);
  if (!choices.length) return null;

  const send = async () => {
    if (!picked || sending.current) return;
    sending.current = true;
    setBusy(true);
    setError(null);
    try {
      await sendWalletTip(orderId, picked);
      setSent(picked);
      onTipped(picked);
    } catch (e) {
      if (isWalletLow(e)) { setHidden(true); return; }
      if (isAlreadyTipped(e)) { setHidden(true); return; }
      setError(e instanceof ApiError ? e.message : "We couldn't send the tip. Please try again.");
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };

  return (
    <Animated.View entering={FadeInDown.duration(260)} exiting={FadeOut.duration(150)} style={s.tipBox}>
      <Text style={s.tipTitle}>{TIP_COPY.walletTitle} 🛵</Text>
      <Text style={s.sub}>{TIP_COPY.walletSub(wallet!.balance)}</Text>
      <View style={[s.chips, { marginTop: 10 }]} accessibilityRole="radiogroup" accessibilityLabel={TIP_COPY.walletTitle}>
        {choices.map((a) => <TipChip key={a} label={`LKR ${a}`} on={picked === a} onPress={() => setPicked(picked === a ? 0 : a)} disabled={busy} />)}
      </View>
      {picked > 0 && (
        <Animated.View entering={FadeIn.duration(180)}>
          <PressScale onPress={() => void send()} disabled={busy} haptic scaleTo={0.96} style={[s.send, { alignSelf: 'stretch', marginTop: 12 }, busy && { backgroundColor: C.brandSoft }]}>
            {busy ? <ActivityIndicator color={C.brandInk} /> : <Text style={s.sendTxt}>{TIP_COPY.walletCta(picked)}</Text>}
          </PressScale>
        </Animated.View>
      )}
      {!!error && <Text style={s.err} accessibilityRole="alert">{error}</Text>}
      <Text style={[s.small, { marginTop: 8 }]}>100% goes to your rider.</Text>
    </Animated.View>
  );
}

/** A star that fills and springs (each one a beat after the one before), with a haptic tap. */
function PopStar({ index, filled, pop, onPress, label, selected }: {
  index: number; filled: boolean; pop: number; onPress: () => void; label: string; selected: boolean;
}) {
  const reduced = useReducedMotion();
  const sc = useSharedValue(1);
  const fill = useSharedValue(filled ? 1 : 0);
  useEffect(() => {
    fill.value = withTiming(filled ? 1 : 0, { duration: reduced ? 0 : 140 });
    if (filled && pop && !reduced) {
      sc.value = withDelay(index * 45, withSequence(
        withTiming(1.3, { duration: 110, easing: Easing.out(Easing.quad) }),
        withSpring(1, { damping: 6, stiffness: 300 }),
      ));
    }
  }, [filled, pop]);
  const a = useAnimatedStyle(() => ({ transform: [{ scale: sc.value }, { rotate: `${(sc.value - 1) * -40}deg` }] }));
  const on = useAnimatedStyle(() => ({ opacity: fill.value }));
  return (
    <Pressable onPress={onPress} hitSlop={4} accessibilityRole="radio" accessibilityState={{ selected }} accessibilityLabel={label} style={s.starHit}>
      <Animated.View style={[{ width: 42, height: 42 }, a]}>
        <View style={StyleSheet.absoluteFill}><StarIcon size={42} color="#E3E3E8" /></View>
        <Animated.View style={[StyleSheet.absoluteFill, on]}><StarIcon size={42} color={C.brandDeep} /></Animated.View>
      </Animated.View>
    </Pressable>
  );
}

function TagChip({ tag, on, onPress }: { tag: RatingTag; on: boolean; onPress: () => void }) {
  const reduced = useReducedMotion();
  const sc = useSharedValue(1);
  const press = () => {
    tap();
    if (!reduced) sc.value = withSequence(withTiming(0.92, { duration: 70 }), withSpring(1, { damping: 8, stiffness: 320 }));
    onPress();
  };
  const a = useAnimatedStyle(() => ({ transform: [{ scale: sc.value }] }));
  const c = TAG_COPY[tag];
  return (
    <Animated.View style={a}>
      <Pressable onPress={press} accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={c.label} style={[s.tag, on && s.tagOn]}>
        <Text style={[s.tagTxt, on && s.tagTxtOn]}>{c.emoji}  {c.label}</Text>
      </Pressable>
    </Animated.View>
  );
}

function HeartPop() {
  const reduced = useReducedMotion();
  const sc = useSharedValue(reduced ? 1 : 0.2);
  useEffect(() => {
    if (!reduced) sc.value = withSequence(withTiming(1.35, { duration: 180, easing: Easing.out(Easing.back(2)) }), withSpring(1, { damping: 7, stiffness: 260 }));
  }, []);
  const a = useAnimatedStyle(() => ({ transform: [{ scale: sc.value }] }));
  return <Animated.Text style={[{ fontSize: 22 }, a]}>💛</Animated.Text>;
}

/**
 * The tracking screen once the order is delivered: "Delivered" with the rating card, else the
 * screen's own note (`fallback`).
 */
export function DeliveredRating({ order, fallback, onViewOrder, top = 0 }: { order: Order; fallback: ReactNode; onViewOrder: () => void; top?: number }) {
  const store = useStore();
  const on = useFeatureOn(store, 'ratings');
  if (DEMO || !on || order.order_status !== 'DELIVERED') return <>{fallback}</>;
  return (
    <ScrollView contentContainerStyle={{ padding: 15, paddingTop: top + 70, paddingBottom: 40 }} style={{ backgroundColor: C.bg }} keyboardShouldPersistTaps="handled">
      <Animated.View entering={FadeIn.duration(220)} style={{ alignItems: 'center', marginBottom: 18 }}>
        <Animated.Text entering={ZoomIn.springify().damping(10)} style={{ fontSize: 46 }}>📦</Animated.Text>
        <Text style={[s.title, { fontSize: 20, marginTop: 6 }]}>Delivered</Text>
        <Text style={[s.sub, { textAlign: 'center' }]}>Your order {order.order_number} has arrived.</Text>
      </Animated.View>
      <OrderRatingCard order={order} />
      <PressScale onPress={onViewOrder} scaleTo={0.97} style={[s.send, { alignSelf: 'stretch', backgroundColor: '#fff', borderWidth: 1, borderColor: C.line }]}>
        <Text style={s.sendTxt}>View order</Text>
      </PressScale>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 15, marginBottom: 12 },
  bare: {},
  title: { ...T.title, fontSize: 17 },
  sub: { fontFamily: F.regular, fontSize: 12.5, color: C.sub, marginTop: 2, lineHeight: 17 },
  small: { fontFamily: F.regular, fontSize: 11.5, color: '#7A7A82', lineHeight: 16 },
  starRow: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 16 },
  starHit: { padding: 3 },
  word: { fontFamily: F.medium, fontSize: 13.5, color: C.sub, textAlign: 'center', marginTop: 8 },
  label: { fontFamily: F.semi, fontSize: 12.5, color: C.sub, marginTop: 16, marginBottom: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tag: { height: 34, borderRadius: 17, paddingHorizontal: 12, borderWidth: 1, borderColor: '#DCDCE2', backgroundColor: '#fff', justifyContent: 'center' },
  tagOn: { backgroundColor: C.brandTint, borderColor: C.brandDeep },
  tagTxt: { fontFamily: F.medium, fontSize: 12.5, color: '#4A4A52' },
  tagTxtOn: { fontFamily: F.semi, color: C.brandInk },
  comment: {
    minHeight: 70, marginTop: 12, borderRadius: 12, borderWidth: 1, borderColor: C.line, backgroundColor: '#FAFAFB',
    paddingHorizontal: 12, paddingVertical: 10, fontFamily: F.regular, fontSize: 14, color: C.ink, textAlignVertical: 'top',
  },
  err: { fontFamily: F.medium, fontSize: 12.5, color: C.problem, marginTop: 8 },
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 16, marginTop: 14 },
  send: { height: 46, borderRadius: 23, paddingHorizontal: 26, backgroundColor: C.brand, alignItems: 'center', justifyContent: 'center' },
  sendTxt: { fontFamily: F.semi, fontSize: 15, color: C.brandInk },
  link: { fontFamily: F.semi, fontSize: 13.5, color: C.brandText },
  quiet: { fontFamily: F.medium, fontSize: 13.5, color: C.sub },
  ratedHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  ratedEmoji: { fontSize: 28 },
  miniStars: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 8 },
  miniWord: { fontFamily: F.semi, fontSize: 13, color: C.ink, marginLeft: 8 },
  tipBox: { borderTopWidth: 1, borderTopColor: C.line, marginTop: 16, paddingTop: 14 },
  tipTitle: { fontFamily: F.bold, fontSize: 15.5, color: C.ink },
  tipDone: { flexDirection: 'row', alignItems: 'center', gap: 10, borderTopWidth: 1, borderTopColor: C.line, marginTop: 16, paddingTop: 12 },
  tipDoneTxt: { fontFamily: F.semi, fontSize: 13, color: C.greenDark, lineHeight: 18 },
});
