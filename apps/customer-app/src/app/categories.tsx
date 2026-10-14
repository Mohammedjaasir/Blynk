import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useRef } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCatalog } from '@/blynk/catalog/CatalogContext';
import { categoryHref, type MainNode } from '@/blynk/catalog/tree';
import { CATEGORIES } from '@/blynk/ui/strings';
import { ListSkeleton, Page, StateView } from '@/blynk/ui/kit';
import { CategoryArt } from '@/components/CategoryTile';
import { CartBar } from '@/components/CartBar';
import { ChevronIcon, SearchIcon } from '@/components/icons';
import { OfflineBanner } from '@/components/OfflineBanner';
import { PressScale } from '@/components/ui';
import { DEMO } from '@/demo/mode';
import { C, F } from '@/lib/theme';

/*
 * All categories (Flutter CategoriesScreen, owner: "I need a button to see all categories"):
 * every Main with its Categories and each Category's Sub-categories, straight from the API
 * (GET /catalog/home-groups + GET /catalog/categories). A Category opens its screen with "All"
 * selected; a Sub-category opens the same screen with it selected. ?group=<id> (a Home "See all"
 * or a MAIN promotion) opens the list scrolled to that Main.
 */
export default function CategoriesScreen() {
  const { group } = useLocalSearchParams<{ group?: string }>();
  const insets = useSafeAreaInsets();
  const { data, error, refresh } = useCatalog();
  const scroll = useRef<ScrollView>(null);
  const jumped = useRef(false);
  const tree = data?.tree ?? [];
  // products per category id (a Category counts its sub-categories' products)
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of data?.products ?? []) for (const id of data!.chainOf(p.category_id)) m.set(id, (m.get(id) ?? 0) + 1);
    return m;
  }, [data]);

  const onMainLayout = (main: MainNode, y: number) => {
    if (jumped.current || !group || main.id !== group) return;
    jumped.current = true;
    setTimeout(() => scroll.current?.scrollTo({ y: Math.max(0, y - 8), animated: false }), 0);
  };

  return (
    <Page
      title={CATEGORIES.title}
      scroll={false}
      right={(
        <PressScale onPress={() => router.push('/search')} style={styles.searchBtn} accessibilityLabel={CATEGORIES.search} accessibilityRole="button">
          <SearchIcon size={18} color={C.text} stroke={2} />
        </PressScale>
      )}
    >
      <ScrollView ref={scroll} contentContainerStyle={{ padding: 15, paddingBottom: insets.bottom + 110 }}>
        <OfflineBanner onRetry={() => void refresh()} style={{ marginBottom: 12 }} />
        {DEMO ? (
          <StateView title={CATEGORIES.title} message="Categories open with the live shop. This is a preview." />
        ) : !data && error ? (
          <StateView title={CATEGORIES.loadFailed} message={error.message} action={CATEGORIES.tryAgain} onAction={() => void refresh()} />
        ) : !data ? (
          <ListSkeleton rows={5} h={96} />
        ) : !tree.length ? (
          <StateView title={CATEGORIES.empty} message={CATEGORIES.emptySub} />
        ) : (
          tree.map((main, mi) => (
            <View key={main.key} onLayout={(e) => onMainLayout(main, e.nativeEvent.layout.y)} style={{ marginBottom: 8 }}>
              <Text style={[styles.main, main.id === group && styles.mainOn]} accessibilityRole="header">{main.name}</Text>
              {main.categories.map((node, ci) => (
                <Animated.View key={node.category.id} entering={FadeInDown.delay(Math.min(mi * 3 + ci, 10) * 30).duration(220)} style={styles.card}>
                  <PressScale onPress={() => router.push(categoryHref(node.category.slug))} scaleTo={0.98} style={styles.catRow}>
                    <CategoryArt category={node.category} size={52} radius={14} index={ci} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.catName} numberOfLines={2}>{node.category.name}</Text>
                      <Text style={styles.count}>{CATEGORIES.itemCount(counts.get(node.category.id) ?? 0)}</Text>
                    </View>
                    <View style={{ transform: [{ rotate: '-90deg' }] }}><ChevronIcon size={14} color={C.sub} stroke={2.2} /></View>
                  </PressScale>
                  {node.subs.length > 0 && (
                    <View style={styles.subs}>
                      {node.subs.map((s) => (
                        <PressScale
                          key={s.id}
                          onPress={() => router.push(categoryHref(node.category.slug, s.slug))}
                          scaleTo={0.95}
                          style={styles.sub}
                          accessibilityRole="link"
                          accessibilityLabel={`${s.name}, in ${node.category.name}`}
                        >
                          <Text style={styles.subTxt} numberOfLines={1}>{s.name}</Text>
                        </PressScale>
                      ))}
                    </View>
                  )}
                </Animated.View>
              ))}
            </View>
          ))
        )}
      </ScrollView>
      <CartBar />
    </Page>
  );
}

const styles = StyleSheet.create({
  searchBtn: { marginLeft: 'auto', width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg },
  main: { fontFamily: F.bold, fontSize: 17, color: C.ink, marginTop: 10, marginBottom: 10, marginLeft: 2 },
  mainOn: { color: C.brandText },
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 12, marginBottom: 10 },
  catRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  catName: { fontFamily: F.semi, fontSize: 15, color: C.ink },
  count: { fontFamily: F.regular, fontSize: 12, color: C.sub, marginTop: 2 },
  subs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  sub: { borderWidth: 1, borderColor: C.line, borderRadius: 16, paddingHorizontal: 12, height: 32, justifyContent: 'center', backgroundColor: '#FAFAFB' },
  subTxt: { fontFamily: F.medium, fontSize: 12.5, color: C.text },
});
