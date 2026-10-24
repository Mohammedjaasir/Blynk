import { router, useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';
import { fetchDoctor } from '@/blynk/doctors/api';
import { DoctorsGate } from '@/blynk/doctors/Gate';
import { pairingFor } from '@/blynk/doctors/types';
import { DoctorHead, FeeCard, LoadFailure } from '@/blynk/doctors/ui';
import { Body, Button, Card, ListSkeleton, Page, SectionTitle } from '@/blynk/ui/kit';
import { useLoad } from '@/blynk/ui/useLoad';
import { DOCTOR_SCREENS as W } from '@/blynk/doctors/words';

/**
 * A doctor at one clinic (Flutter DentalDoctorProfileScreen): photo, specialty, rating, About,
 * and the consultation fee at THIS clinic (paid there, in person). "Book appointment" opens the
 * slot picker for the same doctor and clinic.
 */
export default function DoctorScreen() {
  const { id = '', clinic = '' } = useLocalSearchParams<{ id: string; clinic: string }>();
  return <DoctorsGate><DoctorProfile id={id} clinicId={clinic} /></DoctorsGate>;
}

function DoctorProfile({ id, clinicId }: { id: string; clinicId: string }) {
  const load = useLoad((signal) => fetchDoctor(id, signal), [id]);
  const doctor = load.data;
  const pairing = pairingFor(doctor, clinicId);
  const canBook = !load.loading && !load.error && !!doctor;

  return (
    <Page
      title={doctor?.fullName || W.doctor}
      footer={canBook ? (
        <Button label={W.bookAppointment} onPress={() => router.push({ pathname: '/doctors/book/[id]', params: { id, clinic: clinicId } })} />
      ) : undefined}
    >
      {load.loading && !doctor ? (
        <ListSkeleton rows={3} h={90} />
      ) : load.error || !doctor ? (
        <LoadFailure
          error={load.error}
          title={W.doctorFailed}
          notFound={{ title: W.doctorNotFound, message: W.doctorNotFoundSub }}
          onRetry={load.reload}
        />
      ) : (
        <View>
          <Card>
            <DoctorHead name={doctor.fullName} specialty={doctor.specialty} photo={doctor.photoUrl} average={doctor.ratingAverage} count={doctor.ratingCount} size={72} />
          </Card>
          {!!doctor.bio?.trim() && (
            <View style={{ marginTop: 10, marginBottom: 12 }}>
              <SectionTitle>{W.about}</SectionTitle>
              <Body>{doctor.bio.trim()}</Body>
            </View>
          )}
          <FeeCard label={W.feeAtClinic} note={W.payAtClinic} fee={pairing?.consultationFee ?? null} />
        </View>
      )}
    </Page>
  );
}
