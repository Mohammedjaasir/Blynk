import { useState } from 'react';
import { Image, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import type { Product } from '@/blynk/api/types';
import { C, F } from '@/lib/theme';

/**
 * A product photo on a neutral tile. While the photo is missing or fails to load,
 * the tile shows the product's initial instead of a broken image.
 */
export function ProductImage({ product, size, radius = 14, style }: {
  product: Pick<Product, 'name' | 'image_url' | 'image_focal_x' | 'image_focal_y'>;
  size: number; radius?: number; style?: StyleProp<ViewStyle>;
}) {
  const [failed, setFailed] = useState(false);
  const uri = product.image_url && !failed ? product.image_url : null;
  return (
    <View style={[styles.tile, { width: size, height: size, borderRadius: radius }, style]}>
      {uri ? (
        <Image
          source={{ uri }}
          accessibilityLabel={product.name}
          resizeMode="contain"
          onError={() => setFailed(true)}
          style={{ width: size * 0.86, height: size * 0.86 }}
        />
      ) : (
        <Text style={[styles.initial, { fontSize: size * 0.34 }]}>{product.name.trim().charAt(0).toUpperCase() || '·'}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { backgroundColor: C.tile, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  initial: { fontFamily: F.bold, color: C.faint },
});
