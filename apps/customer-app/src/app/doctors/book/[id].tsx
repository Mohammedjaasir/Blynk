import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSession } from '@/blynk/auth/session';
import { DOCTORS_SIGN_IN } from '@/blynk/doctors/access';
import {
  fetchAvailability, fetchDoctor, fetchSlots, holdSlot, isSlotConflict, isSlotInPast, newIdempotencyKey,
} from '@/blynk/doctors/api';
import { startBooking } from '@/blynk/doctors/booking';
import {
  dayHasAvailability, dayStrip, formatAppointmentDate, formatDayStripLabel, formatSlotTime, isoDate, sameDay, slotPassedText, slotTakenText,
} from '@/blynk/doctors/format';
import { DoctorsGate, DoctorsSignInPrompt } from '@/blynk/doctors/Gate';
import { pairingFor } from '@/blynk/doctors/types';
import { errorText, LoadFailure } from '@/blynk/doctors/ui';
import { ListSkeleton, Notice, Page, SectionTitle, StateView, useToast } from '@/blynk/ui/kit';
import { useLoad } from '@/blynk/ui/useLoad';
import { PressScale, Skeleton } from '@/components/ui';
import { C, F } from '@/lib/theme';
import { DOCTOR_SCREENS as W } from '@/blynk/doctors/words';
import { DOCTOR_UI } from '@/blynk/doctors/words';

/**
 * Step 1 of booking (Flutter DentalSlotPickerScreen): pick a day in the next two weeks, then a
 * time, which is held for you (POST /dental/appointments/holds). Days without times stay in the
 * strip, marked "No times". Times are never cached: every day pick and every return asks again.
 */
export default function BookScreen() {
  const { id = '', clinic = '' } = useLocalSearchParams<{ id: string; clinic: string }>();
  return <DoctorsGate><SlotPicker doctorId={id} clinicId={clinic} /></DoctorsGate>;
}

function SlotPicker({ doctorId, clinicId }: { doctorId: string; clinicId: string }) {
  const signedIn = !!useSession();
  const [toast, showToast] = useToast();
  const days = useMemo(() => dayStrip(new Date()), []);
  const base = useLoad(async (signal) => {
    const doctor = await fetchDoctor(doctorId, signal);
    const pairing = pairingFor(doctor, clinicId);
    if (!pairing) return { doctor, pairing: null, availability: [] };
    const availability = await fetchAvailability(doctorId, clinicId, days[0], days[days.length - 1], signal);
    return { doctor, pairing, availability };
  }, [doctorId, clinicId]);

  const [day, setDay] = useState<Date>(days[0]);
  const [message, setMessage] = useState<string | null>(null);
  const [holding, setHolding] = useState<number | null>(null);
  const [askSignIn, setAskSignIn] = useState(false);

  const ready = !!base.data?.pairing;
  // never cached: a fresh ask for every day picked, on every return here, and after a refusal
  const times = useLoad((signal) => fetchSlots(doctorId, clinicId, day, signal), [doctorId, clinicId, isoDate(day)], ready);
  const slots = times.data;
  const slotsError = times.error;
  const loadSlots = times.reload;
  // back from Patient details / Review (booked, backed out or expired): the list may be stale
  const first = useRef(true);
  useFocusEffect(useCallback(() => {
    if (first.current) { first.current = false; return; }
    loadSlots();
  }, [loadSlots]));

  const pick = (d: Date) => {
    if (sameDay(d, day)) return;
    setDay(d);
    setMessage(null);
  };

  const hold = async (slot: Date) => {
    const data = base.data;
    if (!data?.pairing || holding != null) return;
    if (!signedIn) { setAskSignIn(true); return; }
    setHolding(slot.getTime());
    setMessage(null);
    const out = await holdSlot(data.pairing.clinicDoctorId, slot, newIdempotencyKey());
    setHolding(null);
    if (out.appointment) {
      startBooking(out.appointment, data.doctor, data.pairing);
      router.push({ pathname: '/doctors/patient', params: { hold: out.appointment.id } });
      return;
    }
    if (isSlotConflict(out.error) || isSlotInPast(out.error)) {
      // never a silent retry, never an auto-picked nearby slot: say so and refresh
      setMessage(isSlotConflict(out.error) ? slotTakenText() : slotPassedText());
      loadSlots();
    } else {
      showToast(errorText(out.error));
    }
  };

  const data = base.data;
  return (
    <View style={{ flex: 1 }}>
      <Page title={data?.doctor.fullName || W.bookTitle}>
        {askSignIn && !signedIn ? (
          <DoctorsSignInPrompt title={DOCTORS_SIGN_IN.bookTitle} />
        ) : base.loading && !data ? (
          <ListSkeleton rows={3} h={64} />
        ) : base.error || !data ? (
          <LoadFailure error={base.error} title={W.bookFailed} onRetry={base.reload} />
        ) : !data.pairing ? (
          <StateView title={W.doctorUnavailable} message={W.doctorUnavailableSub} action={DOCTOR_UI.goBack} onAction={() => router.back()} />
        ) : (
          <View>
            <SectionTitle>{W.pickDay}</SectionTitle>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 6 }} style={{ marginHorizontal: -15, paddingHorizontal: 15 }}>
              {days.map((d) => {
                const open = dayHasAvailability(d, data.availability);
                const on = sameDay(d, day);
                return (
                  <PressScale key={isoDate(d)} onPress={open ? () => pick(d) : undefined} disabled={!open} scaleTo={0.95}>
                    <View
                      style={[st.day, on && st.dayOn, !open && st.dayOff]}
                      accessible
                      accessibilityRole="button"
                      accessibilityState={{ selected: on, disabled: !open }}
                      accessibilityLabel={open ? formatDayStripLabel(d) : W.noTimesA11y(formatDayStripLabel(d))}
                    >
                      <Text style={[st.dayTxt, on && { color: C.brandInk }, !open && { color: C.faint }]}>{formatDayStripLabel(d)}</Text>
                      {!open && <Text style={st.noTimes}>{W.noTimes}</Text>}
                    </View>
                  </PressScale>
                );
              })}
            </ScrollView>

            {!!message && <View style={{ marginTop: 10 }}><Notice>{message}</Notice></View>}

            <View style={{ marginTop: 14 }}>
              {slotsError ? (
                <LoadFailure error={slotsError} title={W.timesFailed} onRetry={loadSlots} />
              ) : !slots ? (
                <View style={st.wrap}>{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} w={92} h={48} r={12} />)}</View>
              ) : slots.length === 0 ? (
                <StateView title={W.fullyBooked} message={W.tryAnotherDay} />
              ) : (
                <>
                  <SectionTitle>{W.timesOn(formatAppointmentDate(day))}</SectionTitle>
                  <View style={st.wrap}>
                    {slots.map((t) => {
                      const mine = holding === t.getTime();
                      const off = holding != null && !mine;
                      return (
                        <PressScale key={t.toISOString()} onPress={() => void hold(t)} disabled={holding != null} scaleTo={0.95}>
                          <View
                            style={[st.slot, mine && st.dayOn, off && st.dayOff]}
                            accessible
                            accessibilityRole="button"
                            accessibilityLabel={mine ? W.reserving(formatSlotTime(t)) : off ? W.unavailableWhile(formatSlotTime(t)) : formatSlotTime(t)}
                          >
                            {mine ? <ActivityIndicator color={C.brandInk} /> : <Text style={[st.slotTxt, off && { color: C.faint }]}>{formatSlotTime(t)}</Text>}
                          </View>
                        </PressScale>
                      );
                    })}
                  </View>
                </>
              )}
            </View>
          </View>
        )}
      </Page>
      {toast}
    </View>
  );
}

const st = StyleSheet.create({
  day: { minWidth: 60, paddingHorizontal: 12, paddingVertical: 12, borderRadius: 12, borderWidth: 1.2, borderColor: '#CFCFD6', backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  dayOn: { backgroundColor: C.brand, borderColor: C.brandDeep },
  dayOff: { borderColor: C.line, backgroundColor: '#FAFAFB' },
  dayTxt: { fontFamily: F.bold, fontSize: 12.5, color: C.ink },
  noTimes: { fontFamily: F.regular, fontSize: 11, color: C.faint, marginTop: 2 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  slot: { minWidth: 92, minHeight: 48, paddingHorizontal: 16, borderRadius: 12, borderWidth: 1.2, borderColor: '#CFCFD6', backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  slotTxt: { fontFamily: F.bold, fontSize: 14, color: C.ink },
});
