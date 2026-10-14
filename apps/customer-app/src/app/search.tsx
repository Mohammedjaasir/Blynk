import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { Keyboard, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getProducts } from '@/blynk/api/catalog';
import { ApiError } from '@/blynk/api/client';
import type { Product } from '@/blynk/api/types';
import { useCatalog } from '@/blynk/catalog/CatalogContext';
import { categoriesHref, categoryHref } from '@/blynk/catalog/tree';
import { CATEGORIES } from '@/blynk/ui/strings';
import {
  addRecentSearch, clearRecentSearches, loadRecentSearches, normalizeSearch, saveRecentSearches, SEARCH_MAX,
} from '@/blynk/catalog/recentSearches';
import { CartBar } from '@/components/CartBar';
import { BackIcon, CloseIcon, SearchIcon } from '@/components/icons';
import { ProductCard } from '@/components/ProductCard';
import { PressScale, RollingText, Skeleton, useTicker } from '@/components/ui';
import { DEMO } from '@/demo/mode';
import { goBack, openAisle } from '@/lib/nav';
import { C, F } from '@/lib/theme';

const PAGE = 40;
type Answer = { key: string; results: Product[] | null; total: number; page: number; pages: number; error: string | null };
const EMPTY: Answer = { key: '', results: null, total: 0, page: 0, pages: 0, error: null };

/**
 * Search (Flutter SearchScreen): the real catalogue (GET /catalog/products?search=), with
 * "Recent searches" this customer actually ran (kept on the device), "Browse categories", an
 * All / aisle filter, the result count and more results as you scroll. ?c=<slug>&name=<aisle>
 * opens it filtered to one aisle. No suggested or trending searches: the backend has no source.
 */
export default function Search() {
  const { c, name } = useLocalSearchParams<{ c?: string; name?: string }>();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { data } = useCatalog();
  const [q, setQ] = useState('');
  const [slug, setSlug] = useState<string | null>(c || null);
  const [recent, setRecent] = useState<string[]>(() => loadRecentSearches());
  const [answer, setAnswer] = useState<Answer>(EMPTY);
  const [more, setMore] = useState(false);
  const [retry, setRetry] = useState(0);
  const input = useRef<TextInput>(null);
  const seq = useRef(0);
  const term = normalizeSearch(q);
  const key = `${slug ?? ''}|${term}`;
  const current = !!term && answer.key === key;
  const results = current ? answer.results : null;
  const error = current ? answer.error : null;
  const t = useTicker();
  const aisles = data?.aisles ?? [];
  const activeAisle = slug ? aisles.find((a) => a.slug === slug) ?? (slug === c && name ? { name, slug } : null) : null;
  const hints = (data?.products ?? []).filter((p) => p.is_available).slice(0, 6).map((p) => p.name);

  useEffect(() => {
    const n = ++seq.current;
    if (!term || DEMO) return;
    const timer = setTimeout(() => {
      getProducts({ search: term, category_slug: slug || undefined, limit: PAGE })
        .then((r) => {
          if (n === seq.current) setAnswer({ key, results: r.products, total: r.pagination.total, page: r.pagination.page, pages: r.pagination.total_pages, error: null });
        })
        .catch((e) => {
          if (n === seq.current) setAnswer({ ...EMPTY, key, error: e instanceof ApiError ? e.message : 'Search failed. Please try again.' });
        });
    }, 350);
    return () => clearTimeout(timer);
  }, [key, retry, slug, term]);

  const loadMore = () => {
    if (!current || more || !results || answer.page >= answer.pages) return;
    const n = seq.current;
    setMore(true);
    getProducts({ search: term, category_slug: slug || undefined, page: answer.page + 1, limit: PAGE })
      .then((r) => {
        if (n !== seq.current) return;
        setAnswer((a) => {
          const seen = new Set((a.results ?? []).map((p) => p.id));
          return { ...a, results: [...(a.results ?? []), ...r.products.filter((p) => !seen.has(p.id))], page: r.pagination.page, pages: r.pagination.total_pages };
        });
      })
      .catch(() => {})
      .finally(() => setMore(false));
  };

  const remember = (query: string) => {
    const next = addRecentSearch(recent, query);
    setRecent(next);
    saveRecentSearches(next);
  };
  const submit = () => { if (term) remember(term); };
  const pickRecent = (query: string) => {
    setQ(query);
    Keyboard.dismiss();
    remember(query);
  };
  const clearRecent = () => { setRecent([]); clearRecentSearches(); };
  const clearQuery = () => { setQ(''); input.current?.focus(); };
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    if (contentOffset.y + layoutMeasurement.height >= contentSize.height - 400) loadMore();
  };

  const tile = (width - 16 * 2 - 12) / 2;
  const rows: Product[][] = [];
  for (let i = 0; i < (results ?? []).length; i += 2) rows.push((results ?? []).slice(i, i + 2));
  const scope = activeAisle ? ` in ${activeAisle.name}` : '';

  return (
    <View style={{ flex: 1, backgroundColor: '#fff', paddingTop: insets.top }}>
      <StatusBar style="dark" />
      <View style={styles.bar}>
        <PressScale onPress={goBack} style={{ padding: 6 }}><BackIcon size={20} /></PressScale>
        <View style={styles.field}>
          <SearchIcon size={16} color={C.sub} />
          <View style={{ flex: 1, justifyContent: 'center' }}>
            {!q && (
              <View pointerEvents="none" style={styles.hintRow}>
                {name ? (
                  <Text style={styles.hint}>Search in {name}</Text>
                ) : hints.length > 0 ? (
                  <>
                    <Text style={styles.hint}>{"Search for '"}</Text>
                    <RollingText text={hints[t % hints.length]} style={styles.hint} />
                    <Text style={styles.hint}>{"'"}</Text>
                  </>
                ) : (
                  <Text style={styles.hint}>Search groceries &amp; essentials</Text>
                )}
              </View>
            )}
            <TextInput
              ref={input}
              autoFocus
              value={q}
              onChangeText={setQ}
              onSubmitEditing={submit}
              returnKeyType="search"
              autoCorrect={false}
              maxLength={SEARCH_MAX}
              style={styles.input}
              accessibilityLabel={name ? `Search in ${name}` : 'Search groceries and essentials'}
            />
          </View>
          {!!q && (
            <PressScale onPress={clearQuery} style={styles.clear}>
              <View accessible accessibilityRole="button" accessibilityLabel="Clear search"><CloseIcon size={9} color="#fff" /></View>
            </PressScale>
          )}
        </View>
      </View>

      {!!term && aisles.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsBar} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
          <Chip label="All" on={!slug} onPress={() => setSlug(null)} />
          {aisles.map((a) => <Chip key={a.id} label={a.name} on={slug === a.slug} onPress={() => setSlug(a.slug)} />)}
        </ScrollView>
      )}

      <ScrollView
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        onScroll={onScroll}
        scrollEventThrottle={64}
        contentContainerStyle={{ padding: 16, paddingBottom: 140 }}
      >
        {!term ? (
          DEMO ? (
            <Empty title="What are you looking for?" sub="Search opens here once the shop is live." />
          ) : recent.length === 0 && aisles.length === 0 ? (
            <Empty title="What are you looking for?" sub="Search for groceries, snacks and everyday essentials." />
          ) : (
            <Animated.View entering={FadeIn.duration(180)}>
              {recent.length > 0 && (
                <>
                  <View style={styles.headRow}>
                    <Text style={styles.h2}>Recent searches</Text>
                    <PressScale onPress={clearRecent} style={{ padding: 4 }}><Text style={styles.action}>Clear</Text></PressScale>
                  </View>
                  {recent.map((r) => (
                    <PressScale key={r} onPress={() => pickRecent(r)} scaleTo={0.99}>
                      <View style={styles.recentRow} accessible accessibilityRole="button" accessibilityLabel={`Search for ${r}`}>
                        <SearchIcon size={14} color={C.sub} />
                        <Text style={styles.recentTxt} numberOfLines={1}>{r}</Text>
                      </View>
                    </PressScale>
                  ))}
                </>
              )}
              {aisles.length > 0 && (
                <>
                  <Text style={[styles.h2, { marginTop: recent.length ? 22 : 0, marginBottom: 10 }]}>Browse categories</Text>
                  <View style={styles.wrap}>
                    {aisles.map((a) => <Chip key={a.id} label={a.name} onPress={() => (DEMO ? openAisle(a) : router.push(categoryHref(a.slug)))} />)}
                    {!DEMO && <Chip label={CATEGORIES.allCategories} onPress={() => router.push(categoriesHref())} />}
                  </View>
                </>
              )}
            </Animated.View>
          )
        ) : DEMO ? (
          <Empty title="Search opens soon" sub="This is a preview." />
        ) : error ? (
          <Empty title="Couldn't load results" sub={error} cta="Try again" onPress={() => setRetry((r) => r + 1)} />
        ) : !results ? (
          <View style={{ flexDirection: 'row', gap: 12 }}><Skeleton w={tile} h={tile} r={14} /><Skeleton w={tile} h={tile} r={14} /></View>
        ) : results.length === 0 ? (
          <Empty
            title={`No results for "${term}"${scope}`}
            sub="Check the spelling or browse categories."
            cta="Browse categories"
            onPress={() => { setQ(''); setSlug(null); }}
          />
        ) : (
          <>
            <Text style={styles.count}>Search results · {answer.total} {answer.total === 1 ? 'item' : 'items'}{scope}</Text>
            {rows.map((row, ri) => (
              <View key={ri} style={{ flexDirection: 'row', gap: 12, marginBottom: 18 }}>
                {row.map((p, ci) => (
                  <Animated.View key={p.id} entering={FadeInDown.delay(Math.min(ri, 5) * 70 + ci * 40).duration(320)}>
                    <ProductCard product={p} width={tile} sub={p.category_name} index={Math.min(ri * 2 + ci, 6)} />
                  </Animated.View>
                ))}
              </View>
            ))}
            {answer.page < answer.pages && (
              <PressScale onPress={loadMore} disabled={more} style={styles.more}>
                <Text style={styles.action}>{more ? 'Loading…' : 'Show more results'}</Text>
              </PressScale>
            )}
          </>
        )}
      </ScrollView>
      <CartBar />
    </View>
  );
}

function Chip({ label, on, onPress }: { label: string; on?: boolean; onPress: () => void }) {
  return (
    <PressScale onPress={onPress} scaleTo={0.96}>
      <View style={[styles.chip, on && styles.chipOn]} accessible accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: !!on }}>
        <Text style={[styles.chipTxt, on && { color: '#fff' }]} numberOfLines={1}>{label}</Text>
      </View>
    </PressScale>
  );
}

function Empty({ title, sub, cta, onPress }: { title: string; sub: string; cta?: string; onPress?: () => void }) {
  return (
    <Animated.View entering={FadeIn.duration(200)} style={styles.empty}>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.note}>{sub}</Text>
      {cta && onPress && (
        <PressScale onPress={onPress} style={styles.cta}><Text style={styles.ctaTxt}>{cta}</Text></PressScale>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.line },
  field: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.bg, borderRadius: 14, height: 44, paddingHorizontal: 12 },
  hintRow: { position: 'absolute', left: 0, right: 0, flexDirection: 'row', alignItems: 'center', overflow: 'hidden' },
  hint: { fontFamily: F.regular, color: C.sub, fontSize: 14 },
  input: { fontFamily: F.regular, color: C.ink, fontSize: 14, height: 44, paddingVertical: 0 },
  clear: { width: 20, height: 20, borderRadius: 10, backgroundColor: C.faint, alignItems: 'center', justifyContent: 'center' },
  chipsBar: { flexGrow: 0, borderBottomWidth: 1, borderBottomColor: C.line },
  chips: { paddingHorizontal: 12, paddingVertical: 8, gap: 8 },
  chip: { borderRadius: 18, borderWidth: 1, borderColor: '#D9D9E0', backgroundColor: C.bg, paddingHorizontal: 14, height: 34, justifyContent: 'center' },
  chipOn: { backgroundColor: C.ink, borderColor: C.ink },
  chipTxt: { fontFamily: F.semi, fontSize: 13, color: C.ink, maxWidth: 200 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  h2: { fontFamily: F.bold, fontSize: 16, color: C.ink },
  action: { fontFamily: F.semi, fontSize: 13.5, color: C.brandText },
  recentRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 46, borderBottomWidth: 1, borderBottomColor: C.line },
  recentTxt: { flex: 1, fontFamily: F.regular, fontSize: 14.5, color: C.text },
  count: { fontFamily: F.semi, fontSize: 13, color: C.sub, marginBottom: 12 },
  more: { alignSelf: 'center', paddingHorizontal: 20, paddingVertical: 10 },
  empty: { alignItems: 'center', paddingTop: 50, paddingHorizontal: 16 },
  emptyTitle: { fontFamily: F.bold, fontSize: 17, color: C.ink, textAlign: 'center' },
  note: { fontFamily: F.regular, color: C.sub, fontSize: 13.5, textAlign: 'center', marginTop: 6, lineHeight: 19 },
  cta: { marginTop: 18, height: 44, borderRadius: 22, paddingHorizontal: 24, backgroundColor: C.brand, alignItems: 'center', justifyContent: 'center' },
  ctaTxt: { fontFamily: F.semi, fontSize: 14.5, color: C.brandInk },
});
