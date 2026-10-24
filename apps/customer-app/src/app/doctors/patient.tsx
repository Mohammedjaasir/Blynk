import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useSession } from '@/blynk/auth/session';
import { bookingFor, setPatient } from '@/blynk/doctors/booking';
import { localPhone, PATIENT_NAME_MAX, PATIENT_NOTES_MAX, validatePatient } from '@/blynk/doctors/format';
import { Body, Button, Field, Page, StateView } from '@/blynk/ui/kit';
import { DOCTOR_SCREENS as W } from '@/blynk/doctors/words';

/**
 * Step 2 of booking (Flutter DentalPatientDetailsScreen): who the appointment is for. Prefilled
 * from the signed-in customer, but editable: the patient may be someone else. The time is fixed
 * by the hold; nothing here can change it.
 */
export default function PatientDetails() {
  const { hold = '' } = useLocalSearchParams<{ hold: string }>();
  const booking = bookingFor(hold);
  const user = useSession()?.user;
  const [name, setName] = useState(booking?.patient?.name ?? user?.full_name ?? '');
  const [phone, setPhone] = useState(localPhone(booking?.patient?.phone ?? user?.phone));
  const [notes, setNotes] = useState(booking?.patient?.notes ?? '');
  const [errors, setErrors] = useState<{ name: string | null; phone: string | null; notes: string | null }>({ name: null, phone: null, notes: null });

  if (!booking) {
    return (
      <Page title={W.patientTitle}>
        <StateView title={W.holdExpired} message={W.holdExpiredSub} action={W.backToDoctors} onAction={() => router.replace('/doctors')} />
      </Page>
    );
  }

  const next = () => {
    const v = validatePatient({ name, phone, notes });
    setErrors(v.errors);
    if (!v.details) return;
    setPatient(hold, v.details);
    router.push({ pathname: '/doctors/review', params: { hold } });
  };

  return (
    <Page title={W.patientTitle} footer={<Button label={W.continue} onPress={next} />}>
      <Body sub>{W.whoFor}</Body>
      <Field
        label={W.patientName}
        value={name}
        onChange={(t) => { setName(t); if (errors.name) setErrors({ ...errors, name: null }); }}
        autoCapitalize="words"
        autoComplete="name"
        maxLength={PATIENT_NAME_MAX}
        error={errors.name}
      />
      <Field
        label={W.patientPhone}
        value={phone}
        onChange={(t) => { setPhone(t); if (errors.phone) setErrors({ ...errors, phone: null }); }}
        prefix="+94"
        placeholder="07XXXXXXXX"
        keyboardType="phone-pad"
        maxLength={16}
        error={errors.phone}
      />
      <Field
        label={W.notesLabel}
        value={notes}
        onChange={(t) => { setNotes(t); if (errors.notes) setErrors({ ...errors, notes: null }); }}
        placeholder={W.notesPlaceholder}
        multiline
        maxLength={PATIENT_NOTES_MAX}
        error={errors.notes}
        autoCapitalize="sentences"
      />
    </Page>
  );
}
