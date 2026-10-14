import { router } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { CategoryTile } from '@/components/CategoryTile';
import { ChevronIcon } from '@/components/icons';
import { PressScale } from '@/components/ui';
import { C, F } from '@/lib/theme';
import { CATEGORIES } from '../ui/strings';
import { categoriesHref, categoryHref, type MainNode } from './tree';

/*
 * Home's shop front (Flutter HomeCategoryGroups, owner 2026-10-05/07/08): each Main is a heading
 * over its Category tiles, 4 to a row on a phone. A Main with more than two rows' worth becomes
 * two rows that swipe sideways together, the next column peeking in. A tile opens the category
 * (with its sub-category sidebar); "See all" opens the categories screen at that Main, and
 * "All categories" (owner: "I need a button to see all categories") the whole list.
 */

const COLS = 4;
const GUTTER = 15;
const GAP = 12;
const PEEK = 0.45;

export function HomeCategoryGroups({ tree, width }: { tree: MainNode[]; width: number }) {
  if (!tree.length) return null;
  const tile = Math.min(112, (width - GUTTER * 2 - GAP * (COLS - 1)) / COLS);
  // one running index across groups, so the tile wells keep cycling down the page
  const starts = tree.map((_, i) => tree.slice(0, i).reduce((n, m) => n + m.categories.length, 0));
  return (
    <Animated.View entering={FadeIn.duration(260)} style={{ marginTop: 6 }}>
      {tree.map((main, i) => <Group key={main.key} main={main} tile={tile} width={width} start={starts[i]} />)}
      <PressScale onPress={() => router.push(categoriesHref())} scaleTo={0.97} style={styles.allBtn} haptic>
        <GridGlyph />
        <Text style={styles.allTxt}>{CATEGORIES.allCategories}</Text>
        <View style={{ transform: [{ rotate: '-90deg' }] }}><ChevronIcon size={14} color={C.brandInk} stroke={2.4} /></View>
      </PressScale>
    </Animated.View>
  );
}

function Group({ main, tile, width, start }: { main: MainNode; tile: number; width: number; start: number }) {
  const cats = main.categories;
  const swipe = cats.length > COLS * 2;
  const open = (slug: string) => router.push(categoryHref(slug));
  return (
    <View style={{ marginTop: 18 }}>
      <View style={styles.head}>
        <Text style={styles.h2} accessibilityRole="header" numberOfLines={1}>{main.name}</Text>
        <PressScale onPress={() => router.push(categoriesHref(main.id))} hitSlop={8} style={styles.seeAll}>
          <Text style={styles.seeAllTxt}>{CATEGORIES.seeAll}</Text>
          <View style={{ transform: [{ rotate: '-90deg' }] }}><ChevronIcon size={13} color="#4A4A50" stroke={2.2} /></View>
        </PressScale>
      </View>
      {swipe ? (
        <TwoRowSwipe main={main} width={width} start={start} onOpen={open} />
      ) : (
        <View style={styles.grid}>
          {cats.map((n, i) => (
            <CategoryTile key={n.category.id} category={n.category} size={tile} index={start + i} onPress={() => open(n.category.slug)} />
          ))}
        </View>
      )}
    </View>
  );
}

/** Two rows that scroll sideways together: the first half on top, the rest below, in display order. */
function TwoRowSwipe({ main, width, start, onOpen }: { main: MainNode; width: number; start: number; onOpen: (slug: string) => void }) {
  const all = main.categories;
  const perRow = Math.ceil(all.length / 2);
  const top = all.slice(0, perRow);
  const bottom = all.slice(perRow);
  const cell = Math.min(112, (width - GUTTER - GAP * COLS) / (COLS + PEEK));
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: GUTTER, gap: GAP }}>
      {top.map((n, col) => (
        <View key={n.category.id} style={{ width: cell, gap: 14 }}>
          <CategoryTile category={n.category} size={cell} index={start + col} onPress={() => onOpen(n.category.slug)} />
          {bottom[col] ? (
            <CategoryTile category={bottom[col].category} size={cell} index={start + perRow + col} onPress={() => onOpen(bottom[col].category.slug)} />
          ) : null}
        </View>
      ))}
    </ScrollView>
  );
}

function GridGlyph() {
  return (
    <View style={styles.glyph}>
      {[0, 1, 2, 3].map((i) => <View key={i} style={styles.glyphCell} />)}
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: GUTTER, marginBottom: 12 },
  h2: { fontFamily: F.semi, fontSize: 18.5, color: '#26262B', letterSpacing: -0.2, flexShrink: 1 },
  seeAll: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingVertical: 4 },
  seeAllTxt: { fontFamily: F.medium, fontSize: 13.5, color: '#4A4A50' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', columnGap: GAP, rowGap: 14, paddingHorizontal: GUTTER },
  allBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, marginHorizontal: GUTTER, marginTop: 18,
    height: 46, borderRadius: 23, backgroundColor: C.brand,
  },
  allTxt: { fontFamily: F.semi, fontSize: 15, color: C.brandInk },
  glyph: { width: 16, height: 16, flexDirection: 'row', flexWrap: 'wrap', gap: 2 },
  glyphCell: { width: 7, height: 7, borderRadius: 2, backgroundColor: C.brandInk },
});
