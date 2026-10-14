import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, {
  Easing, useAnimatedProps, useAnimatedStyle, useSharedValue, withRepeat, withTiming,
} from 'react-native-reanimated';
import Svg, { Rect } from 'react-native-svg';
import type { Product } from '@/blynk/api/types';
import { useCatalog } from '@/blynk/catalog/CatalogContext';
import { categoryHref } from '@/blynk/catalog/tree';
import { ProductImage } from '@/components/ProductImage';
import { DEMO } from '@/demo/mode';
import { OPENING } from '@/demo/store';
import { findAisle, openingCourses, openingTitle } from '@/demo/storeLive';
import { C, F } from '@/lib/theme';

const AnimatedRect = Animated.createAnimatedComponent(Rect);

/*
 * The menu interstitial (video 0:31.7–0:32.6): a printed menu card, tilted, with two
 * brackets chasing each other clockwise round it, "OFFLINE MENU / PRICE MATCHED" under it,
 * and "Opening menu to explore..." with a light sweep. ~0.85 s, then a cut to the store.
 * Positions are from the screen's centre, measured off the 384×850 recording.
 */
const ART_W = 124; // the brackets' rounded rect
const ART_H = 136;
const RX = 18;
const PERIM = 2 * (ART_W - 2 * RX) + 2 * (ART_H - 2 * RX) + 2 * Math.PI * RX;
const DASH = PERIM * 0.17;
const LAP = 1100; // ms per lap
// at 430 ms the brackets sit centred on the top-left and bottom-right corners (video f_051)
const START = PERIM - RX * (Math.PI / 4) - DASH / 2 - (PERIM * 430) / LAP - PERIM * 0.1;
const STAY = 900;
const LIVE_SUB = 'Opening aisle to explore...';

type Course = { name: string; emoji?: string; product?: Product | null };

/**
 * The old aisle intro link (/opening?id=<slug>). Live, categories open straight on their screen
 * (/category/<slug>); the design mock keeps the video's menu interstitial.
 */
export default function OpeningRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  if (!DEMO) return <Redirect href={id ? categoryHref(id) : '/home'} />;
  return <Opening />;
}

function Opening() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const { data } = useCatalog();
  const { width, height } = useWindowDimensions();
  // Live: the aisle (a Blynk category, by slug) names the intro and fills the printed card.
  const cat = DEMO ? null : findAisle(data, id);
  const title = DEMO ? OPENING.title : openingTitle(data, cat, name);
  const sub = DEMO ? OPENING.sub : LIVE_SUB;
  const courses: Course[] = DEMO ? OPENING.courses : openingCourses(data, cat);
  const plate = DEMO ? null : (courses.find((c) => c.product?.image_url)?.product ?? null);
  const run = useSharedValue(0);
  const tint = useSharedValue(0);
  const sweep = useSharedValue(0);

  useEffect(() => {
    run.value = withRepeat(withTiming(1, { duration: LAP, easing: Easing.linear }), -1, false);
    tint.value = withTiming(1, { duration: 260, easing: Easing.out(Easing.quad) });
    sweep.value = withRepeat(withTiming(1, { duration: 900, easing: Easing.inOut(Easing.quad) }), -1, false);
    const t = setTimeout(() => {
      if (DEMO) router.replace({ pathname: '/store/[id]', params: { id: id || 'ovenfresh' } });
      else if (id) router.replace({ pathname: '/store/[id]', params: { id } });
      else router.replace('/home');
    }, STAY);
    return () => clearTimeout(t);
  }, []);

  const arcs = useAnimatedProps(() => ({ strokeDashoffset: -(START + run.value * PERIM) }));
  const arcsA = useAnimatedStyle(() => ({ opacity: 0.3 + tint.value * 0.7 }));
  const SUB_W = 190;
  const band = useAnimatedStyle(() => ({ transform: [{ translateX: -60 + sweep.value * (SUB_W + 60) }] }));
  const bandTxt = useAnimatedStyle(() => ({ transform: [{ translateX: 60 - sweep.value * (SUB_W + 60) }] }));

  const cy = height / 2;
  return (
    <View style={styles.root}>
      <View style={[styles.art, { left: width / 2 - 1.5 - ART_W / 2 - 10, top: cy - 55.5 - ART_H / 2 - 10 }]}>
        <View style={styles.tilt}>
          <MenuCard courses={courses} plate={plate} />
          <Animated.View style={[StyleSheet.absoluteFill, arcsA]}>
            <Svg width={ART_W + 20} height={ART_H + 20}>
              <AnimatedRect
                x={10} y={10} width={ART_W} height={ART_H} rx={RX} ry={RX}
                stroke={C.brandDeep} strokeWidth={3.2} strokeLinecap="round" fill="none"
                strokeDasharray={[DASH, PERIM / 2 - DASH]}
                animatedProps={arcs}
              />
            </Svg>
          </Animated.View>
        </View>
      </View>
      <View style={[styles.titleWrap, { top: cy + 40 }]}>
        {!!title[0] && <Text style={styles.big} numberOfLines={DEMO ? undefined : 1}>{title[0]}</Text>}
        {!!title[1] && <Text style={styles.big} numberOfLines={DEMO ? undefined : 1}>{title[1]}</Text>}
      </View>
      <View style={[styles.subWrap, { top: cy + 147 }]}>
        <Text style={styles.small}>{sub}</Text>
        {/* the light sweep: a grey copy of the caption seen through a moving window */}
        <Animated.View style={[styles.band, band]}>
          <Animated.View style={[{ width: SUB_W + 80 }, bandTxt]}>
            <Text style={[styles.small, { color: '#9C9C9C' }]}>{sub}</Text>
          </Animated.View>
        </Animated.View>
      </View>
    </View>
  );
}

/**
 * The printed menu: a photo plate and title up top, three course blocks with a dish each.
 * Live: the courses are the aisle's sub-categories (else its products), each with a real photo.
 */
function MenuCard({ courses, plate }: { courses: Course[]; plate: Product | null }) {
  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <View style={styles.plate}>
          {DEMO ? <Text style={{ fontSize: 22 }}>{OPENING.heroEmoji}</Text> : plate && <CardPhoto product={plate} size={26} />}
        </View>
        <View style={{ flex: 1, alignItems: 'center', paddingTop: 6 }}>
          <Text style={styles.cardHead}>{DEMO ? OPENING.menuHead : 'PRICE LIST'}</Text>
          <View style={[styles.line, { width: 18, marginTop: 2 }]} />
        </View>
      </View>
      {courses.map((c, ci) => (
        <View key={`${ci}:${c.name}`} style={styles.course}>
          <View style={{ flex: 1, paddingLeft: 8, gap: 2.5 }}>
            <Text style={styles.courseName} numberOfLines={DEMO ? undefined : 1}>{c.name}</Text>
            {[30, 24, 28].map((w, i) => (
              <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingRight: 4 }}>
                <View style={[styles.line, { width: w }]} />
                <View style={[styles.line, { width: 6 }]} />
              </View>
            ))}
          </View>
          <View style={styles.dish}>
            {c.emoji ? <Text style={{ fontSize: 17 }}>{c.emoji}</Text> : c.product && <CardPhoto product={c.product} size={24} />}
          </View>
        </View>
      ))}
    </View>
  );
}

const CardPhoto = ({ product, size }: { product: Product; size: number }) => (
  <ProductImage product={product} size={size} radius={0} style={{ backgroundColor: 'transparent' }} />
);

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fff' },
  art: { position: 'absolute', width: ART_W + 20, height: ART_H + 20 },
  tilt: { flex: 1, transform: [{ rotate: '-8deg' }], alignItems: 'center', justifyContent: 'center' },
  card: {
    width: 114, height: 127, backgroundColor: '#FBFBFB', borderRadius: 8, overflow: 'hidden',
    shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 3,
  },
  cardTop: { flexDirection: 'row', height: 30, backgroundColor: '#EFEFEF' },
  plate: { width: 34, height: 30, alignItems: 'center', justifyContent: 'center' },
  cardHead: { fontFamily: F.black, fontSize: 6.5, color: '#222', letterSpacing: 0.4, borderWidth: 0.8, borderColor: '#222', paddingHorizontal: 2 },
  course: { flexDirection: 'row', alignItems: 'center', height: 32 },
  courseName: { fontFamily: F.bold, fontSize: 5, color: '#333', marginBottom: 1 },
  line: { height: 1.4, borderRadius: 1, backgroundColor: '#D3D3D3' },
  dish: { width: 34, height: 28, backgroundColor: '#F0F0F0', alignItems: 'center', justifyContent: 'center', marginRight: 3 },
  titleWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  big: { fontFamily: F.black, color: C.brandText, fontSize: 16.5, lineHeight: 21, letterSpacing: -0.2 },
  subWrap: { position: 'absolute', alignSelf: 'center', overflow: 'hidden' },
  small: { fontFamily: F.medium, color: '#1A171D', fontSize: 15.5 },
  band: { position: 'absolute', top: 0, bottom: 0, left: 0, width: 60, overflow: 'hidden' },
});
