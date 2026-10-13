import { Image, StyleSheet } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import type { Category, Product, Promotion } from '@/blynk/api/types';
import { openAisle } from '@/lib/nav';
import { PressScale } from './ui';

/** Where a tapped promotion goes (mirrors customer-web's promoPath); null when it has none. */
function promoAction(p: Promotion, categories: Category[], products: Product[]): (() => void) | null {
  const v = p.cta_destination_value;
  switch (p.cta_destination_type) {
    case 'CATEGORY': {
      const c = v ? categories.find((x) => x.id === v || x.slug === v) : undefined;
      return c ? () => openAisle(c) : null;
    }
    case 'PRODUCT': {
      const prod = v ? products.find((x) => x.id === v || x.slug === v) : undefined;
      const c = prod ? categories.find((x) => x.id === prod.category_id) : undefined;
      return c ? () => openAisle(c) : null;
    }
    default:
      return null;
  }
}

/** Admin's first active image promotion, when there is one. */
export function PromoImage({ promotions, categories, products }: { promotions: Promotion[]; categories: Category[]; products: Product[] }) {
  const promo = promotions.find((p) => p.image_url);
  if (!promo) return null;
  const act = promoAction(promo, categories, products);
  return (
    <Animated.View entering={FadeIn.duration(350)}>
      <PressScale scaleTo={0.985} onPress={act ?? undefined} disabled={!act} style={styles.wrap}>
        <Image source={{ uri: promo.image_url as string }} accessibilityLabel={promo.title ?? 'Offer'} resizeMode="cover" style={styles.img} />
      </PressScale>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginHorizontal: 16, marginTop: 16, borderRadius: 16, overflow: 'hidden' },
  img: { width: '100%', height: 170 },
});
