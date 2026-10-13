import { useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getProducts } from '@/blynk/api/catalog';
import { ApiError } from '@/blynk/api/client';
import type { Product } from '@/blynk/api/types';
import { useCatalog } from '@/blynk/catalog/CatalogContext';
import { CartBar } from '@/components/CartBar';
import { BackIcon, CloseIcon, SearchIcon } from '@/components/icons';
import { ProductCard } from '@/components/ProductCard';
import { PressScale, RollingText, Skeleton, useTicker } from '@/components/ui';
import { goBack } from '@/lib/nav';
import { C, F } from '@/lib/theme';

/** Searches the real Blynk catalogue (GET /catalog/products?search=), optionally inside one aisle (?c=slug). */
export default function Search() {
  const { c, name } = useLocalSearchParams<{ c?: string; name?: string }>();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { data } = useCatalog();
  const [q, setQ] = useState('');
  // the answer for one search term; anything for an older term is ignored
  const [answer, setAnswer] = useState<{ term: string; results: Product[] | null; error: string | null }>({ term: '', results: null, error: null });
  const seq = useRef(0);
  const term = q.trim();
  const active = term.length >= 2;
  const current = active && answer.term === term;
  const results = current ? answer.results : null;
  const error = current ? answer.error : null;
  const busy = active && !current;
  const t = useTicker();
  const hints = (data?.products ?? []).filter((p) => p.is_available).slice(0, 6).map((p) => p.name);

  useEffect(() => {
    const n = ++seq.current;
    if (!active) return;
    const timer = setTimeout(() => {
      getProducts({ search: term, category_slug: c || undefined, limit: 40 })
        .then((r) => { if (n === seq.current) setAnswer({ term, results: r.products, error: null }); })
        .catch((e) => {
          if (n === seq.current) setAnswer({ term, results: null, error: e instanceof ApiError ? e.message : 'Search failed. Please try again.' });
        });
    }, 300);
    return () => clearTimeout(timer);
  }, [term, active, c]);

  const tile = (width - 16 * 2 - 12) / 2;
  const rows: Product[][] = [];
  for (let i = 0; i < (results ?? []).length; i += 2) rows.push((results ?? []).slice(i, i + 2));

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
                <Text style={styles.hint}>{name ? `Search in ${name}` : "Search for '"}</Text>
                {!name && hints.length > 0 && <RollingText text={hints[t % hints.length]} style={styles.hint} />}
                {!name && <Text style={styles.hint}>{"'"}</Text>}
              </View>
            )}
            <TextInput
              autoFocus
              value={q}
              onChangeText={setQ}
              returnKeyType="search"
              autoCorrect={false}
              style={styles.input}
              accessibilityLabel={name ? `Search in ${name}` : 'Search Blynk'}
            />
          </View>
          {!!q && <PressScale onPress={() => setQ('')} style={styles.clear}><CloseIcon size={9} color="#fff" /></PressScale>}
        </View>
      </View>

      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, paddingBottom: 140 }}>
        {!active ? (
          <Text style={styles.note}>Type at least 2 letters to search {name ? name : 'the Blynk catalogue'}.</Text>
        ) : error ? (
          <Text style={[styles.note, { color: C.problem }]}>{error}</Text>
        ) : busy && !results ? (
          <View style={{ flexDirection: 'row', gap: 12 }}><Skeleton w={tile} h={tile} r={14} /><Skeleton w={tile} h={tile} r={14} /></View>
        ) : results && results.length === 0 ? (
          <Animated.Text entering={FadeIn} style={styles.note}>No products match &ldquo;{term}&rdquo;.</Animated.Text>
        ) : (
          rows.map((row, ri) => (
            <View key={ri} style={{ flexDirection: 'row', gap: 12, marginBottom: 18 }}>
              {row.map((p, ci) => (
                <Animated.View key={p.id} entering={FadeInDown.delay(Math.min(ri, 5) * 70 + ci * 40).duration(320)}>
                  <ProductCard product={p} width={tile} sub={p.category_name} index={Math.min(ri * 2 + ci, 6)} />
                </Animated.View>
              ))}
            </View>
          ))
        )}
      </ScrollView>
      <CartBar />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.line },
  field: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.bg, borderRadius: 14, height: 44, paddingHorizontal: 12 },
  hintRow: { position: 'absolute', left: 0, right: 0, flexDirection: 'row', alignItems: 'center', overflow: 'hidden' },
  hint: { fontFamily: F.regular, color: C.sub, fontSize: 14 },
  input: { fontFamily: F.regular, color: C.ink, fontSize: 14, height: 44, paddingVertical: 0 },
  clear: { width: 20, height: 20, borderRadius: 10, backgroundColor: C.faint, alignItems: 'center', justifyContent: 'center' },
  note: { fontFamily: F.regular, color: C.sub, fontSize: 13.5, textAlign: 'center', marginTop: 24 },
});
