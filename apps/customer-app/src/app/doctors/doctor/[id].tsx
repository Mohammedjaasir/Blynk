import { router, useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';
import { fetchDoctor } from '@/blynk/doctors/api';
import { DoctorsGate } from '@/blynk/doctors/Gate';
import { pairingFor } from '@/blynk/doctors/types';
import { DoctorHead, FeeCard, LoadFailure } from '@/blynk/doctors/ui';
import { Body, Button, Card, ListSkeleton, Page, SectionTitle } from '@/blynk/ui/kit';
import { useLoad } from '@/blynk/ui/useLoad';

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
      title={doctor?.fullName || 'Doctor'}
      footer={canBook ? (
        <Button label="Book appointment" onPress={() => router.push({ pathname: '/doctors/book/[id]', params: { id, clinic: clinicId } })} />
      ) : undefined}
    >
      {load.loading && !doctor ? (
        <ListSkeleton rows={3} h={90} />
      ) : load.error || !doctor ? (
        <LoadFailure
          error={load.error}
          title="We couldn't load this doctor"
          notFound={{ title: 'Doctor not found', message: 'This profile may have been removed or is no longer listed.' }}
          onRetry={load.reload}
        />
      ) : (
        <View>
          <Card>
            <DoctorHead name={doctor.fullName} specialty={doctor.specialty} photo={doctor.photoUrl} average={doctor.ratingAverage} count={doctor.ratingCount} size={72} />
          </Card>
          {!!doctor.bio?.trim() && (
            <View style={{ marginTop: 10, marginBottom: 12 }}>
              <SectionTitle>About</SectionTitle>
              <Body>{doctor.bio.trim()}</Body>
            </View>
          )}
          <FeeCard label="Consultation fee at this clinic" note="Payable at the clinic, in person" fee={pairing?.consultationFee ?? null} />
        </View>
      )}
    </Page>
  );
}
