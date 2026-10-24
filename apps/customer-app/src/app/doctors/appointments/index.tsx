import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSession } from '@/blynk/auth/session';
import { DOCTOR_UI } from '@/blynk/doctors/words';
import { fetchMyAppointments } from '@/blynk/doctors/api';
import { appointmentBadge, bucketAppointments, formatAppointmentDateTime, showsRating } from '@/blynk/doctors/format';
import { GlyphTile } from '@/blynk/doctors/glyphs';
import { RatingCard } from '@/blynk/doctors/sections';
import type { Appointment } from '@/blynk/doctors/types';
import { errorText, s } from '@/blynk/doctors/ui';
import { Badge, Card, ListSkeleton, Page, StateView } from '@/blynk/ui/kit';
import { openSignIn } from '@/blynk/ui/signIn';
import { useLoad } from '@/blynk/ui/useLoad';
import { PressScale } from '@/components/ui';
import { DEMO } from '@/demo/mode';
import { C, F } from '@/lib/theme';
import { DOCTORS_SIGN_IN } from '@/blynk/doctors/access';
import { DOCTOR_SCREENS as W } from '@/blynk/doctors/words';

/** My appointments, Upcoming / Past (Flutter DentalMyAppointmentsScreen, GET /dental/appointments). */
export default function MyAppointments() {
  const signedIn = !!useSession();
  const [bucket, setBucket] = useState<'upcoming' | 'past'>('upcoming');
  const load = useLoad((signal) => fetchMyAppointments(50, signal), [], signedIn && !DEMO);
  const now = new Date();
  const replace = (a: Appointment) => load.set((load.data ?? []).map((x) => (x.id === a.id ? a : x)));

  let body: React.ReactNode;
  if (DEMO) body = <StateView title={W.listTitle} message={W.listDemo} />;
  else if (!signedIn) body = <StateView title={W.listLogIn} message={DOCTORS_SIGN_IN.message} action={DOCTORS_SIGN_IN.action} onAction={openSignIn} />;
  else if (load.loading && !load.data) body = <ListSkeleton rows={4} />;
  else if (load.error && !load.data) body = <StateView title={W.listFailed} message={errorText(load.error)} action={DOCTOR_UI.tryAgain} onAction={load.reload} />;
  else {
    const rows = bucketAppointments(load.data ?? [], now, bucket);
    body = (
      <View>
        <View style={st.toggle}>
          {(['upcoming', 'past'] as const).map((b) => (
            <PressScale key={b} onPress={() => setBucket(b)} style={{ flex: 1 }} scaleTo={0.97}>
              <View style={[st.seg, bucket === b && st.segOn]} accessible accessibilityRole="button" accessibilityState={{ selected: bucket === b }}>
                <Text style={[st.segTxt, bucket === b && { fontFamily: F.black, color: C.ink }]}>{b === 'upcoming' ? W.upcoming : W.past}</Text>
              </View>
            </PressScale>
          ))}
        </View>
        {rows.length === 0 ? (
          <StateView
            title={bucket === 'upcoming' ? W.noUpcoming : W.noPast}
            message={bucket === 'upcoming' ? W.bookVisit : null}
            action={bucket === 'upcoming' ? W.channelDoctors : undefined}
            onAction={() => router.push('/doctors')}
          />
        ) : rows.map((a, i) => {
          const badge = appointmentBadge(a, now);
          const when = a.startAt ? formatAppointmentDateTime(a.startAt) : W.timeUnavailable;
          return (
            <Animated.View key={a.id} entering={FadeInDown.delay(Math.min(i, 6) * 40).duration(220)}>
              <Card
                onPress={() => router.push({ pathname: '/doctors/appointments/[id]', params: { id: a.id } })}
                label={`${a.doctor?.fullName ?? W.appointment}, ${badge.label}, ${when}`}
                style={showsRating(a) ? { marginBottom: 8 } : undefined}
              >
                <View style={{ flexDirection: 'row', gap: 12 }}>
                  <GlyphTile kind="person" photo={a.doctor?.photoUrl} />
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                      <Text style={s.title}>{a.doctor?.fullName ?? W.appointment}</Text>
                      <Badge tone={badge.tone} label={badge.label} />
                    </View>
                    {a.clinic && <Text style={s.sub}>{a.clinic.name}</Text>}
                    <Text style={s.caption}>{when}</Text>
                  </View>
                </View>
              </Card>
              {showsRating(a) && <RatingCard appointment={a} onRated={replace} compact />}
            </Animated.View>
          );
        })}
      </View>
    );
  }
  return <Page title={W.listTitle}>{body}</Page>;
}

const st = StyleSheet.create({
  toggle: { flexDirection: 'row', backgroundColor: '#E9E9EF', borderRadius: 14, padding: 4, marginBottom: 14 },
  seg: { minHeight: 42, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  segOn: { backgroundColor: '#fff' },
  segTxt: { fontFamily: F.semi, fontSize: 14, color: C.sub },
});
