import { COMPONENT_WORDS } from '@/blynk/ui/componentWords';
import { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import type { Category } from '@/blynk/api/types';
import { categoryOfferActive } from '@/blynk/lib/categories';
import { C, F } from '@/lib/theme';
import { PressScale } from './ui';

/**
 * The picture's well. Once soft pastels cycled here (Flutter CategoryWidget); the clean pass
 * (2026-10-14) keeps one plain light grey so the pictures carry the colour.
 */
const WELLS = [C.tile];
export const wellFor = (i: number) => WELLS[((i % WELLS.length) + WELLS.length) % WELLS.length];

/** A category's picture on its well, or its initial while there is none (or it fails to load). */
export function CategoryArt({ category, size, radius = 16, index = 0 }: { category: Pick<Category, 'name' | 'image_url'>; size: number; radius?: number; index?: number }) {
  const [failed, setFailed] = useState(false);
  const uri = category.image_url;
  return (
    <View style={[styles.well, { width: size, height: size, borderRadius: radius, backgroundColor: wellFor(index) }]}>
      {uri && !failed ? (
        // The picture fills the whole rounded tile (owner, 2026-10-21: a smaller picture sat as a
        // white square inside the grey well).
        <Image source={{ uri }} resizeMode="cover" onError={() => setFailed(true)} style={{ width: size, height: size }} accessibilityIgnoresInvertColors />
      ) : (
        <Text style={[styles.initial, { fontSize: Math.round(size * 0.42) }]}>{category.name.trim().charAt(0).toUpperCase() || '·'}</Text>
      )}
    </View>
  );
}

/**
 * The rounded-square category tile of Home's groups and the categories screen: the picture on a
 * tinted well, the name under it (two lines), and "n% OFF" while a category offer runs.
 */
export function CategoryTile({ category, size, index = 0, onPress }: { category: Category; size: number; index?: number; onPress: () => void }) {
  const offer = categoryOfferActive(category);
  return (
    <PressScale onPress={onPress} scaleTo={0.95} style={{ width: size }}>
      <View accessible accessibilityRole="link" accessibilityLabel={offer ? COMPONENT_WORDS.offLabel(category.name, category.offer_percent as number) : category.name}>
        <CategoryArt category={category} size={size} index={index} />
        {offer && (
          <View style={styles.offer}><Text style={styles.offerTxt}>{COMPONENT_WORDS.offUpper(category.offer_percent as number)}</Text></View>
        )}
        <Text style={styles.name} numberOfLines={2}>{category.name}</Text>
      </View>
    </PressScale>
  );
}

const styles = StyleSheet.create({
  well: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  initial: { fontFamily: F.bold, color: C.faint },
  offer: {
    position: 'absolute', top: 4, left: 4, backgroundColor: C.brand, borderRadius: 7, paddingHorizontal: 5, height: 15,
    justifyContent: 'center',
  },
  offerTxt: { fontFamily: F.bold, fontSize: 8.5, color: C.brandInk, letterSpacing: 0.1 },
  name: { fontFamily: F.medium, fontSize: 12, lineHeight: 15, color: C.text, textAlign: 'center', marginTop: 6, minHeight: 30 },
});
