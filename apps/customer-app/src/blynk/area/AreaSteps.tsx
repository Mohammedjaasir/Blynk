import { router } from 'expo-router';
import { ActivityIndicator, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, SlideInRight } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SmallPin, TargetIcon } from '@/blynk/address/pins';
import { BackIcon, ChevronIcon } from '@/components/icons';
import { PressScale } from '@/components/ui';
import { C, F } from '@/lib/theme';
import { AREA, noteText } from './copy';
import { centreName, deliveryAreas, kmText, type Coverage, type PlaceAt } from './coverage';
import { CoverageMap } from './CoverageMap';
import type { Note } from './flow';

/*
 * The first two steps of adding an address (owner, 2026-10-14): the delivery-area map with the
 * three ways on, and the area list. The address screen (LiveAddressScreen) lays them over its map.
 */

const MAP_MAX = 420;

/** Step 1: where we deliver, then GPS / drag the pin / choose the area. */
export function AreaIntro({ coverage, note, asking, onBack, onGps, onDrag }: {
  coverage: Coverage; note: Note; asking: boolean;
  onBack: () => void; onGps: () => void; onDrag: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const mapW = Math.min(width, MAP_MAX) - 30;
  const mapH = Math.round(Math.min(mapW * 0.92, 360));
  const text = noteText(note);
  const gpsOff = note === 'denied' || note === 'unavailable' || note === 'timeout' || note === 'unsupported';
  return (
    <Animated.View entering={FadeIn.duration(140)} style={[StyleSheet.absoluteFill, styles.screen]}>
      <View style={[styles.head, { paddingTop: insets.top + 10 }]}>
        <PressScale onPress={onBack} style={styles.backBtn}><BackIcon size={19} color="#111" stroke={2} /></PressScale>
        <Text style={styles.title} accessibilityRole="header">{AREA.title}</Text>
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 15, paddingBottom: insets.bottom + 28, alignItems: 'center' }}>
        <View style={{ width: mapW }}>
          {!!text && (
            <Animated.View entering={FadeIn.duration(160)} style={[styles.note, gpsOff || note === 'outsideFix' ? styles.noteWarn : null]} accessibilityRole="alert">
              <Text style={styles.noteTxt}>{text}</Text>
            </Animated.View>
          )}
          <Animated.View entering={FadeInDown.duration(260)}>
            <CoverageMap coverage={coverage} width={mapW} height={mapH} />
          </Animated.View>
          <Text style={styles.caption}>{AREA.within(coverage)}</Text>
          <Text style={styles.small}>{AREA.mapNote}</Text>

          <View style={{ marginTop: 16, gap: 10 }}>
            {/* with location off, the two GPS-free ways come first */}
            {!gpsOff && (
              <Option primary icon={asking ? <ActivityIndicator size="small" color={C.brandInk} /> : <TargetIcon />} title={asking ? AREA.asking : AREA.useGps} onPress={onGps} disabled={asking} />
            )}
            <Option icon={<SmallPin />} title={AREA.drag} sub={AREA.dragSub} onPress={onDrag} primary={gpsOff} />
            {gpsOff && (
              <Option icon={asking ? <ActivityIndicator size="small" color={C.brandInk} /> : <TargetIcon />} title={asking ? AREA.asking : AREA.useGps} onPress={onGps} disabled={asking} quiet />
            )}
          </View>
        </View>
      </ScrollView>
    </Animated.View>
  );
}

function Option({ icon, title, sub, onPress, primary, quiet, disabled }: {
  icon: React.ReactNode; title: string; sub?: string; onPress: () => void; primary?: boolean; quiet?: boolean; disabled?: boolean;
}) {
  return (
    <PressScale onPress={onPress} disabled={disabled} haptic={primary} scaleTo={0.97}>
      <View style={[styles.option, primary && styles.optionPrimary, quiet && styles.optionQuiet]} accessible accessibilityRole="button" accessibilityLabel={sub ? `${title}. ${sub}` : title}>
        <View style={[styles.optIcon, primary && { backgroundColor: 'rgba(255,255,255,0.7)' }]}>{icon}</View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.optTitle, quiet && { fontFamily: F.medium, color: C.sub }]}>{title}</Text>
          {!!sub && <Text style={styles.optSub}>{sub}</Text>}
        </View>
        <View style={{ transform: [{ rotate: '-90deg' }] }}><ChevronIcon size={14} color={primary ? C.brandInk : C.sub} stroke={2.2} /></View>
      </View>
    </PressScale>
  );
}

/** Step 2: the areas inside the radius (tap one), then the ones outside, which say so. */
export function AreaList({ coverage, onBack, onPick, onDrag }: {
  coverage: Coverage; onBack: () => void; onPick: (a: PlaceAt) => void; onDrag: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { inside, outside } = deliveryAreas(coverage);
  return (
    <Animated.View entering={SlideInRight.duration(200)} style={[StyleSheet.absoluteFill, styles.screen]}>
      <View style={[styles.head, { paddingTop: insets.top + 10 }]}>
        <PressScale onPress={onBack} style={styles.backBtn}><BackIcon size={19} color="#111" stroke={2} /></PressScale>
        <Text style={styles.title} accessibilityRole="header">{AREA.listTitle}</Text>
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 15, paddingBottom: insets.bottom + 28 }}>
        <Text style={[styles.small, { marginTop: 4, marginBottom: 10 }]}>{AREA.within(coverage)}</Text>
        <View style={styles.listCard}>
          {inside.map((a, i) => (
            <PressScale key={a.id} onPress={() => onPick(a)} scaleTo={0.98}>
              <View style={[styles.row, i > 0 && styles.rowLine]} accessible accessibilityRole="button" accessibilityLabel={`${a.name}, ${kmText(a.km)} ${AREA.fromStore}`}>
                <View style={styles.dot} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>{a.name}</Text>
                  <Text style={styles.rowSub}>{a.km < 0.05 ? centreName(coverage) : `${kmText(a.km)} ${AREA.fromStore}`}</Text>
                </View>
                <View style={{ transform: [{ rotate: '-90deg' }] }}><ChevronIcon size={14} color={C.sub} stroke={2.2} /></View>
              </View>
            </PressScale>
          ))}
        </View>
        {outside.length > 0 && (
          <View style={[styles.listCard, { marginTop: 12, backgroundColor: '#FAFAFB' }]}>
            {outside.map((a, i) => (
              <View key={a.id} style={[styles.row, i > 0 && styles.rowLine]} accessible accessibilityLabel={`${a.name}, ${kmText(a.km)}. ${AREA.outside}`}>
                <View style={[styles.dot, styles.dotOut]} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.rowTitle, { color: '#8D8F9C' }]}>{a.name}</Text>
                  <Text style={styles.rowSub}>{`${kmText(a.km)} · ${AREA.outside}`}</Text>
                </View>
              </View>
            ))}
          </View>
        )}
        <PressScale onPress={onDrag} style={{ marginTop: 16 }}>
          <Text style={styles.link}>{AREA.notListed}</Text>
        </PressScale>
      </ScrollView>
    </Animated.View>
  );
}

/** A small "where we deliver" card for checkout and the order screens; taps open the full map. */
export function CoverageCard({ coverage, pin, style }: { coverage: Coverage; pin?: { lat: number; lng: number } | null; style?: object }) {
  const { inside } = deliveryAreas(coverage);
  const names = inside.filter((a) => a.km >= 0.05).slice(0, 5).map((a) => a.name);
  return (
    <PressScale onPress={() => router.push('/delivery-area')} scaleTo={0.98} style={style}>
      <View style={styles.card} accessible accessibilityRole="button" accessibilityLabel={`${AREA.within(coverage)} ${AREA.seeMap}`}>
        <CoverageMap coverage={coverage} width={92} height={92} compact pin={pin} />
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>{AREA.withinShort(coverage)}</Text>
          {names.length > 0 && <Text style={styles.cardSub} numberOfLines={2}>{names.join(' · ')}</Text>}
          <Text style={styles.cardLink}>{AREA.seeMap}</Text>
        </View>
      </View>
    </PressScale>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: '#fff', zIndex: 20 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 12 },
  backBtn: {
    width: 31, height: 31, borderRadius: 16, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: '#E6E6E9',
  },
  title: { flex: 1, fontFamily: F.bold, fontSize: 18, color: C.ink },
  note: { backgroundColor: C.brandTint, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 12 },
  noteWarn: { backgroundColor: '#FFF1DC' },
  noteTxt: { fontFamily: F.medium, fontSize: 13, color: C.text, lineHeight: 18 },
  caption: { fontFamily: F.semi, fontSize: 14.5, color: C.ink, marginTop: 12, lineHeight: 20 },
  small: { fontFamily: F.regular, fontSize: 12, color: C.sub, marginTop: 2, lineHeight: 16 },
  option: {
    flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 58, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10,
    backgroundColor: '#fff', borderWidth: 1.2, borderColor: '#E3E3E8',
  },
  optionPrimary: { backgroundColor: C.brand, borderColor: C.brandDeep },
  optionQuiet: { borderStyle: 'dashed', backgroundColor: '#FAFAFB' },
  optIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: C.brandTint, alignItems: 'center', justifyContent: 'center' },
  optTitle: { fontFamily: F.semi, fontSize: 15, color: C.brandInk },
  optSub: { fontFamily: F.regular, fontSize: 12, color: '#55555C', marginTop: 1 },
  listCard: { backgroundColor: '#fff', borderRadius: 16, borderWidth: 1, borderColor: C.line, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 13 },
  rowLine: { borderTopWidth: 1, borderTopColor: C.line },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: C.ink },
  dotOut: { backgroundColor: '#fff', borderWidth: 1.6, borderColor: '#8D8F9C' },
  rowTitle: { fontFamily: F.semi, fontSize: 15, color: C.ink },
  rowSub: { fontFamily: F.regular, fontSize: 12.5, color: C.sub, marginTop: 1 },
  link: { fontFamily: F.semi, fontSize: 13.5, color: C.brandText, textAlign: 'center', lineHeight: 19 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', borderRadius: 16, padding: 10 },
  cardTitle: { fontFamily: F.semi, fontSize: 14, color: C.ink, lineHeight: 19 },
  cardSub: { fontFamily: F.regular, fontSize: 12, color: C.sub, marginTop: 2, lineHeight: 16 },
  cardLink: { fontFamily: F.semi, fontSize: 12.5, color: C.brandText, marginTop: 5 },
});
