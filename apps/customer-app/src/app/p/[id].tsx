import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getCombos } from '@/blynk/api/catalog';
import { ApiError } from '@/blynk/api/client';
import type { Combo, Product } from '@/blynk/api/types';
import { useSession } from '@/blynk/auth/session';
import { useCatalog } from '@/blynk/catalog/CatalogContext';
import {
  combosWith, detailRows, fetchProductDetail, isProductGone, NOTIFY_ME_LABEL, NOTIFY_ME_ON_HINT, NOTIFY_ME_ON_LABEL,
  notifyMeAction, setNotifyMe, unitLine,
} from '@/blynk/catalog/product';
import { recallProduct } from '@/blynk/catalog/productCache';
import { formatLkr } from '@/blynk/lib/money';
import { effectivePrice, isOfferActive, savingsPerUnit } from '@/blynk/lib/pricing';
import { orderTime } from '@/blynk/orders/status';
import { productShareText } from '@/blynk/share/links';
import { shareText } from '@/blynk/share/share';
import { useStore } from '@/blynk/store/StoreContext';
import { Badge, Button, StateView, useToast } from '@/blynk/ui/kit';
import { openSignIn } from '@/blynk/ui/signIn';
import { BackIcon, ShareIcon } from '@/components/icons';
import { ProductImage } from '@/components/ProductImage';
import { Chevron as Caret, Collapsible, PressScale, Skeleton } from '@/components/ui';
import { DEMO } from '@/demo/mode';
import { cartActions, useCartSelect } from '@/lib/cart';
import { goBack } from '@/lib/nav';
import { C, F } from '@/lib/theme';

/*
 * The product page (Flutter ProductDetailsScreen), opened from any product card and from a shared
 * link (`/p/<id>`, the website sends https://blynk.lk/p/<id> to /app/#/p/<id>). The copy the
 * customer tapped shows at once, then GET /catalog/products/:id brings the current price and
 * availability (and, signed in, whether "Notify me" is on). Only real fields are drawn: no
 * ratings, reviews or per-unit prices the backend does not have.
 */
export default function ProductPage() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const { data } = useCatalog();
  const store = useStore();
  const session = useSession();
  const signedIn = !!session;
  const [toast, showToast] = useToast();

  const listed = useMemo(() => recallProduct(id) ?? data?.products.find((p) => p.id === id) ?? null, [id, data]);
  const [fresh, setFresh] = useState<Product | null>(null);
  const [gone, setGone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notify, setNotify] = useState(false);
  const [notifyBusy, setNotifyBusy] = useState(false);
  const [combos, setCombos] = useState<Combo[]>([]);
  const seq = useRef(0);

  const load = useCallback(() => {
    if (DEMO || !id) return;
    const n = ++seq.current;
    fetchProductDetail(id)
      .then((d) => { if (n === seq.current) { setFresh(d.product); setNotify(d.notifyMe); setGone(false); setError(null); } })
      .catch((e) => {
        if (n !== seq.current) return;
        if (isProductGone(e)) setGone(true);
        else setError(e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');
      });
  }, [id]);

  // again when the customer signs in or out: notify_me_subscribed is per customer
  useEffect(() => { load(); }, [load, session?.user.id]);

  useEffect(() => {
    if (DEMO || !id) return;
    let alive = true;
    getCombos().then((r) => { if (alive) setCombos(combosWith(id, r.combos)); }).catch(() => {});
    return () => { alive = false; };
  }, [id]);

  const product = gone ? null : fresh ?? listed;
  const showSavings = DEMO || store?.show_offer_savings === true;

  const share = async () => {
    if (!product) return;
    const r = await shareText(productShareText(product.name, product.id), product.name);
    if (r === 'copied') showToast('Link copied');
  };

  const toggleNotify = async () => {
    if (!product || notifyBusy) return;
    const action = notifyMeAction(signedIn, notify);
    if (action === 'sign-in') { openSignIn(); return; }
    setNotifyBusy(true);
    try {
      const r = await setNotifyMe(product.id, action === 'subscribe');
      if (r === 'back-in-stock') { setNotify(false); load(); } else setNotify(r === 'on');
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');
    } finally {
      setNotifyBusy(false);
    }
  };

  const hero = Math.min(width - 30, Math.round(height * 0.42), 420);

  return (
    <View style={{ flex: 1, backgroundColor: '#fff' }}>
      <StatusBar style="dark" />
      <View style={[styles.top, { paddingTop: insets.top + 8 }]}>
        <PressScale onPress={goBack} style={styles.round}><BackIcon size={18} color={C.ink} stroke={2} /></PressScale>
        {product && (
          <PressScale onPress={() => void share()} style={styles.round}>
            <View accessible accessibilityRole="button" accessibilityLabel="Share this product"><ShareIcon size={16} color={C.ink} /></View>
          </PressScale>
        )}
      </View>

      {gone ? (
        <StateView title="Product no longer available" message="This item has been removed from the store." action="Go back" onAction={goBack} />
      ) : !product ? (
        error ? (
          <StateView title="Couldn't load this product" message={error} action="Try again" onAction={() => { setError(null); load(); }} />
        ) : DEMO ? (
          <StateView title="Product preview" message="Products open here once the shop is live." action="Go back" onAction={goBack} />
        ) : (
          <View style={{ padding: 15, alignItems: 'center' }} accessibilityLabel="Loading product">
            <Skeleton w={hero} h={hero} r={18} />
            <View style={{ alignSelf: 'stretch', marginTop: 24, gap: 10 }}>
              <Skeleton w={90} h={12} /><Skeleton h={26} /><Skeleton w={160} h={14} /><Skeleton w={140} h={30} />
            </View>
          </View>
        )
      ) : (
        <>
          <ScrollView contentContainerStyle={{ paddingHorizontal: 15, paddingBottom: 150 }}>
            <Animated.View entering={FadeIn.duration(220)} style={{ alignItems: 'center', marginTop: 4 }}>
              <View style={[styles.hero, { width: hero, height: hero }]}>
                <View style={!product.is_available && { opacity: 0.45 }}>
                  <ProductImage product={product} size={hero - 40} style={{ backgroundColor: 'transparent' }} />
                </View>
              </View>
            </Animated.View>

            <Animated.View entering={FadeInDown.delay(60).duration(300)}>
              {!!product.category_name && <Text style={styles.cat}>{product.category_name}</Text>}
              <Text style={styles.name} accessibilityRole="header">{product.name}</Text>
              {!!unitLine(product) && <Text style={styles.unit}>{unitLine(product)}</Text>}

              <View style={styles.priceRow}>
                <Text style={styles.price}>{formatLkr(effectivePrice(product))}</Text>
                {isOfferActive(product) && showSavings && <Text style={styles.mrp}>{formatLkr(product.selling_price)}</Text>}
                {isOfferActive(product) && showSavings && savingsPerUnit(product) > 0 && (
                  <Text style={styles.save}>Save {formatLkr(savingsPerUnit(product))}</Text>
                )}
                <Badge tone={product.is_available ? 'positive' : 'neutral'} label={product.is_available ? 'Available' : 'Currently unavailable'} />
              </View>
              {isOfferActive(product) && !!product.offer_ends_at && (
                <Text style={styles.ends}>Offer ends {orderTime(product.offer_ends_at)}</Text>
              )}

              {!product.is_available && !DEMO && (
                <View style={{ marginTop: 16 }}>
                  <Button
                    kind="secondary"
                    label={signedIn && notify ? NOTIFY_ME_ON_LABEL : NOTIFY_ME_LABEL}
                    busy={notifyBusy}
                    onPress={() => void toggleNotify()}
                  />
                  {signedIn && notify && <Text style={styles.hint}>{NOTIFY_ME_ON_HINT}</Text>}
                </View>
              )}
            </Animated.View>

            <Animated.View entering={FadeInDown.delay(100).duration(300)}>
              {!!product.description?.trim() && (
                <Section title="About this product"><Text style={styles.body}>{product.description.trim()}</Text></Section>
              )}
              {detailRows(product).length > 0 && (
                <Section title="Product details">
                  {detailRows(product).map(([k, v]) => (
                    <View key={k} style={{ marginBottom: 14 }}>
                      <Text style={styles.attrKey}>{k}</Text>
                      <Text style={styles.attrVal}>{v}</Text>
                    </View>
                  ))}
                </Section>
              )}
              {combos.length > 0 && (
                <Section title="Combo packs with this item">
                  {combos.map((c) => <ComboRow key={c.id} combo={c} showSavings={showSavings} />)}
                </Section>
              )}
            </Animated.View>
          </ScrollView>

          <CtaBar product={product} bottom={insets.bottom} />
        </>
      )}
      {toast}
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <View style={{ marginTop: 24 }}>
      <PressScale onPress={() => setOpen((o) => !o)} scaleTo={0.99}>
        <View style={styles.sectionHead} accessible accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ expanded: open }}>
          <Text style={styles.section}>{title}</Text>
          <Caret open={open} />
        </View>
      </PressScale>
      <Collapsible open={open}><View style={{ paddingTop: 10 }}>{children}</View></Collapsible>
    </View>
  );
}

/** A combo pack that holds this product: name, what's inside, the pack price (and saving). */
function ComboRow({ combo: c, showSavings }: { combo: Combo; showSavings: boolean }) {
  const inside = c.items.map((i) => (i.quantity > 1 ? `${i.quantity} × ${i.name}` : i.name)).join(', ');
  return (
    <View style={styles.combo}>
      <View style={{ flex: 1 }}>
        <Text style={styles.comboName}>{c.name}</Text>
        <Text style={styles.comboInside} numberOfLines={2}>{inside}</Text>
        {!!c.ends_at && <Text style={styles.ends}>Offer ends {orderTime(c.ends_at)}</Text>}
      </View>
      <View style={{ alignItems: 'flex-end', gap: 4 }}>
        <Text style={styles.comboPrice}>{formatLkr(c.price)}</Text>
        {showSavings && c.saving > 0 && <Text style={styles.save}>Save {formatLkr(c.saving)}</Text>}
        {!c.is_available && <Badge tone="neutral" label="Sold out" />}
      </View>
    </View>
  );
}

/** The one bottom bar: "n in cart", Add to cart (a − n + stepper once added) and View cart. */
function CtaBar({ product, bottom }: { product: Product; bottom: number }) {
  const q = useCartSelect((c) => c.qty[product.id] ?? 0);
  const hasCart = useCartSelect((c) => c.count > 0);
  return (
    <View style={[styles.bar, { paddingBottom: bottom + 12 }]}>
      {q > 0 && <Animated.Text entering={FadeIn.duration(160)} style={styles.inCart}>✓ {q} in cart</Animated.Text>}
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <View style={{ flex: 1 }}>
          {!product.is_available ? (
            <Button label="Currently unavailable" disabled kind="secondary" />
          ) : q === 0 ? (
            <Button label="Add to cart" onPress={() => cartActions.add(product)} />
          ) : (
            <View style={styles.stepper}>
              <PressScale onPress={() => cartActions.remove(product.id)} style={styles.stepBtn} haptic>
                <Text style={styles.stepTxt} accessibilityLabel="Remove one">−</Text>
              </PressScale>
              <Text style={styles.stepQty}>{q}</Text>
              <PressScale onPress={() => cartActions.add(product)} style={styles.stepBtn} haptic>
                <Text style={styles.stepTxt} accessibilityLabel="Add one">+</Text>
              </PressScale>
            </View>
          )}
        </View>
        {hasCart && (
          <View style={{ flex: 1 }}>
            <Button kind="secondary" label="View cart" onPress={() => router.push('/cart')} />
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 12, paddingBottom: 6, backgroundColor: '#fff' },
  round: { width: 40, height: 40, borderRadius: 20, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' },
  hero: { borderRadius: 18, backgroundColor: C.tile, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  cat: { fontFamily: F.regular, fontSize: 12.5, color: C.sub, marginTop: 22 },
  name: { fontFamily: F.bold, fontSize: 24, color: C.ink, lineHeight: 30, marginTop: 6 },
  unit: { fontFamily: F.regular, fontSize: 14, color: C.sub, marginTop: 4 },
  priceRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginTop: 18 },
  price: { fontFamily: F.black, fontSize: 26, color: C.ink },
  mrp: { fontFamily: F.regular, fontSize: 15, color: '#9A9AA0', textDecorationLine: 'line-through' },
  save: { fontFamily: F.semi, fontSize: 12.5, color: C.greenDark },
  ends: { fontFamily: F.regular, fontSize: 12.5, color: C.sub, marginTop: 6 },
  hint: { fontFamily: F.regular, fontSize: 12, color: C.sub, marginTop: 6 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 },
  section: { fontFamily: F.bold, fontSize: 16, color: C.ink },
  body: { fontFamily: F.regular, fontSize: 14, color: C.text, lineHeight: 21 },
  attrKey: { fontFamily: F.regular, fontSize: 12, color: C.sub },
  attrVal: { fontFamily: F.semi, fontSize: 14, color: C.ink, marginTop: 2 },
  combo: { flexDirection: 'row', gap: 12, backgroundColor: C.bg, borderRadius: 14, padding: 12, marginBottom: 10 },
  comboName: { fontFamily: F.semi, fontSize: 14, color: C.ink },
  comboInside: { fontFamily: F.regular, fontSize: 12.5, color: C.sub, marginTop: 3, lineHeight: 17 },
  comboPrice: { fontFamily: F.bold, fontSize: 15, color: C.ink },
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: C.line, paddingHorizontal: 15, paddingTop: 10 },
  inCart: { fontFamily: F.semi, fontSize: 12, color: C.greenDark, marginBottom: 6 },
  stepper: { height: 50, borderRadius: 25, backgroundColor: C.brand, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 6 },
  stepBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  stepTxt: { fontFamily: F.bold, fontSize: 22, color: C.brandInk },
  stepQty: { fontFamily: F.bold, fontSize: 17, color: C.brandInk },
});
