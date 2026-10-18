import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTrackOnce } from '@/blynk/analytics/AnalyticsHost';
import { trackNotifyMe, trackShare, trackViewItem } from '@/blynk/analytics/track';
import { getCombos } from '@/blynk/api/catalog';
import { ApiError } from '@/blynk/api/client';
import type { Combo, Product, ProductVariant } from '@/blynk/api/types';
import { lineKey } from '@/blynk/cart/cartStore';
import { recallDetail, rememberDetail } from '@/blynk/catalog/sizePicker';
import {
  deliveredFromText, hasVariants, priceText, selectVariant, VARIANT_COPY, variantOnOffer, variantPrice, variantPriced,
} from '@/blynk/catalog/variants';
import { useSession } from '@/blynk/auth/session';
import { useCatalog } from '@/blynk/catalog/CatalogContext';
import {
  combosWith, detailRows, fetchProductDetail, isProductGone, NOTIFY_ME_LABEL, NOTIFY_ME_ON_HINT, NOTIFY_ME_ON_LABEL,
  notifyMeAction, setNotifyMe, unitLine,
} from '@/blynk/catalog/product';
import { recallProduct } from '@/blynk/catalog/productCache';
import { ComboAdd } from '@/blynk/combos/ComboViews';
import { requestPushPermission } from '@/blynk/push';
import { formatLkr } from '@/blynk/lib/money';
import { effectivePrice, isOfferActive, priceDisplay } from '@/blynk/lib/pricing';
import { offerSavingsOn } from '@/blynk/lib/storeText';
import { orderTime } from '@/blynk/orders/status';
import { productShareText } from '@/blynk/share/links';
import { shareText } from '@/blynk/share/share';
import { useStore } from '@/blynk/store/StoreContext';
import { Badge, Button, StateView, useToast } from '@/blynk/ui/kit';
import { openSignIn } from '@/blynk/ui/signIn';
import { BackIcon, ShareIcon } from '@/components/icons';
import { ProductImage } from '@/components/ProductImage';
import { StruckPrice } from '@/components/StruckPrice';
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
  // a size picker / earlier visit may already hold this product with its sizes
  const [fresh, setFresh] = useState<Product | null>(() => recallDetail(id));
  const [pickedId, setPickedId] = useState<string | null>(null);
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
      .then((d) => {
        if (n !== seq.current) return;
        setFresh(d.product); setNotify(d.notifyMe); setGone(false); setError(null);
        // sizes (migration 045): remembered for the size picker, and the cart's size lines refreshed
        rememberDetail(d.product);
        cartActions.syncVariants(d.product);
      })
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
  const showSavings = DEMO || offerSavingsOn(store);
  // sold in sizes: chips pick one; the price, stock and Add are that size's
  const sized = !!product && hasVariants(product);
  const variants = product?.variants ?? [];
  const variant = sized ? selectVariant(variants, pickedId) : null;
  const priced = variant ? variantPriced(variant) : product;
  const onOffer = variant ? variantOnOffer(variant) : !!product && isOfferActive(product);
  // the one price rule (offer, MRP - migration 048): struck, always on (owner, 2026-10-18)
  const shown = priced ? priceDisplay(priced, { showStruck: showSavings }) : null;
  // "Save" on an offer counts from the struck reference (the MRP when that is what is struck)
  const saved = shown?.offer && shown.struck ? Math.round((shown.struck.amount - shown.price) * 100) / 100 : 0;
  const orderable = !!product && product.is_available && (!variant || variant.is_available);
  const lead = product && !DEMO ? deliveredFromText(product) : null;
  // GTM: once per product, after the fresh copy (current price, sizes) or a failed fetch
  useTrackOnce(!DEMO && !!product && (!!fresh || !!error), `view_item:${id}`, () => product && trackViewItem(product, variant));

  const share = async () => {
    if (!product) return;
    const r = await shareText(productShareText(product.name, product.id), product.name);
    trackShare(r, 'product', product.id);
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
      if (r === 'on') trackNotifyMe(product, variant);
      // switched on: the moment a push is useful (Flutter notify_me_button)
      if (r === 'on') void requestPushPermission();
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
                  <ProductImage product={product} size={hero} inset={1} style={{ backgroundColor: 'transparent' }} />
                </View>
              </View>
            </Animated.View>

            <Animated.View entering={FadeInDown.delay(60).duration(300)}>
              {!!product.category_name && <Text style={styles.cat}>{product.category_name}</Text>}
              <Text style={styles.name} accessibilityRole="header">{product.name}</Text>
              {!!unitLine(product) && <Text style={styles.unit}>{unitLine(product)}</Text>}

              {sized && (
                <SizeChips variants={variants} selected={variant?.id ?? null} onPick={setPickedId} />
              )}

              <View style={styles.priceRow}>
                <Text style={styles.price}>
                  {variant ? formatLkr(variantPrice(variant)) : sized ? priceText(product) : formatLkr(effectivePrice(product))}
                </Text>
                {shown?.struck && <StruckPrice struck={shown.struck} money={formatLkr} style={styles.mrp} />}
                {saved > 0 && <Text style={styles.save}>Save {formatLkr(saved)}</Text>}
                <Badge tone={orderable ? 'positive' : 'neutral'} label={orderable ? 'Available' : VARIANT_COPY.soldOut} />
              </View>
              {onOffer && !!priced?.offer_ends_at && (
                <Text style={styles.ends}>Offer ends {orderTime(priced.offer_ends_at)}</Text>
              )}
              {!!lead && <Text style={styles.lead}>{lead}</Text>}

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

          <CtaBar product={product} sized={sized} variant={variant} bottom={insets.bottom} />
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
        <ComboAdd combo={c} compact />
      </View>
    </View>
  );
}

/** The size chips (50 g, 100 g, 250 g...): a sold-out size stays listed, greyed out. */
function SizeChips({ variants, selected, onPick }: { variants: ProductVariant[]; selected: string | null; onPick: (id: string) => void }) {
  if (!variants.length) {
    return (
      <View style={[styles.chips, { marginTop: 16 }]} accessibilityLabel="Loading sizes">
        <Skeleton w={64} h={36} r={18} /><Skeleton w={64} h={36} r={18} /><Skeleton w={64} h={36} r={18} />
      </View>
    );
  }
  return (
    <View style={{ marginTop: 16 }}>
      <Text style={styles.chipsTitle}>{VARIANT_COPY.sizes}</Text>
      <View style={styles.chips} accessibilityRole="radiogroup">
        {variants.map((v) => {
          const on = v.id === selected;
          return (
            <PressScale key={v.id} onPress={() => onPick(v.id)} scaleTo={0.95}>
              <View
                style={[styles.chip, on && styles.chipOn, !v.is_available && styles.chipOut]}
                accessible
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`${v.label}, ${formatLkr(variantPrice(v))}${v.is_available ? '' : `, ${VARIANT_COPY.soldOut}`}`}
              >
                <Text style={[styles.chipLabel, !v.is_available && { color: C.sub }]}>{v.label}</Text>
                <Text style={[styles.chipPrice, !v.is_available && { color: C.faint }]}>
                  {v.is_available ? formatLkr(variantPrice(v)) : VARIANT_COPY.soldOut}
                </Text>
              </View>
            </PressScale>
          );
        })}
      </View>
    </View>
  );
}

/**
 * The one bottom bar: "n in cart", Add to cart (a − n + stepper once added) and View cart. For a
 * product sold in sizes it is the chosen size's line ("Add 100 g to cart", "✓ 2 × 100 g in cart").
 */
function CtaBar({ product, sized, variant, bottom }: { product: Product; sized: boolean; variant: ProductVariant | null; bottom: number }) {
  const key = lineKey(product.id, variant?.id);
  const q = useCartSelect((c) => (sized && !variant ? 0 : c.lineQty[key] ?? 0));
  const hasCart = useCartSelect((c) => c.count > 0);
  const soldOut = !product.is_available || (!!variant && !variant.is_available);
  return (
    <View style={[styles.bar, { paddingBottom: bottom + 12 }]}>
      {q > 0 && <Animated.Text entering={FadeIn.duration(160)} style={styles.inCart}>✓ {variant ? `${q} × ${variant.label}` : q} in cart</Animated.Text>}
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <View style={{ flex: 1 }}>
          {soldOut ? (
            <Button label={VARIANT_COPY.soldOut} disabled kind="secondary" />
          ) : sized && !variant ? (
            <Button label={VARIANT_COPY.chooseSize} disabled kind="secondary" />
          ) : q === 0 ? (
            <Button label={VARIANT_COPY.addToCart(variant?.label ?? null)} onPress={() => cartActions.add(product, variant)} />
          ) : (
            <View style={styles.stepper}>
              <PressScale onPress={() => cartActions.remove(key)} style={styles.stepBtn} haptic>
                <Text style={styles.stepTxt} accessibilityLabel="Remove one">−</Text>
              </PressScale>
              <Text style={styles.stepQty}>{q}</Text>
              <PressScale onPress={() => cartActions.add(product, variant)} style={styles.stepBtn} haptic>
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
  lead: { fontFamily: F.semi, fontSize: 13, color: C.brandText, marginTop: 8 },
  chipsTitle: { fontFamily: F.semi, fontSize: 13, color: C.sub, marginBottom: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minWidth: 74, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 12, borderWidth: 1.5, borderColor: C.line, backgroundColor: C.white, alignItems: 'center' },
  chipOn: { borderColor: C.brandDeep, backgroundColor: C.brandTint },
  chipOut: { backgroundColor: C.bg, borderStyle: 'dashed' },
  chipLabel: { fontFamily: F.bold, fontSize: 14, color: C.ink },
  chipPrice: { fontFamily: F.regular, fontSize: 11.5, color: C.text, marginTop: 1 },
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
