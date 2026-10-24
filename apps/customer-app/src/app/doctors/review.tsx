import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { confirmAppointment, isHoldGone } from '@/blynk/doctors/api';
import { bookingFor, setConfirmed } from '@/blynk/doctors/booking';
import { formatAppointmentDateTime, holdCountdownText, holdRemainingMs } from '@/blynk/doctors/format';
import { DoctorHead, errorText, FeeCard, s } from '@/blynk/doctors/ui';
import { Body, Button, Card, Fact, Notice, Page, StateView } from '@/blynk/ui/kit';
import { C, F } from '@/lib/theme';
import { DOCTOR_SCREENS as W } from '@/blynk/doctors/words';

/**
 * Step 3 of booking (Flutter DentalBookingReviewScreen): the last look before committing. The
 * countdown reads the hold's real held_until; reaching zero shows "Your hold expired" (cosmetic:
 * the server's answer to Confirm is the real gate, and 410 / 409 show the same state).
 */
export default function Review() {
  const { hold = '' } = useLocalSearchParams<{ hold: string }>();
  const booking = bookingFor(hold);
  const [now, setNow] = useState(() => new Date());
  const [busy, setBusy] = useState(false);
  const [gone, setGone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const remaining = holdRemainingMs(booking?.hold.heldUntil ?? null, now);
  const expired = !booking || gone || remaining <= 0;

  // back to the slot picker, which refreshes its times when it shows again
  const pickNewTime = () => {
    if (!booking) { router.replace('/doctors'); return; }
    router.dismissTo({ pathname: '/doctors/book/[id]', params: { id: booking.doctor.id, clinic: booking.pairing.clinicId } });
  };

  const confirm = async () => {
    if (!booking?.patient || busy || expired) return;
    setBusy(true);
    setError(null);
    const out = await confirmAppointment(booking.hold.id, booking.patient);
    setBusy(false);
    if (out.appointment) {
      setConfirmed(booking.hold.id, out.appointment);
      router.replace({ pathname: '/doctors/confirmed', params: { id: out.appointment.id, hold: booking.hold.id } });
      return;
    }
    if (isHoldGone(out.error)) { setGone(true); return; }
    setError(errorText(out.error));
  };

  if (expired || !booking?.patient) {
    return (
      <Page title={W.reviewTitle}>
        <StateView title={W.holdExpired} message={W.holdExpiredSub} action={W.pickNewTime} onAction={pickNewTime} />
      </Page>
    );
  }

  const { doctor, pairing, patient } = booking;
  const start = booking.hold.startAt;
  return (
    <Page title={W.reviewTitle} footer={<Button label={W.confirmBooking} busy={busy} onPress={() => void confirm()} />}>
      <Notice>{holdCountdownText(remaining)}</Notice>
      <Card>
        <DoctorHead name={doctor.fullName} specialty={doctor.specialty} photo={doctor.photoUrl} />
        <Text style={[s.strong, { marginTop: 14 }]}>{pairing.name}</Text>
        <Text style={s.caption}>{pairing.addressLine}</Text>
        <View style={{ marginTop: 14 }}>
          <Fact label={W.when}><Text style={{ fontFamily: F.bold, fontSize: 15, color: C.ink }}>{start ? formatAppointmentDateTime(start) : W.timeUnavailable}</Text></Fact>
        </View>
      </Card>
      <Card>
        <Fact label={W.patient}>
          <Body>{patient.name}</Body>
          <Body sub>{patient.phone}</Body>
          {!!patient.notes && <Text style={[s.caption, { marginTop: 6 }]}>{patient.notes}</Text>}
        </Fact>
      </Card>
      <FeeCard label={W.fee} note={W.feeIndicative} fee={booking.hold.consultationFeeSnapshot} />
      {!!error && <Text style={{ fontFamily: F.medium, fontSize: 13, color: C.problem, marginTop: 4 }} accessibilityRole="alert">{error}</Text>}
    </Page>
  );
}
