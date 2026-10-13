import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSession } from '@/blynk/auth/session';
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

/** My appointments, Upcoming / Past (Flutter DentalMyAppointmentsScreen, GET /dental/appointments). */
export default function MyAppointments() {
  const signedIn = !!useSession();
  const [bucket, setBucket] = useState<'upcoming' | 'past'>('upcoming');
  const load = useLoad((signal) => fetchMyAppointments(50, signal), [], signedIn && !DEMO);
  const now = new Date();
  const replace = (a: Appointment) => load.set((load.data ?? []).map((x) => (x.id === a.id ? a : x)));

  let body: React.ReactNode;
  if (DEMO) body = <StateView title="My appointments" message="Your doctor appointments show here once the shop is live." />;
  else if (!signedIn) body = <StateView title="Log in to see your appointments" message="Use your phone number to log in or create an account." action="Log in / Sign up" onAction={openSignIn} />;
  else if (load.loading && !load.data) body = <ListSkeleton rows={4} />;
  else if (load.error && !load.data) body = <StateView title="We couldn't load your appointments" message={errorText(load.error)} action="Try again" onAction={load.reload} />;
  else {
    const rows = bucketAppointments(load.data ?? [], now, bucket);
    body = (
      <View>
        <View style={st.toggle}>
          {(['upcoming', 'past'] as const).map((b) => (
            <PressScale key={b} onPress={() => setBucket(b)} style={{ flex: 1 }} scaleTo={0.97}>
              <View style={[st.seg, bucket === b && st.segOn]} accessible accessibilityRole="button" accessibilityState={{ selected: bucket === b }}>
                <Text style={[st.segTxt, bucket === b && { fontFamily: F.black, color: C.ink }]}>{b === 'upcoming' ? 'Upcoming' : 'Past'}</Text>
              </View>
            </PressScale>
          ))}
        </View>
        {rows.length === 0 ? (
          <StateView
            title={bucket === 'upcoming' ? 'No upcoming appointments' : 'No past appointments'}
            message={bucket === 'upcoming' ? 'Book a visit to see it here.' : null}
            action={bucket === 'upcoming' ? 'Channel doctors' : undefined}
            onAction={() => router.push('/doctors')}
          />
        ) : rows.map((a, i) => {
          const badge = appointmentBadge(a, now);
          const when = a.startAt ? formatAppointmentDateTime(a.startAt) : 'Time unavailable';
          return (
            <Animated.View key={a.id} entering={FadeInDown.delay(Math.min(i, 6) * 40).duration(220)}>
              <Card
                onPress={() => router.push({ pathname: '/doctors/appointments/[id]', params: { id: a.id } })}
                label={`${a.doctor?.fullName ?? 'Appointment'}, ${badge.label}, ${when}`}
                style={showsRating(a) ? { marginBottom: 8 } : undefined}
              >
                <View style={{ flexDirection: 'row', gap: 12 }}>
                  <GlyphTile kind="person" photo={a.doctor?.photoUrl} />
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                      <Text style={s.title}>{a.doctor?.fullName ?? 'Appointment'}</Text>
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
  return <Page title="My appointments">{body}</Page>;
}

const st = StyleSheet.create({
  toggle: { flexDirection: 'row', backgroundColor: '#E9E9EF', borderRadius: 14, padding: 4, marginBottom: 14 },
  seg: { minHeight: 42, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  segOn: { backgroundColor: '#fff' },
  segTxt: { fontFamily: F.semi, fontSize: 14, color: C.sub },
});
