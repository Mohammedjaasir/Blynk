import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Category } from '@/blynk/api/types';
import { useTrackList } from '@/blynk/analytics/AnalyticsHost';
import { useCatalog } from '@/blynk/catalog/CatalogContext';
import { productsInView, resolveCategory } from '@/blynk/catalog/tree';
import { categoryOfferActive } from '@/blynk/lib/categories';
import { CATEGORIES } from '@/blynk/ui/strings';
import { CartBar } from '@/components/CartBar';
import { CategoryArt } from '@/components/CategoryTile';
import { ClosedBanner } from '@/components/ClosedBanner';
import { BackIcon, SearchIcon } from '@/components/icons';
import { OfflineBanner } from '@/components/OfflineBanner';
import { ProductCard } from '@/components/ProductCard';
import { PressScale, Skeleton } from '@/components/ui';
import { goBack } from '@/lib/nav';
import { C, F } from '@/lib/theme';

/*
 * A category's products with its sub-category sidebar (Flutter ProductsScreen + CategorySidebar;
 * owner's model: Main -> Category -> Sub-category). /category/<slug>?sub=<sub-slug> is a deep
 * link: the sidebar's first row is "All" (everything in the category, sub-categories included),
 * then each sub-category. A sub-category's own slug opens its parent with it selected. Without
 * sub-categories the products take the whole width. Sold-out products (is_available false, as
 * the API reports) show "Out of stock" and sit after the ones in stock.
 */

const SIDEBAR_W = 86;
const PAD = 12;
const GAP = 12;

export default function CategoryScreen() {
  const { slug, sub } = useLocalSearchParams<{ slug: string; sub?: string }>();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { data, error, refresh } = useCatalog();
  const view = useMemo(() => (data ? resolveCategory(data.categories, slug, sub) : null), [data, slug, sub]);
  const products = useMemo(() => (data && view ? productsInView(data.products, data.chainOf, view) : []), [data, view]);
  useTrackList(view ? (view.selected ? `${view.root.name} / ${view.selected.name}` : view.root.name) : null, products);
  const hasSidebar = !!view && view.subs.length > 0;
  const gridW = width - (hasSidebar ? SIDEBAR_W : 0) - PAD * 2;
  const card = Math.floor((gridW - GAP) / 2);

  const select = (s: Category | null) => {
    if (!view) return;
    router.setParams({ slug: view.root.slug, sub: s ? s.slug : undefined });
  };
  const search = () => view && router.push({ pathname: '/search', params: { c: view.root.slug, name: view.root.name } });
  const offer = view && categoryOfferActive(view.root) ? `${view.root.offer_percent}% off everything here` : null;

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />
      <View style={[styles.head, { paddingTop: insets.top + 8 }]}>
        <PressScale onPress={goBack} style={{ padding: 4 }} accessibilityLabel="Back" accessibilityRole="button">
          <BackIcon size={20} color={C.text} stroke={1.8} />
        </PressScale>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1} accessibilityRole="header">{view?.root.name ?? CATEGORIES.title}</Text>
          {!!view && <Text style={styles.count}>{CATEGORIES.itemCount(products.length)}{view.selected ? ` in ${view.selected.name}` : ''}</Text>}
        </View>
        {!!view && (
          <PressScale onPress={search} style={styles.searchBtn} accessibilityLabel={CATEGORIES.search} accessibilityRole="button">
            <SearchIcon size={18} color={C.text} stroke={2} />
          </PressScale>
        )}
      </View>

      {!data ? (
        error ? (
          <Missing title={error.message} action={CATEGORIES.tryAgain} onAction={() => void refresh()} />
        ) : (
          <View style={{ flexDirection: 'row', flex: 1 }}>
            <View style={[styles.sidebar, { gap: 14, paddingTop: 14, alignItems: 'center' }]}>
              {[0, 1, 2, 3].map((i) => <Skeleton key={i} w={52} h={52} r={14} />)}
            </View>
            <View style={{ flex: 1, padding: PAD, flexDirection: 'row', flexWrap: 'wrap', gap: GAP }}>
              {[0, 1, 2, 3].map((i) => <Skeleton key={i} w={card} h={card} r={14} />)}
            </View>
          </View>
        )
      ) : !view ? (
        <Missing title={CATEGORIES.notFound} action={CATEGORIES.goToShop} onAction={() => router.dismissTo('/home')} />
      ) : (
        <View style={{ flexDirection: 'row', flex: 1 }}>
          {hasSidebar && (
            <ScrollView style={styles.sidebar} contentContainerStyle={{ paddingVertical: 6, paddingBottom: insets.bottom + 90 }} showsVerticalScrollIndicator={false}>
              <SideRow
                label={CATEGORIES.all}
                a11y={CATEGORIES.allIn(view.root.name)}
                art={view.root}
                index={0}
                active={view.selected === null}
                onPress={() => select(null)}
              />
              {view.subs.map((s, i) => (
                <SideRow key={s.id} label={s.name} a11y={s.name} art={s} index={i + 1} active={view.selected?.id === s.id} onPress={() => select(s)} />
              ))}
            </ScrollView>
          )}
          <ScrollView
            key={view.selected?.id ?? 'all'}
            style={{ flex: 1 }}
            contentContainerStyle={{ padding: PAD, paddingBottom: insets.bottom + 110 }}
            showsVerticalScrollIndicator={false}
          >
            <OfflineBanner onRetry={() => void refresh()} style={{ marginBottom: 10 }} />
            <ClosedBanner style={{ marginBottom: 10 }} />
            {!!offer && <Text style={styles.offer}>{offer}</Text>}
            {products.length === 0 ? (
              <Text style={styles.empty}>{CATEGORIES.noProducts}</Text>
            ) : (
              <Animated.View entering={FadeIn.duration(200)} style={styles.grid}>
                {products.map((p, i) => (
                  <View key={p.id} style={{ width: card }}>
                    <ProductCard product={p} width={card} index={Math.min(i, 6)} showRating={false} />
                  </View>
                ))}
              </Animated.View>
            )}
          </ScrollView>
        </View>
      )}
      <CartBar />
    </View>
  );
}

function SideRow({ label, a11y, art, index, active, onPress }: {
  label: string; a11y: string; art: Pick<Category, 'name' | 'image_url'>; index: number; active: boolean; onPress: () => void;
}) {
  return (
    <PressScale onPress={onPress} scaleTo={0.96} style={[styles.side, active && styles.sideOn]}>
      <View accessible accessibilityRole="tab" accessibilityState={{ selected: active }} accessibilityLabel={a11y} style={{ alignItems: 'center' }}>
        <CategoryArt category={art} size={48} radius={24} index={index} />
        <Text style={[styles.sideTxt, active && styles.sideTxtOn]} numberOfLines={2}>{label}</Text>
      </View>
      {active && <View style={styles.sideBar} />}
    </PressScale>
  );
}

function Missing({ title, action, onAction }: { title: string; action: string; onAction: () => void }) {
  return (
    <View style={styles.missing}>
      <Text style={styles.missingTitle}>{title}</Text>
      <PressScale onPress={onAction} style={styles.missingBtn} haptic><Text style={styles.missingTxt}>{action}</Text></PressScale>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fff' },
  head: {
    flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingBottom: 10, backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E6E6EA',
  },
  title: { fontFamily: F.bold, fontSize: 17, color: C.ink },
  count: { fontFamily: F.regular, fontSize: 12, color: C.sub, marginTop: 1 },
  searchBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg },
  sidebar: { width: SIDEBAR_W, flexGrow: 0, backgroundColor: C.bg },
  side: { paddingVertical: 10, paddingHorizontal: 4, alignItems: 'center' },
  sideOn: { backgroundColor: '#fff' },
  sideBar: { position: 'absolute', right: 0, top: 8, bottom: 8, width: 3, borderRadius: 2, backgroundColor: C.ink },
  sideTxt: { fontFamily: F.medium, fontSize: 11.5, lineHeight: 14, color: C.sub, textAlign: 'center', marginTop: 5 },
  sideTxtOn: { fontFamily: F.bold, color: C.ink },
  offer: { fontFamily: F.bold, color: C.brandText, fontSize: 12.5, marginBottom: 10 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', columnGap: GAP, rowGap: 18 },
  empty: { fontFamily: F.regular, color: C.sub, fontSize: 13, textAlign: 'center', paddingVertical: 40, paddingHorizontal: 12 },
  missing: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 18, padding: 24 },
  missingTitle: { fontFamily: F.bold, fontSize: 18, color: C.ink, textAlign: 'center' },
  missingBtn: { backgroundColor: C.brand, borderRadius: 14, paddingHorizontal: 26, paddingVertical: 12 },
  missingTxt: { color: C.brandInk, fontFamily: F.bold, fontSize: 15 },
});
