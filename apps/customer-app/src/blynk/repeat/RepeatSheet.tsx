import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, useReducedMotion } from 'react-native-reanimated';
import { Button, ErrorText } from '@/blynk/account/ui';
import { useDeliveryLocation } from '@/blynk/address/store';
import type { Product } from '@/blynk/api/types';
import { useCatalog } from '@/blynk/catalog/CatalogContext';
import { formatLkr } from '@/blynk/lib/money';
import { useStore } from '@/blynk/store/StoreContext';
import { ProductImage } from '@/components/ProductImage';
import { Confetti, tap } from '@/components/ui';
import { C, F } from '@/lib/theme';
import { createBasket } from './api';
import { SuccessTick } from './art';
import { ScheduleFields, openWeekday, withValidTime, type Draft } from './fields';
import { upsertBasket } from './hooks';
import type { BasketItem, RepeatBasket } from './models';
import { createBody, estimate, matchAddress, repeatErrorText } from './payload';
import { colombo, firstRun, nextRunText, scheduleText, suggestName, timeLabel, whenText } from './schedule';
import { SheetModal, useSheetClose } from './sheet';
import { REPEAT_WORDS } from './words';

/*
 * "Repeat this basket" (from a delivered order or the cart): how often, the weekday, the time
 * inside the store's hours, the address, the first day, then a summary with an estimate at
 * today's prices -> POST /me/repeat-baskets -> a tick, confetti and when the first order goes.
 */

export interface RepeatSource {
  items: BasketItem[];
  /** The price a size line last had (the catalogue list has no size prices). */
  priceOf?: (it: BasketItem) => number | null;
  /** Names for lines the catalogue no longer has. */
  nameOf?: (it: BasketItem) => string | null;
  /** From an order: where it went (picks the matching saved address) and when it was placed. */
  order?: { line1: string | null; city: string | null; lat?: number | string | null; lng?: number | string | null; placedAt: string | null } | null;
  /** Combo packs are not repeated: say so when the source had some. */
  hadCombos?: boolean;
}

export function RepeatCreateSheet({ source, onClose }: { source: RepeatSource; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <SheetModal onClose={onClose} label={REPEAT_WORDS.create.title} busy={busy}>
      <Body source={source} busy={busy} setBusy={setBusy} />
    </SheetModal>
  );
}

const quarter = (iso: string | null | undefined): string | null => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const m = Math.round(colombo(d).minutes / 15) * 15;
  return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

function Body({ source, busy, setBusy }: { source: RepeatSource; busy: boolean; setBusy: (b: boolean) => void }) {
  const close = useSheetClose();
  const store = useStore();
  const { data } = useCatalog();
  const products = data?.products ?? null;
  const loc = useDeliveryLocation();
  const addresses = loc.addresses;
  const reduced = useReducedMotion();
  const { width } = useWindowDimensions();

  const [draft, setDraft] = useState<Draft>(() => {
    const now = new Date();
    const from = source.order?.placedAt ? colombo(new Date(source.order.placedAt)).weekday : (colombo(now).weekday + 1) % 7;
    return withValidTime({
      frequency: 'WEEKLY',
      weekday: openWeekday(store, from),
      time: quarter(source.order?.placedAt),
      addressId: null,
      startDate: colombo(now).ymd,
    }, store);
  });
  // the store's hours and the addresses arrive after the sheet opens: fill in what is still unset
  useEffect(() => { setDraft((d) => withValidTime(d, store)); }, [store]);
  useEffect(() => {
    if (draft.addressId || !addresses?.length) return;
    const a = source.order ? matchAddress(addresses, source.order) : (loc.address ?? matchAddress(addresses, null));
    if (a) setDraft((d) => ({ ...d, addressId: a.id }));
  }, [addresses, draft.addressId]);

  const est = useMemo(() => estimate(source.items, products ?? [], source.priceOf), [source.items, products, source.priceOf]);
  const first = draft.time ? firstRun({ frequency: draft.frequency, weekday: draft.weekday, placeAt: draft.time, startDate: draft.startDate }) : null;
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<RepeatBasket | null>(null);
  const [burst, setBurst] = useState(0);
  const sending = useRef(false);

  const canSend = !!draft.time && !!draft.addressId && source.items.length > 0 && !busy;
  const send = async () => {
    if (!canSend || sending.current) return;
    sending.current = true;
    setBusy(true);
    setError(null);
    try {
      const b = await createBasket(createBody(source.items, {
        frequency: draft.frequency,
        weekday: draft.weekday,
        placeAt: draft.time!,
        addressId: draft.addressId!,
        startDate: draft.startDate,
        name: suggestName(draft.frequency, draft.weekday),
      }));
      upsertBasket(b);
      setDone(b);
      tap();
      if (!reduced) setBurst(Date.now());
    } catch (e) {
      setError(repeatErrorText(e));
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };

  if (done) {
    const next = nextRunText(done.nextRunAt) ?? (first ? REPEAT_WORDS.create.firstOrderLine(whenText(first)) : null);
    return (
      <View style={st.done}>
        <Confetti burstKey={burst} x={width / 2 - 24} y={150} count={30} />
        <SuccessTick />
        <Animated.Text entering={reduced ? undefined : FadeInDown.delay(180).duration(260)} style={st.doneTitle}>{REPEAT_WORDS.create.doneTitle}</Animated.Text>
        <Animated.View entering={reduced ? undefined : FadeIn.delay(300).duration(260)} style={{ alignItems: 'center' }}>
          <Text style={st.doneSub}>{scheduleText(done.frequency, done.weekday, done.placeAt)}</Text>
          {!!next && <Text style={st.doneNext}>{next}</Text>}
          <Text style={[st.small, { textAlign: 'center', marginTop: 8 }]}>{REPEAT_WORDS.create.doneSmall}</Text>
        </Animated.View>
        <View style={st.pair}>
          <Button label={REPEAT_WORDS.create.seeBaskets} kind="secondary" onPress={() => { close(); setTimeout(() => router.push('/repeat-baskets'), 220); }} style={{ flex: 1 }} />
          <Button label={REPEAT_WORDS.create.done} onPress={close} style={{ flex: 1 }} />
        </View>
      </View>
    );
  }

  return (
    <View>
      <Text style={st.title}>{REPEAT_WORDS.create.title}</Text>
      <Text style={st.small}>{REPEAT_WORDS.create.sub}</Text>
      <ItemStrip items={source.items} products={products} />
      {source.hadCombos && <Text style={[st.small, { marginTop: 6 }]}>{REPEAT_WORDS.create.combosNot}</Text>}

      <ScheduleFields
        draft={draft}
        onChange={setDraft}
        store={store}
        addresses={addresses}
        addressNote={source.order?.line1 ? REPEAT_WORDS.create.addressWent([source.order.line1, source.order.city].filter(Boolean).join(', ')) : null}
      />

      <View style={st.summary}>
        <Text style={st.sumTitle}>{draft.time ? scheduleText(draft.frequency, draft.weekday, draft.time) : REPEAT_WORDS.create.pickTime}</Text>
        {!!first && <Text style={st.sumLine}>{REPEAT_WORDS.create.firstOrder}{' '}<Text style={st.sumStrong}>{whenText(first)}</Text></Text>}
        <Text style={st.sumLine}>
          {REPEAT_WORDS.create.sum(est.units).before}<Text style={st.sumStrong}>{formatLkr(est.total)}</Text>{REPEAT_WORDS.create.sum(est.units).after}
        </Text>
        {est.unavailable > 0 && (
          <Text style={[st.sumLine, { color: C.brandText }]}>
            {REPEAT_WORDS.create.leftOut(est.unavailable)}
          </Text>
        )}
        <Text style={st.sumNote}>{REPEAT_WORDS.create.sumNote}</Text>
      </View>

      <ErrorText>{error}</ErrorText>
      <Button
        label={draft.time ? REPEAT_WORDS.create.repeatAt(timeLabel(draft.time)) : REPEAT_WORDS.create.title}
        onPress={() => void send()}
        busy={busy}
        disabled={!canSend}
        style={{ marginTop: 16 }}
      />
    </View>
  );
}

/** Up to six of the basket's photos in a row with the count. */
export function ItemStrip({ items, products, size = 40 }: { items: BasketItem[]; products: Product[] | null; size?: number }) {
  const byId = useMemo(() => new Map((products ?? []).map((p) => [p.id, p] as const)), [products]);
  const shown = items.slice(0, 6);
  const more = items.length - shown.length;
  return (
    <View style={st.strip} accessibilityLabel={REPEAT_WORDS.card.products(items.length)}>
      {shown.map((it) => {
        const p = byId.get(it.product_id);
        return (
          <View key={`${it.product_id}:${it.variant_id ?? ''}`} style={{ width: size, height: size }}>
            {p ? (
              <ProductImage product={p} size={size} radius={10} style={[st.thumb, !p.is_available && { opacity: 0.4 }]} />
            ) : (
              <View style={[st.thumb, st.thumbGone, { width: size, height: size }]}><Text style={st.small}>?</Text></View>
            )}
            {it.quantity > 1 && <View style={st.qty}><Text style={st.qtyTxt}>{it.quantity}</Text></View>}
          </View>
        );
      })}
      {more > 0 && <View style={[st.thumb, st.more, { width: size, height: size }]}><Text style={st.moreTxt}>+{more}</Text></View>}
    </View>
  );
}

export const repeatStyles = StyleSheet.create({
  small: { fontFamily: F.regular, fontSize: 12.5, color: C.sub, lineHeight: 17 },
});

const st = StyleSheet.create({
  title: { fontFamily: F.bold, fontSize: 19, color: C.ink, letterSpacing: -0.2, marginBottom: 4 },
  small: repeatStyles.small,
  strip: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  thumb: { borderRadius: 10, borderWidth: 1, borderColor: C.line, backgroundColor: C.white },
  thumbGone: { alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg },
  qty: { position: 'absolute', right: -4, top: -4, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, backgroundColor: C.ink, alignItems: 'center', justifyContent: 'center' },
  qtyTxt: { fontFamily: F.bold, fontSize: 10.5, color: C.white },
  more: { alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg },
  moreTxt: { fontFamily: F.semi, fontSize: 12.5, color: C.sub },
  summary: { marginTop: 20, backgroundColor: C.brandTint, borderRadius: 16, borderWidth: 1, borderColor: C.brandSoft, padding: 14 },
  sumTitle: { fontFamily: F.bold, fontSize: 15.5, color: C.ink, marginBottom: 4 },
  sumLine: { fontFamily: F.regular, fontSize: 13, color: C.text, lineHeight: 19 },
  sumStrong: { fontFamily: F.semi, color: C.ink },
  sumNote: { fontFamily: F.regular, fontSize: 11.5, color: C.sub, marginTop: 6 },
  done: { alignItems: 'center', paddingTop: 10 },
  doneTitle: { fontFamily: F.bold, fontSize: 20, color: C.ink, marginTop: 14, letterSpacing: -0.2 },
  doneSub: { fontFamily: F.medium, fontSize: 14, color: C.text, marginTop: 6 },
  doneNext: { fontFamily: F.semi, fontSize: 14, color: C.brandText, marginTop: 4 },
  pair: { flexDirection: 'row', gap: 10, marginTop: 22, alignSelf: 'stretch' },
});
