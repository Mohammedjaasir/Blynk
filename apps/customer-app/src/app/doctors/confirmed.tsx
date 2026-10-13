import { router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { ZoomIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { bookingFor, endBooking } from '@/blynk/doctors/booking';
import { formatAppointmentDateTime } from '@/blynk/doctors/format';
import { formatLkr } from '@/blynk/lib/money';
import { Badge, Button, Card } from '@/blynk/ui/kit';
import { C, F } from '@/lib/theme';

/**
 * The booking is confirmed (Flutter DentalBookingConfirmationScreen): the doctor, clinic, time
 * and the fee paid at the clinic, in person. Nothing was paid in the app.
 */
export default function Confirmed() {
  const { id = '', hold = '' } = useLocalSearchParams<{ id: string; hold: string }>();
  const insets = useSafeAreaInsets();
  const a = bookingFor(hold)?.confirmed ?? null;
  useEffect(() => () => endBooking(), []);

  // the booking steps are done: back is the clinic list, not Patient details
  const view = () => { router.dismissTo('/doctors'); router.push({ pathname: '/doctors/appointments/[id]', params: { id } }); };
  const home = () => router.dismissTo('/home');

  return (
    <View style={[st.root, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 24 }]}>
      <Animated.View entering={ZoomIn.springify().damping(12)} style={st.mark}>
        <Svg width={40} height={40} viewBox="0 0 24 24"><Path d="M5 12.5l4.2 4.2L19 7" stroke="#fff" strokeWidth={2.6} fill="none" strokeLinecap="round" strokeLinejoin="round" /></Svg>
      </Animated.View>
      <Text style={st.title} accessibilityRole="header">Appointment confirmed</Text>
      <View style={{ alignItems: 'center', marginTop: 8 }}><Badge tone="positive" label="Confirmed" /></View>
      {a && (
        <Card style={{ marginTop: 24, alignSelf: 'stretch' }}>
          {a.doctor && <Text style={st.doc}>{a.doctor.fullName}</Text>}
          {a.clinic && (
            <>
              <Text style={st.clinic}>{a.clinic.name}</Text>
              <Text style={st.sub}>{a.clinic.addressLine}</Text>
            </>
          )}
          {a.startAt && <Text style={st.when}>{formatAppointmentDateTime(a.startAt)}</Text>}
          <View style={{ flexDirection: 'row', marginTop: 14, alignItems: 'center' }}>
            <Text style={[st.sub, { flex: 1 }]}>Pay at the clinic, in person</Text>
            <Text style={a.consultationFeeSnapshot != null ? st.fee : st.sub}>
              {a.consultationFeeSnapshot != null ? formatLkr(a.consultationFeeSnapshot) : 'Not available'}
            </Text>
          </View>
        </Card>
      )}
      <View style={{ alignSelf: 'stretch', marginTop: 24, gap: 10 }}>
        <Button label="View appointment" onPress={view} />
        <Button label="Back to home" kind="secondary" onPress={home} />
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg, alignItems: 'center', paddingHorizontal: 20 },
  mark: { width: 72, height: 72, borderRadius: 36, backgroundColor: C.green, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: F.bold, fontSize: 22, color: C.ink, marginTop: 16, textAlign: 'center' },
  doc: { fontFamily: F.bold, fontSize: 16, color: C.ink, marginBottom: 10 },
  clinic: { fontFamily: F.semi, fontSize: 14, color: C.ink },
  sub: { fontFamily: F.regular, fontSize: 12.5, color: C.sub },
  when: { fontFamily: F.bold, fontSize: 15, color: C.ink, marginTop: 10 },
  fee: { fontFamily: F.bold, fontSize: 16, color: C.ink },
});
