import { useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';
import { useSession } from '@/blynk/auth/session';
import { fetchAppointment, fetchClinic, isNotFound } from '@/blynk/doctors/api';
import { appointmentBadge, formatAppointmentDateTime, showsCancel, showsRating } from '@/blynk/doctors/format';
import { CancelSection, RatingCard } from '@/blynk/doctors/sections';
import { DoctorHead, errorText, FeeCard, MapLink, s } from '@/blynk/doctors/ui';
import { Badge, Body, Card, Fact, ListSkeleton, Page, StateView, useToast } from '@/blynk/ui/kit';
import { openSignIn } from '@/blynk/ui/signIn';
import { useLoad } from '@/blynk/ui/useLoad';
import { DEMO } from '@/demo/mode';
import { C, F } from '@/lib/theme';

/**
 * One appointment (Flutter DentalAppointmentDetailScreen): status, doctor, clinic and where it is,
 * when, the fee paid at the clinic, the patient, "Rate your visit" after it, and Cancel while it
 * is confirmed.
 */
export default function AppointmentDetail() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const signedIn = !!useSession();
  const [toast, showToast] = useToast();
  const load = useLoad(async (signal) => {
    const appointment = await fetchAppointment(id, signal);
    // the clinic's place is a nice-to-have: the appointment shows without it
    const clinic = appointment.clinic?.id ? await fetchClinic(appointment.clinic.id, signal).catch(() => null) : null;
    return { appointment, clinic };
  }, [id], signedIn && !DEMO);

  let body: React.ReactNode;
  if (DEMO) body = <StateView title="Appointment" message="Appointments show here once the shop is live." />;
  else if (!signedIn) body = <StateView title="Log in to see this appointment" action="Log in / Sign up" onAction={openSignIn} />;
  else if (load.loading && !load.data) body = <ListSkeleton rows={4} h={96} />;
  else if (load.error || !load.data) {
    body = isNotFound(load.error)
      ? <StateView title="Appointment not found" message="This appointment may have been removed, or belongs to a different account." />
      : <StateView title="We couldn't load this appointment" message={errorText(load.error)} action="Try again" onAction={load.reload} />;
  } else {
    const { appointment: a, clinic } = load.data;
    const badge = appointmentBadge(a, new Date());
    const cancelled = a.status === 'CANCELLED_BY_CUSTOMER' || a.status === 'CANCELLED_BY_CLINIC';
    body = (
      <View>
        <View style={{ marginBottom: 12 }}><Badge tone={badge.tone} label={badge.label} /></View>
        <Card>
          {a.doctor && <View style={{ marginBottom: 14 }}><DoctorHead name={a.doctor.fullName} specialty={a.doctor.specialty} photo={a.doctor.photoUrl} /></View>}
          {a.clinic && (
            <View style={{ marginBottom: 14 }}>
              <Text style={s.strong}>{a.clinic.name}</Text>
              <Text style={s.caption}>{a.clinic.addressLine}</Text>
            </View>
          )}
          <Fact label="When"><Text style={{ fontFamily: F.bold, fontSize: 15, color: C.ink }}>{a.startAt ? formatAppointmentDateTime(a.startAt) : 'Time unavailable'}</Text></Fact>
          {cancelled && !!a.cancellationReason && <View style={{ marginTop: 14 }}><Fact label="Reason">{a.cancellationReason}</Fact></View>}
          {clinic && <MapLink lat={clinic.latitude} lng={clinic.longitude} label={clinic.name} />}
        </Card>
        <FeeCard label="Consultation fee" note="Indicative - payable at the clinic, in person." fee={a.consultationFeeSnapshot} />
        <Card>
          <Fact label="Patient">
            <Body>{a.patientName ?? 'Not available'}</Body>
            {!!a.patientPhone && <Body sub>{a.patientPhone}</Body>}
            {!!a.patientNotes && <Text style={[s.caption, { marginTop: 6 }]}>{a.patientNotes}</Text>}
          </Fact>
        </Card>
        {showsRating(a) && <RatingCard appointment={a} onRated={(next) => load.set({ appointment: next, clinic })} />}
        {showsCancel(a) && <CancelSection appointment={a} onChanged={load.reload} onMessage={showToast} />}
      </View>
    );
  }
  return (
    <View style={{ flex: 1 }}>
      <Page title="Appointment">{body}</Page>
      {toast}
    </View>
  );
}
