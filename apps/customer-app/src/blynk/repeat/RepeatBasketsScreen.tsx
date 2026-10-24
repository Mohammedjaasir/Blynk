import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeOutLeft, LinearTransition, useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { showNotice } from '@/blynk/account/notice';
import { Button, ErrorText, ScreenHeader } from '@/blynk/account/ui';
import { addressSummary } from '@/blynk/address/api';
import { useDeliveryLocation } from '@/blynk/address/store';
import type { Product } from '@/blynk/api/types';
import { useCatalog } from '@/blynk/catalog/CatalogContext';
import { formatLkr } from '@/blynk/lib/money';
import { useStore } from '@/blynk/store/StoreContext';
import { ProductImage } from '@/components/ProductImage';
import { PressScale, Skeleton, tap } from '@/components/ui';
import { C, F } from '@/lib/theme';
import { cancelBasket, toggleSkipNext, updateBasket } from './api';
import { BasketPopArt } from './art';
import { ScheduleFields, withValidTime, type Draft } from './fields';
import { removeBasket, upsertBasket, useRepeatBaskets } from './hooks';
import { clampLineQty, MAX_BASKETS, type BasketItem, type RepeatBasket } from './models';
import { patchBody, repeatErrorText } from './payload';
import { ItemStrip } from './RepeatSheet';
import { colombo, nextLine, scheduleText, whenText } from './schedule';
import { SheetModal, useSheetClose } from './sheet';

/*
 * "Repeat baskets" (Profile and Home's Buy again): each basket as a card - when the next order
 * goes (with a countdown), what is in it, pause / resume, skip the next one, edit the items and
 * the schedule, cancel - and how the last run went (placed, with the order; skipped or failed,
 * with the reason). Cards slide in, re-flow and slide out as they change.
 */

export function RepeatBasketsScreen() {
  const insets = useSafeAreaInsets();
  const { on, list, loading, error, refresh } = useRepeatBaskets();
  const { data } = useCatalog();
  const products = data?.products ?? null;
  const loc = useDeliveryLocation();
  const [editing, setEditing] = useState<RepeatBasket | null>(null);
  const [cancelling, setCancelling] = useState<RepeatBasket | null>(null);
  const reduced = useReducedMotion();

  return (
    <View style={st.screen}>
      <StatusBar style="dark" />
      <ScreenHeader title="Repeat baskets" top={insets.top} />
      <ScrollView contentContainerStyle={{ padding: 15, paddingBottom: insets.bottom + 40 }}>
        {!on ? (
          <Empty title="Repeat baskets are not available right now" sub="Please check again later." />
        ) : list === null && error ? (
          <Empty title="Couldn't load your repeat baskets" sub={error} cta="Try again" onPress={refresh} />
        ) : list === null ? (
          <>
            <Skeleton h={190} r={16} style={{ marginBottom: 12 }} />
            <Skeleton h={190} r={16} />
          </>
        ) : list.length === 0 ? (
          <Empty
            art
            title="No repeat baskets yet"
            sub="Get milk and bread every morning, or your weekly shop every Monday. Start from your cart or a delivered order."
            cta="Go to my orders"
            onPress={() => router.push('/orders')}
          />
        ) : (
          <>
            <Text style={st.intro}>We place these orders for you, cash on delivery. You get an SMS each time.</Text>
            {list.map((b, i) => (
              <Animated.View
                key={b.id}
                entering={reduced ? undefined : FadeInDown.delay(Math.min(i, 4) * 70).duration(320)}
                exiting={reduced ? undefined : FadeOutLeft.duration(220)}
                layout={reduced ? undefined : LinearTransition.springify().damping(18).stiffness(160)}
              >
                <BasketCard
                  basket={b}
                  products={products}
                  addressLine={(() => {
                    const a = loc.addresses?.find((x) => x.id === b.addressId);
                    return a ? `${a.label} · ${addressSummary(a)}` : null;
                  })()}
                  onEdit={() => setEditing(b)}
                  onCancel={() => setCancelling(b)}
                />
              </Animated.View>
            ))}
            <Animated.Text layout={reduced ? undefined : LinearTransition} style={st.footNote}>
              {list.length >= MAX_BASKETS ? `You have the most baskets you can (${MAX_BASKETS}).` : 'Add another from your cart or a delivered order.'}
            </Animated.Text>
            {loading && <Text style={[st.footNote, { marginTop: 4 }]}>Refreshing…</Text>}
          </>
        )}
      </ScrollView>

      {editing && <EditSheet basket={editing} products={products} onClose={() => setEditing(null)} />}
      {cancelling && <CancelSheet basket={cancelling} onClose={() => setCancelling(null)} />}
    </View>
  );
}

function Empty({ title, sub, cta, onPress, art }: { title: string; sub: string; cta?: string; onPress?: () => void; art?: boolean }) {
  return (
    <Animated.View entering={FadeIn.duration(240)} style={st.empty}>
      {art ? <BasketPopArt /> : <Text style={{ fontSize: 50 }}>🧺</Text>}
      <Text style={st.emptyTitle}>{title}</Text>
      <Text style={st.emptySub}>{sub}</Text>
      {!!cta && <Button label={cta} onPress={onPress ?? (() => {})} style={{ marginTop: 18, paddingHorizontal: 26 }} />}
    </Animated.View>
  );
}

const TONE = { active: C.ink, paused: C.sub, skip: C.brandText } as const;

function BasketCard({ basket: b, products, addressLine, onEdit, onCancel }: {
  basket: RepeatBasket; products: Product[] | null; addressLine: string | null; onEdit: () => void; onCancel: () => void;
}) {
  const [busy, setBusy] = useState<'status' | 'skip' | null>(null);
  const [optimistic, setOptimistic] = useState<boolean | null>(null);
  const active = optimistic ?? b.status === 'ACTIVE';
  const head = nextLine({ ...b, status: active ? 'ACTIVE' : 'PAUSED' });
  const units = b.items.reduce((a, it) => a + it.quantity, 0);

  const toggle = async (v: boolean) => {
    if (busy) return;
    setBusy('status');
    setOptimistic(v);
    tap();
    try {
      upsertBasket(await updateBasket(b.id, { status: v ? 'ACTIVE' : 'PAUSED' }));
      showNotice(v ? `${b.name} is back on` : `${b.name} is paused`);
    } catch (e) {
      showNotice(repeatErrorText(e), 'problem');
    } finally {
      setOptimistic(null);
      setBusy(null);
    }
  };
  const skip = async () => {
    if (busy) return;
    setBusy('skip');
    try {
      const next = await toggleSkipNext(b.id);
      upsertBasket(next);
      showNotice(next.skipNext ? 'The next one is skipped' : 'The next one is back on');
    } catch (e) {
      showNotice(repeatErrorText(e), 'problem');
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={[st.card, !active && st.cardPaused]}>
      <View style={st.top}>
        <View style={{ flex: 1 }}>
          <Text style={st.name} numberOfLines={1}>{b.name}</Text>
          <Text style={st.sched} numberOfLines={2}>{scheduleText(b.frequency, b.weekday, b.placeAt)}</Text>
        </View>
        <Switch
          value={active}
          onValueChange={(v) => void toggle(v)}
          disabled={busy !== null}
          trackColor={{ false: '#D9D9DF', true: C.brand }}
          thumbColor={active ? C.brandInk : '#FFFFFF'}
          // react-native-web colours the "on" thumb with its own prop (teal by default)
          {...({ activeThumbColor: C.brandInk, activeTrackColor: C.brand } as object)}
          accessibilityLabel={active ? `Pause ${b.name}` : `Resume ${b.name}`}
        />
      </View>

      <Animated.View key={`${head.tone}-${head.title}`} entering={FadeIn.duration(220)} style={[st.next, head.tone === 'skip' && st.nextSkip, head.tone === 'paused' && st.nextPaused]}>
        <Text style={[st.nextTitle, { color: TONE[head.tone] }]}>{head.title}</Text>
        {!!head.sub && <Text style={st.nextSub}>{head.sub}</Text>}
      </Animated.View>

      <ItemStrip items={b.items} products={products} size={38} />
      <Text style={st.meta}>
        {units} {units === 1 ? 'item' : 'items'}
        {b.estimate ? ` · about ${formatLkr(b.estimate.itemsTotal)} today` : ''}
        {b.estimate && b.estimate.unavailableLines > 0 ? ` · ${b.estimate.unavailableLines} not available now` : ''}
      </Text>
      {!!addressLine && <Text style={st.meta} numberOfLines={1}>To {addressLine}</Text>}

      {!!b.lastRun && <LastRun run={b.lastRun} />}

      <View style={st.actions}>
        {active && (
          <Action label={busy === 'skip' ? '…' : b.skipNext ? 'Undo skip' : 'Skip next'} onPress={() => void skip()} disabled={busy !== null} />
        )}
        <Action label="Edit" onPress={onEdit} disabled={busy !== null} />
        <Action label="Cancel" onPress={onCancel} danger disabled={busy !== null} />
      </View>
    </View>
  );
}

function LastRun({ run }: { run: NonNullable<RepeatBasket['lastRun']> }) {
  const when = run.runAt ? whenText(new Date(run.runAt)) : null;
  const tone = run.status === 'PLACED' ? C.greenDark : run.status === 'FAILED' ? C.problem : C.sub;
  const word = run.status === 'PLACED' ? 'Ordered' : run.status === 'SKIPPED' ? 'Skipped' : "Couldn't order";
  return (
    <View style={st.last}>
      <View style={[st.dot, { backgroundColor: tone }]} />
      <View style={{ flex: 1 }}>
        <Text style={st.lastTxt}>
          <Text style={{ fontFamily: F.semi, color: tone }}>Last: {word}</Text>
          {when ? ` ${when}` : ''}
        </Text>
        {!!run.reason && <Text style={st.lastReason} numberOfLines={2}>{run.reason}</Text>}
      </View>
      {run.status === 'PLACED' && !!run.orderId && (
        <Pressable onPress={() => router.push(`/order/${run.orderId}`)} hitSlop={8} accessibilityRole="link">
          <Text style={st.link}>View order</Text>
        </Pressable>
      )}
    </View>
  );
}

function Action({ label, onPress, danger, disabled }: { label: string; onPress: () => void; danger?: boolean; disabled?: boolean }) {
  return (
    <PressScale onPress={disabled ? undefined : onPress} disabled={disabled} scaleTo={0.94} style={[st.action, danger && st.actionDanger]} accessibilityRole="button">
      <Text style={[st.actionTxt, danger && { color: C.problem }]}>{label}</Text>
    </PressScale>
  );
}

/* ---------------------------------------------------------------- edit */

function EditSheet({ basket, products, onClose }: { basket: RepeatBasket; products: Product[] | null; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <SheetModal onClose={onClose} label={`Edit ${basket.name}`} busy={busy}>
      <EditBody basket={basket} products={products} busy={busy} setBusy={setBusy} />
    </SheetModal>
  );
}

function EditBody({ basket: b, products, busy, setBusy }: { basket: RepeatBasket; products: Product[] | null; busy: boolean; setBusy: (v: boolean) => void }) {
  const close = useSheetClose();
  const store = useStore();
  const loc = useDeliveryLocation();
  const reduced = useReducedMotion();
  const [items, setItems] = useState<BasketItem[]>(b.items);
  const [draft, setDraft] = useState<Draft>(() => withValidTime({
    frequency: b.frequency,
    weekday: b.weekday ?? colombo(new Date()).weekday,
    time: b.placeAt,
    addressId: b.addressId,
    startDate: colombo(new Date()).ymd,
  }, store));
  const [error, setError] = useState<string | null>(null);
  const byId = useMemo(() => new Map((products ?? []).map((p) => [p.id, p] as const)), [products]);

  const setQty = (i: number, q: number) => setItems((l) => (q <= 0 ? l.filter((_, k) => k !== i) : l.map((it, k) => (k === i ? { ...it, quantity: clampLineQty(q) } : it))));

  const save = async () => {
    if (busy) return;
    if (!items.length) { setError('Keep at least one item, or cancel the basket instead.'); return; }
    const body = patchBody(b, { items, frequency: draft.frequency, weekday: draft.weekday, placeAt: draft.time ?? undefined, addressId: draft.addressId ?? undefined });
    if (!body) { close(); return; }
    setBusy(true);
    setError(null);
    try {
      upsertBasket(await updateBasket(b.id, body));
      showNotice('Repeat basket saved');
      close();
    } catch (e) {
      setError(repeatErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View>
      <Text style={st.sheetTitle}>Edit {b.name}</Text>
      <Text style={st.label}>Items</Text>
      <View style={st.lines}>
        {items.map((it, i) => {
          const p = byId.get(it.product_id);
          return (
            <Animated.View
              key={`${it.product_id}:${it.variant_id ?? ''}`}
              exiting={reduced ? undefined : FadeOutLeft.duration(180)}
              layout={reduced ? undefined : LinearTransition.duration(200)}
              style={[st.line, i > 0 && st.lineSep]}
            >
              {p ? <ProductImage product={p} size={38} radius={9} style={st.lineImg} /> : <View style={[st.lineImg, { width: 38, height: 38 }]} />}
              <View style={{ flex: 1 }}>
                <Text style={st.lineName} numberOfLines={2}>{p?.name ?? 'No longer sold'}</Text>
                {p && !p.is_available && <Text style={[st.meta, { marginTop: 0, color: C.brandText }]}>Not available now</Text>}
              </View>
              <View style={st.stepper}>
                <Pressable onPress={() => setQty(i, it.quantity - 1)} hitSlop={6} style={st.stepBtn} accessibilityLabel={it.quantity === 1 ? 'Remove' : 'One less'}>
                  <Text style={st.stepTxt}>{it.quantity === 1 ? '×' : '−'}</Text>
                </Pressable>
                <Text style={st.stepQty}>{it.quantity}</Text>
                <Pressable onPress={() => setQty(i, it.quantity + 1)} disabled={it.quantity >= 20} hitSlop={6} style={st.stepBtn} accessibilityLabel="One more">
                  <Text style={[st.stepTxt, it.quantity >= 20 && { color: C.faint }]}>+</Text>
                </Pressable>
              </View>
            </Animated.View>
          );
        })}
        {items.length === 0 && <Text style={[st.meta, { padding: 12 }]}>No items left.</Text>}
      </View>

      <ScheduleFields draft={draft} onChange={setDraft} store={store} addresses={loc.addresses} showStart={false} />
      <ErrorText>{error}</ErrorText>
      <View style={st.pair}>
        <Button label="Close" kind="secondary" onPress={close} disabled={busy} style={{ flex: 1 }} />
        <Button label="Save" onPress={() => void save()} busy={busy} disabled={!draft.time} style={{ flex: 1 }} />
      </View>
    </View>
  );
}

function CancelSheet({ basket, onClose }: { basket: RepeatBasket; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <SheetModal onClose={onClose} label={`Cancel ${basket.name}`} busy={busy}>
      <CancelBody basket={basket} busy={busy} setBusy={setBusy} />
    </SheetModal>
  );
}

function CancelBody({ basket: b, busy, setBusy }: { basket: RepeatBasket; busy: boolean; setBusy: (v: boolean) => void }) {
  const close = useSheetClose();
  const [error, setError] = useState<string | null>(null);
  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      await cancelBasket(b.id);
      removeBasket(b.id);
      showNotice(`${b.name} is cancelled`);
      close();
    } catch (e) {
      setError(repeatErrorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <View>
      <Text style={st.sheetTitle}>Cancel {b.name}?</Text>
      <Text style={st.meta}>No more orders will be placed from it. Orders already placed are not affected. You can pause it instead.</Text>
      <ErrorText>{error}</ErrorText>
      <View style={st.pair}>
        <Button label="Keep it" kind="secondary" onPress={close} disabled={busy} style={{ flex: 1 }} />
        <Button label="Cancel basket" kind="danger" onPress={() => void go()} busy={busy} style={{ flex: 1 }} />
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  intro: { fontFamily: F.regular, fontSize: 12.5, color: C.sub, marginBottom: 12, marginHorizontal: 4, lineHeight: 17 },
  footNote: { fontFamily: F.regular, fontSize: 12, color: C.sub, textAlign: 'center', marginTop: 6 },
  empty: { alignItems: 'center', paddingTop: 50, paddingHorizontal: 18 },
  emptyTitle: { fontFamily: F.bold, fontSize: 18, color: C.ink, marginTop: 14, textAlign: 'center' },
  emptySub: { fontFamily: F.regular, fontSize: 13.5, color: C.sub, marginTop: 6, textAlign: 'center', lineHeight: 19 },
  card: { backgroundColor: C.white, borderRadius: 16, padding: 15, marginBottom: 12 },
  cardPaused: { opacity: 0.86 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  name: { fontFamily: F.bold, fontSize: 16.5, color: C.ink, letterSpacing: -0.2 },
  sched: { fontFamily: F.regular, fontSize: 12.5, color: C.sub, marginTop: 2 },
  next: { marginTop: 12, backgroundColor: C.brandTint, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9 },
  nextSkip: { backgroundColor: '#FFF4E0' },
  nextPaused: { backgroundColor: C.bg },
  nextTitle: { fontFamily: F.bold, fontSize: 15, letterSpacing: -0.1 },
  nextSub: { fontFamily: F.regular, fontSize: 12, color: C.sub, marginTop: 1 },
  meta: { fontFamily: F.regular, fontSize: 12.5, color: C.sub, marginTop: 8, lineHeight: 17 },
  last: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, paddingTop: 11, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line },
  dot: { width: 8, height: 8, borderRadius: 4 },
  lastTxt: { fontFamily: F.regular, fontSize: 12.5, color: C.text },
  lastReason: { fontFamily: F.regular, fontSize: 12, color: C.sub, marginTop: 1 },
  link: { fontFamily: F.semi, fontSize: 13, color: C.brandText },
  actions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  action: { flex: 1, height: 36, borderRadius: 18, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center' },
  actionDanger: { borderColor: '#F3D3CF' },
  actionTxt: { fontFamily: F.semi, fontSize: 13, color: C.ink },
  sheetTitle: { fontFamily: F.bold, fontSize: 19, color: C.ink, letterSpacing: -0.2, marginBottom: 4 },
  label: { fontFamily: F.semi, fontSize: 12, color: C.sub, letterSpacing: 0.4, textTransform: 'uppercase', marginTop: 14, marginBottom: 8 },
  lines: { borderWidth: 1, borderColor: C.line, borderRadius: 14, overflow: 'hidden' },
  line: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: C.white },
  lineSep: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line },
  lineImg: { borderRadius: 9, borderWidth: 1, borderColor: C.line, backgroundColor: C.bg },
  lineName: { fontFamily: F.medium, fontSize: 13, color: C.ink },
  stepper: { flexDirection: 'row', alignItems: 'center', borderWidth: 1.2, borderColor: C.brandInk, borderRadius: 15, height: 30, paddingHorizontal: 4 },
  stepBtn: { width: 24, alignItems: 'center' },
  stepTxt: { fontFamily: F.bold, fontSize: 16, color: C.brandInk },
  stepQty: { fontFamily: F.semi, fontSize: 13, color: C.brandInk, minWidth: 18, textAlign: 'center' },
  pair: { flexDirection: 'row', gap: 10, marginTop: 18 },
});
