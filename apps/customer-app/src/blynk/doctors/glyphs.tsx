import { useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { C } from '@/lib/theme';

export const ToothGlyph = ({ size = 22, color = C.ink }: { size?: number; color?: string }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path
      d="M7.5 3C5 3 3.5 5 3.5 7.6c0 2.2 1 3.6 1.6 5.6.7 2.5.9 7.8 2.9 7.8 1.6 0 1.7-4.6 4-4.6s2.4 4.6 4 4.6c2 0 2.2-5.3 2.9-7.8.6-2 1.6-3.4 1.6-5.6C20.5 5 19 3 16.5 3c-1.9 0-2.8 1.1-4.5 1.1S9.4 3 7.5 3Z"
      stroke={color} strokeWidth={1.8} strokeLinejoin="round"
    />
  </Svg>
);

export const PersonGlyph = ({ size = 22, color = C.sub }: { size?: number; color?: string }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Circle cx={12} cy={8.5} r={3.8} stroke={color} strokeWidth={1.8} />
    <Path d="M4.5 20c.8-3.6 3.8-5.6 7.5-5.6s6.7 2 7.5 5.6" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
  </Svg>
);

/** A square tile: the doctor's photo when there is one that loads, otherwise a glyph. */
export function GlyphTile({ size = 48, photo, kind = 'clinic' }: { size?: number; photo?: string | null; kind?: 'clinic' | 'person' }) {
  const [failed, setFailed] = useState(false);
  const uri = photo && !failed ? photo : null;
  return (
    <View style={[s.tile, { width: size, height: size, borderRadius: size * 0.28 }]}>
      {uri ? (
        <Image source={{ uri }} style={{ width: size, height: size }} resizeMode="cover" onError={() => setFailed(true)} accessibilityIgnoresInvertColors />
      ) : kind === 'person' ? <PersonGlyph size={size * 0.5} /> : <ToothGlyph size={size * 0.5} color={C.sub} />}
    </View>
  );
}

const s = StyleSheet.create({
  tile: { backgroundColor: C.tile, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
});
