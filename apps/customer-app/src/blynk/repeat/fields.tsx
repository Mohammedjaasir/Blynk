import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { addressSummary, type SavedAddress } from '@/blynk/address/api';
import type { StoreInfo } from '@/blynk/api/types';
import { hoursSummary } from '@/blynk/lib/storeText';
import { PressScale } from '@/components/ui';
import { withSpring } from '@/lib/motion';
import { C, F } from '@/lib/theme';
import type { Frequency } from './models';
import { dayHours, defaultTime, hourGroups, hourLabel, startDates, timeOptions, WEEKDAYS, WEEKDAYS_SHORT } from './schedule';

/*
 * The schedule part of the repeat basket sheets: how often, which weekday, the order time (only
 * quarter hours inside the store's opening hours that day, from the store settings), the address
 * and the first day. Controlled: the parent keeps the draft.
 */

export interface Draft {
  frequency: Frequency;
  /** 0 = Sunday ... 6 = Saturday (used for WEEKLY / BIWEEKLY). */
  weekday: number;
  time: string | null;
  addressId: string | null;
  startDate: string;
}

/** The draft with a time that the store's hours allow for its schedule (keeps the chosen one when it still fits). */
export function withValidTime(d: Draft, store: StoreInfo | null): Draft {
  const opts = timeOptions(store, d.frequency, d.weekday);
  const time = defaultTime(opts, d.time);
  return time === d.time ? d : { ...d, time };
}

/** The first open weekday from `from` on (the store's closed days are skipped). */
export function openWeekday(store: StoreInfo | null, from: number): number {
  for (let i = 0; i < 7; i++) {
    const wd = (from + i) % 7;
    if (dayHours(store, wd)) return wd;
  }
  return from;
}

const FREQS: { id: Frequency; label: string }[] = [
  { id: 'DAILY', label: 'Every day' },
  { id: 'WEEKLY', label: 'Every week' },
  { id: 'BIWEEKLY', label: 'Every 2 weeks' },
];
/** Monday first, as a Sri Lankan calendar reads. */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

export function Label({ children }: { children: string }) {
  return <Text style={st.label}>{children}</Text>;
}

/** Three choices with a yellow pill that springs to the chosen one. */
function Segmented({ value, onChange }: { value: Frequency; onChange: (f: Frequency) => void }) {
  const [w, setW] = useState(0);
  const idx = Math.max(0, FREQS.findIndex((f) => f.id === value));
  const x = useSharedValue(0);
  const segW = w > 0 ? (w - 8) / FREQS.length : 0;
  useEffect(() => { x.value = withSpring(idx * segW, { damping: 18, stiffness: 220 }); }, [idx, segW, x]);
  const pillA = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  return (
    <View style={st.seg} onLayout={(e) => setW(e.nativeEvent.layout.width)} accessibilityRole="radiogroup">
      {segW > 0 && <Animated.View style={[st.segPill, { width: segW }, pillA]} />}
      {FREQS.map((f) => (
        <Pressable
          key={f.id}
          onPress={() => onChange(f.id)}
          style={st.segBtn}
          accessibilityRole="radio"
          accessibilityState={{ selected: f.id === value }}
        >
          <Text style={[st.segTxt, f.id === value && st.segTxtOn]} numberOfLines={1}>{f.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function Chip({ label, on, disabled, onPress, wide, a11y }: { label: string; on: boolean; disabled?: boolean; onPress: () => void; wide?: boolean; a11y?: string }) {
  return (
    <PressScale
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      scaleTo={0.93}
      accessibilityRole="button"
      accessibilityLabel={a11y ?? label}
      style={[st.chip, wide && { paddingHorizontal: 14 }, on && st.chipOn, disabled && st.chipOff]}
    >
      <Text style={[st.chipTxt, on && st.chipTxtOn, disabled && { color: C.faint }]}>{label}</Text>
    </PressScale>
  );
}

export function ScheduleFields({ draft, onChange, store, addresses, showStart = true, addressNote }: {
  draft: Draft;
  onChange: (d: Draft) => void;
  store: StoreInfo | null;
  /** The saved addresses (null while loading). */
  addresses: SavedAddress[] | null;
  showStart?: boolean;
  /** A line above the addresses (e.g. "This order went to ..."). */
  addressNote?: string | null;
}) {
  const set = (patch: Partial<Draft>) => onChange(withValidTime({ ...draft, ...patch }, store));
  const options = useMemo(() => timeOptions(store, draft.frequency, draft.weekday), [store, draft.frequency, draft.weekday]);
  const groups = useMemo(() => hourGroups(options), [options]);
  const hour = draft.time ? Number(draft.time.slice(0, 2)) : null;
  const minutes = groups.find((g) => g.hour === hour)?.minutes ?? [];
  const dates = useMemo(() => startDates(new Date(), 7), []);
  const hoursLine = hoursSummary(store);
  const weekly = draft.frequency !== 'DAILY';

  // keep the chosen hour in view
  const hoursRef = useRef<ScrollView>(null);
  const hourIdx = groups.findIndex((g) => g.hour === hour);
  useEffect(() => {
    if (hourIdx > 2) hoursRef.current?.scrollTo({ x: (hourIdx - 1) * 66, animated: false });
  }, [hourIdx, groups.length]);

  return (
    <View>
      <Label>How often</Label>
      <Segmented value={draft.frequency} onChange={(f) => set({ frequency: f })} />

      {weekly && (
        <>
          <Label>On</Label>
          <View style={st.week}>
            {WEEK_ORDER.map((wd) => {
              const closed = !dayHours(store, wd);
              const on = draft.weekday === wd;
              return (
                <PressScale
                  key={wd}
                  onPress={closed ? undefined : () => set({ weekday: wd })}
                  disabled={closed}
                  scaleTo={0.9}
                  accessibilityRole="button"
                  accessibilityLabel={closed ? `${WEEKDAYS[wd]}, closed` : WEEKDAYS[wd]}
                  style={[st.day, on && st.chipOn, closed && st.chipOff]}
                >
                  <Text style={[st.dayTxt, on && st.chipTxtOn, closed && { color: C.faint, textDecorationLine: 'line-through' }]}>{WEEKDAYS_SHORT[wd]}</Text>
                </PressScale>
              );
            })}
          </View>
        </>
      )}

      <Label>Order time</Label>
      {options.length === 0 ? (
        <Text style={st.note}>{store ? `We're closed on ${weekly ? `${WEEKDAYS[draft.weekday]}s` : 'every day'} - pick another day.` : 'Loading our opening hours…'}</Text>
      ) : (
        <>
          <ScrollView ref={hoursRef} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.row}>
            {groups.map((g) => (
              <Chip
                key={g.hour}
                label={hourLabel(g.hour)}
                on={g.hour === hour}
                onPress={() => set({ time: `${String(g.hour).padStart(2, '0')}:${g.minutes.includes(draft.time?.slice(3, 5) ?? '') ? draft.time!.slice(3, 5) : g.minutes[0]}` })}
              />
            ))}
          </ScrollView>
          <View style={[st.row, { marginTop: 8 }]}>
            {['00', '15', '30', '45'].map((m) => (
              <Chip
                key={m}
                label={`:${m}`}
                a11y={`${m} minutes past`}
                on={draft.time?.slice(3, 5) === m}
                disabled={!minutes.includes(m)}
                onPress={() => hour !== null && set({ time: `${String(hour).padStart(2, '0')}:${m}` })}
                wide
              />
            ))}
          </View>
          {!!hoursLine && <Text style={[st.note, { marginTop: 8 }]}>We place it at this time, inside our hours ({hoursLine}).</Text>}
        </>
      )}

      <Label>Deliver to</Label>
      {!!addressNote && <Text style={[st.note, { marginBottom: 8 }]}>{addressNote}</Text>}
      {addresses === null ? (
        <Text style={st.note}>Loading your addresses…</Text>
      ) : addresses.length === 0 ? (
        <Pressable onPress={() => router.push('/address')} accessibilityRole="link" style={st.addAddr}>
          <Text style={st.link}>Add a delivery address first</Text>
        </Pressable>
      ) : (
        <View style={st.addrBox}>
          {addresses.slice(0, 6).map((a, i) => {
            const on = a.id === draft.addressId;
            return (
              <Pressable
                key={a.id}
                onPress={() => set({ addressId: a.id })}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                style={[st.addr, i > 0 && st.addrLine]}
              >
                <View style={[st.radio, on && st.radioOn]}>{on && <View style={st.radioDot} />}</View>
                <View style={{ flex: 1 }}>
                  <Text style={st.addrTitle} numberOfLines={1}>{a.label}</Text>
                  <Text style={st.note} numberOfLines={1}>{addressSummary(a)}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      )}

      {showStart && (
        <>
          <Label>Starting</Label>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.row}>
            {dates.map((d) => (
              <Chip key={d.ymd} label={d.label} on={draft.startDate === d.ymd} onPress={() => set({ startDate: d.ymd })} wide />
            ))}
          </ScrollView>
        </>
      )}
    </View>
  );
}

export const fieldStyles = StyleSheet.create({
  note: { fontFamily: F.regular, fontSize: 12.5, color: C.sub, lineHeight: 17 },
});

const st = StyleSheet.create({
  label: { fontFamily: F.semi, fontSize: 12, color: C.sub, letterSpacing: 0.4, textTransform: 'uppercase', marginTop: 18, marginBottom: 8 },
  seg: { flexDirection: 'row', backgroundColor: C.bg, borderRadius: 14, padding: 4, height: 44 },
  segPill: {
    position: 'absolute', top: 4, left: 4, bottom: 4, borderRadius: 11, backgroundColor: C.brand,
    shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1,
  },
  segBtn: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  segTxt: { fontFamily: F.medium, fontSize: 13.5, color: C.sub },
  segTxtOn: { fontFamily: F.semi, color: C.brandInk },
  week: { flexDirection: 'row', justifyContent: 'space-between' },
  day: { width: 42, height: 42, borderRadius: 21, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center', backgroundColor: C.white },
  dayTxt: { fontFamily: F.medium, fontSize: 12.5, color: C.text },
  row: { flexDirection: 'row', gap: 8, paddingRight: 4 },
  chip: { height: 36, minWidth: 58, paddingHorizontal: 12, borderRadius: 18, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center', backgroundColor: C.white },
  chipOn: { backgroundColor: C.brand, borderColor: C.brandDeep },
  chipOff: { backgroundColor: C.bg, borderColor: C.bg },
  chipTxt: { fontFamily: F.medium, fontSize: 13.5, color: C.text },
  chipTxtOn: { fontFamily: F.semi, color: C.brandInk },
  note: fieldStyles.note,
  link: { fontFamily: F.semi, fontSize: 14, color: C.brandText },
  addAddr: { paddingVertical: 10 },
  addrBox: { borderWidth: 1, borderColor: C.line, borderRadius: 14, overflow: 'hidden' },
  addr: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 13, paddingVertical: 11 },
  addrLine: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line },
  addrTitle: { fontFamily: F.semi, fontSize: 14, color: C.ink },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: C.faint, alignItems: 'center', justifyContent: 'center' },
  radioOn: { borderColor: C.brandInk },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: C.brandInk },
});
