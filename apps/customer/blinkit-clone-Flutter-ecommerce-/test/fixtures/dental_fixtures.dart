/// Payloads shaped exactly like the real backend responses B2/B3 actually
/// return (see task-B2-report.md / task-B3-report.md and the DTO mappers in
/// backend/api/src/modules/dental/{clinic,doctor,appointment}.service.ts).
/// Used by the dental model tests and dental_provider_test.dart.
library;

/// `ClinicDto` (clinic.service.ts `toClinicDto`) - `GET /dental/clinics`,
/// `GET /dental/clinics/:id`.
Map<String, dynamic> clinicJson({
  String id = 'c0000001-0000-0000-0000-000000000001',
  String name = 'Smile Dental Clinic',
  String city = 'Colombo',
}) =>
    {
      'id': id,
      'name': name,
      'city': city,
      'address_line': '123 Galle Road',
      'latitude': 6.9271,
      'longitude': 79.8612,
      'contact_phone': '+94112345678',
      'operating_start_time': '09:00:00',
      'operating_end_time': '18:00:00',
    };

/// `ClinicDoctorDto` (clinic.service.ts `listClinicDoctors`) - one row of
/// `GET /dental/clinics/:id/doctors`.
Map<String, dynamic> clinicDoctorJson({
  String clinicDoctorId = 'cd0000001-0000-0000-0000-000000000001',
  String doctorId = 'd0000001-0000-0000-0000-000000000001',
  String fullName = 'Dr. Nadeesha Perera',
  String specialty = 'Orthodontist',
  num? consultationFee = 3500,
  num? ratingAverage,
  int ratingCount = 0,
}) =>
    {
      'clinic_doctor_id': clinicDoctorId,
      'doctor_id': doctorId,
      'full_name': fullName,
      'specialty': specialty,
      'photo_url': 'https://example.com/photo.jpg',
      'bio': '10 years of experience.',
      'consultation_fee': consultationFee,
      'rating_average': ratingAverage,
      'rating_count': ratingCount,
    };

/// `DoctorDto` (doctor.service.ts `getDoctorById`) - `GET /dental/doctors/:id`.
Map<String, dynamic> doctorJson({
  String id = 'd0000001-0000-0000-0000-000000000001',
  String fullName = 'Dr. Nadeesha Perera',
  String specialty = 'Orthodontist',
  List<Map<String, dynamic>>? clinics,
  num? ratingAverage,
  int ratingCount = 0,
}) =>
    {
      'id': id,
      'full_name': fullName,
      'specialty': specialty,
      'photo_url': null,
      'bio': null,
      'rating_average': ratingAverage,
      'rating_count': ratingCount,
      'clinics': clinics ??
          [
            {
              'clinic_doctor_id': 'cd0000001-0000-0000-0000-000000000001',
              'clinic_id': 'c0000001-0000-0000-0000-000000000001',
              'name': 'Smile Dental Clinic',
              'city': 'Colombo',
              'address_line': '123 Galle Road',
              'latitude': 6.9271,
              'longitude': 79.8612,
              'consultation_fee': 3500,
            },
          ],
    };

/// The `rating` block on an appointment DTO, and the `rating` half of
/// `POST /dental/appointments/:id/rating`'s response.
Map<String, dynamic> ratingJson({int stars = 4, String? comment = 'Gentle and on time.'}) => {
      'stars': stars,
      'comment': comment,
      'created_at': '2027-06-08T10:00:00.000Z',
    };

/// `toHoldDto` (appointment.service.ts) - the `appointment` block of
/// `POST /dental/appointments/holds`'s response. No `doctor`/`clinic`/
/// `patient_*`/`is_completed`/`can_cancel` - the hold DTO never includes
/// them.
Map<String, dynamic> holdAppointmentJson({
  String id = 'a0000001-0000-0000-0000-000000000001',
  String clinicDoctorId = 'cd0000001-0000-0000-0000-000000000001',
  String status = 'HELD',
  String startAt = '2027-06-07T03:30:00.000Z',
  String endAt = '2027-06-07T04:00:00.000Z',
  String? heldUntil = '2027-06-07T03:05:00.000Z',
  num? consultationFeeSnapshot = 3500,
}) =>
    {
      'id': id,
      'clinic_doctor_id': clinicDoctorId,
      'start_at': startAt,
      'end_at': endAt,
      'status': status,
      'held_until': heldUntil,
      'consultation_fee_snapshot': consultationFeeSnapshot,
    };

/// `toListDto`/`toDetailDto` (appointment.service.ts) - one row of
/// `GET /dental/appointments`, or the full body of
/// `GET /dental/appointments/:id` / confirm / cancel. `detail: true` adds
/// `patient_notes` (list responses never include it - plan §16).
Map<String, dynamic> appointmentJson({
  String id = 'a0000001-0000-0000-0000-000000000001',
  String clinicDoctorId = 'cd0000001-0000-0000-0000-000000000001',
  String status = 'CONFIRMED',
  String startAt = '2027-06-07T03:30:00.000Z',
  String endAt = '2027-06-07T04:00:00.000Z',
  String? heldUntil,
  num? consultationFeeSnapshot = 3500,
  String? patientName = 'Jane Silva',
  String? patientPhone = '+94771234567',
  String? patientNotes = 'Sensitive to cold water.',
  String? cancellationReason,
  bool isCompleted = false,
  bool canCancel = true,
  bool canRate = false,
  Map<String, dynamic>? rating,
  bool detail = true,
}) =>
    {
      'id': id,
      'clinic_doctor_id': clinicDoctorId,
      'start_at': startAt,
      'end_at': endAt,
      'status': status,
      'held_until': heldUntil,
      'consultation_fee_snapshot': consultationFeeSnapshot,
      'patient_name': patientName,
      'patient_phone': patientPhone,
      'cancellation_reason': cancellationReason,
      'is_completed': isCompleted,
      'can_cancel': canCancel,
      'can_rate': canRate,
      'rating': rating,
      'doctor': {
        'id': 'd0000001-0000-0000-0000-000000000001',
        'full_name': 'Dr. Nadeesha Perera',
        'specialty': 'ORTHODONTIST',
        'photo_url': null,
      },
      'clinic': {
        'id': 'c0000001-0000-0000-0000-000000000001',
        'name': 'Smile Dental Clinic',
        'city': 'Colombo',
        'address_line': '123 Galle Road',
      },
      'created_at': '2027-06-01T10:00:00.000Z',
      if (detail) 'patient_notes': patientNotes,
    };
