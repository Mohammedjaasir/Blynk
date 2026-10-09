import 'package:flutter_test/flutter_test.dart';
import 'package:ecom/Models/dental_appointment_model.dart';

import 'fixtures/dental_fixtures.dart';

void main() {
  group('appointmentStatusFromString', () {
    test('maps every canonical backend value (database/types.ts DentalAppointmentStatus)', () {
      expect(appointmentStatusFromString('HELD'), AppointmentStatus.held);
      expect(appointmentStatusFromString('EXPIRED'), AppointmentStatus.expired);
      expect(appointmentStatusFromString('CONFIRMED'), AppointmentStatus.confirmed);
      expect(appointmentStatusFromString('CANCELLED_BY_CUSTOMER'), AppointmentStatus.cancelledByCustomer);
      expect(appointmentStatusFromString('CANCELLED_BY_CLINIC'), AppointmentStatus.cancelledByClinic);
    });

    test('an unrecognised or null value never crashes - falls back to unknown', () {
      expect(appointmentStatusFromString('SOMETHING_NEW'), AppointmentStatus.unknown);
      expect(appointmentStatusFromString(null), AppointmentStatus.unknown);
    });
  });

  group('AppointmentModel - hold shape (toHoldDto)', () {
    test('parses the hold response: no doctor/clinic/patient/is_completed/can_cancel fields', () {
      final a = AppointmentModel.fromJson(holdAppointmentJson());

      expect(a.id, 'a0000001-0000-0000-0000-000000000001');
      expect(a.clinicDoctorId, 'cd0000001-0000-0000-0000-000000000001');
      expect(a.status, AppointmentStatus.held);
      expect(a.startAt, DateTime.parse('2027-06-07T03:30:00.000Z'));
      expect(a.endAt, DateTime.parse('2027-06-07T04:00:00.000Z'));
      expect(a.heldUntil, DateTime.parse('2027-06-07T03:05:00.000Z'));
      expect(a.consultationFeeSnapshot, 3500.0);
      expect(a.doctor, isNull);
      expect(a.clinic, isNull);
      expect(a.patientName, isNull);
      expect(a.isCompleted, isFalse);
      expect(a.canCancel, isFalse);
    });

    test('a NUMERIC fee snapshot arriving as a string still parses', () {
      final a = AppointmentModel.fromJson({...holdAppointmentJson(), 'consultation_fee_snapshot': '3500.00'});
      expect(a.consultationFeeSnapshot, 3500.0);
    });

    test('a null fee snapshot parses as null, not zero', () {
      final a = AppointmentModel.fromJson({...holdAppointmentJson(), 'consultation_fee_snapshot': null});
      expect(a.consultationFeeSnapshot, isNull);
    });
  });

  group('AppointmentModel - list/detail shape (toListDto/toDetailDto)', () {
    test('parses the full detail response including nested doctor/clinic and patient_notes', () {
      final a = AppointmentModel.fromJson(appointmentJson());

      expect(a.status, AppointmentStatus.confirmed);
      expect(a.patientName, 'Jane Silva');
      expect(a.patientPhone, '+94771234567');
      expect(a.patientNotes, 'Sensitive to cold water.');
      expect(a.isCompleted, isFalse);
      expect(a.canCancel, isTrue);
      expect(a.createdAt, DateTime.parse('2027-06-01T10:00:00.000Z'));

      expect(a.doctor, isNotNull);
      expect(a.doctor!.id, 'd0000001-0000-0000-0000-000000000001');
      expect(a.doctor!.fullName, 'Dr. Nadeesha Perera');
      expect(a.doctor!.specialty, 'Orthodontist');

      expect(a.clinic, isNotNull);
      expect(a.clinic!.id, 'c0000001-0000-0000-0000-000000000001');
      expect(a.clinic!.name, 'Smile Dental Clinic');
      expect(a.clinic!.city, 'Colombo');
    });

    test('a list-shaped response (detail: false) never carries patient_notes - plan §16', () {
      final json = appointmentJson(detail: false);
      expect(json.containsKey('patient_notes'), isFalse);
      final a = AppointmentModel.fromJson(json);
      expect(a.patientNotes, isNull);
    });

    test('a cancelled appointment carries its cancellation_reason', () {
      final a = AppointmentModel.fromJson(appointmentJson(
        status: 'CANCELLED_BY_CUSTOMER',
        cancellationReason: 'Change of plans',
        canCancel: false,
      ));
      expect(a.status, AppointmentStatus.cancelledByCustomer);
      expect(a.cancellationReason, 'Change of plans');
      expect(a.canCancel, isFalse);
    });

    test('tryParse rejects non-map and empty-id payloads', () {
      expect(AppointmentModel.tryParse(null), isNull);
      expect(AppointmentModel.tryParse('x'), isNull);
      expect(AppointmentModel.tryParse({'status': 'HELD'}), isNull);
    });
  });

  group('AppointmentModel.isCompletedAt (derived, injected now - plan §5.1)', () {
    test('CONFIRMED with a past start_at is completed relative to the given clock', () {
      final a = AppointmentModel.fromJson(appointmentJson(status: 'CONFIRMED', startAt: '2027-06-07T03:30:00.000Z'));
      expect(a.isCompletedAt(DateTime.parse('2027-06-07T05:00:00.000Z')), isTrue);
      expect(a.isCompletedAt(DateTime.parse('2027-06-07T03:00:00.000Z')), isFalse);
    });

    test('a HELD appointment is never "completed", however far now moves', () {
      final a = AppointmentModel.fromJson(holdAppointmentJson(startAt: '2027-06-07T03:30:00.000Z'));
      expect(a.isCompletedAt(DateTime.parse('2030-01-01T00:00:00.000Z')), isFalse);
    });
  });

  group('AppointmentModel.isHoldExpiredAt (display-only, injected now)', () {
    test('a HELD row past its held_until reads expired at the given clock', () {
      final a = AppointmentModel.fromJson(holdAppointmentJson(heldUntil: '2027-06-07T03:05:00.000Z'));
      expect(a.isHoldExpiredAt(DateTime.parse('2027-06-07T03:10:00.000Z')), isTrue);
      expect(a.isHoldExpiredAt(DateTime.parse('2027-06-07T03:00:00.000Z')), isFalse);
    });

    test('a HELD row with no held_until reads expired (fail safe for display)', () {
      final a = AppointmentModel.fromJson(holdAppointmentJson(heldUntil: null));
      expect(a.isHoldExpiredAt(DateTime.parse('2027-06-07T03:00:00.000Z')), isTrue);
    });

    test('a CONFIRMED row is never "hold expired", whatever held_until says', () {
      final a = AppointmentModel.fromJson(appointmentJson(status: 'CONFIRMED'));
      expect(a.isHoldExpiredAt(DateTime.parse('2030-01-01T00:00:00.000Z')), isFalse);
    });
  });

  group('rating (can_rate + rating)', () {
    test('a rateable visit: can_rate true, no rating yet', () {
      final a = AppointmentModel.fromJson(appointmentJson(canRate: true));
      expect(a.canRate, isTrue);
      expect(a.rating, isNull);
    });

    test('a rated visit parses stars, comment and created_at', () {
      final a = AppointmentModel.fromJson(appointmentJson(rating: ratingJson(stars: 5, comment: 'Great')));
      expect(a.canRate, isFalse);
      expect(a.rating!.stars, 5);
      expect(a.rating!.comment, 'Great');
      expect(a.rating!.createdAt, DateTime.parse('2027-06-08T10:00:00.000Z'));
    });

    test('an older backend without the fields reads as not rateable, unrated', () {
      final json = appointmentJson()
        ..remove('can_rate')
        ..remove('rating');
      final a = AppointmentModel.fromJson(json);
      expect(a.canRate, isFalse);
      expect(a.rating, isNull);
    });

    test('a null or blank comment is no comment; out-of-range stars is no rating', () {
      expect(DentalAppointmentRating.tryParse(ratingJson(comment: null))!.comment, isNull);
      expect(DentalAppointmentRating.tryParse(ratingJson(comment: '  '))!.comment, isNull);
      expect(DentalAppointmentRating.tryParse({'stars': 0}), isNull);
      expect(DentalAppointmentRating.tryParse({'stars': 6}), isNull);
      expect(DentalAppointmentRating.tryParse({'comment': 'x'}), isNull);
      expect(DentalAppointmentRating.tryParse('x'), isNull);
    });

    test('withRating keeps every other field and turns can_rate off', () {
      final a = AppointmentModel.fromJson(appointmentJson(canRate: true));
      final rated = a.withRating(const DentalAppointmentRating(stars: 3));
      expect(rated.id, a.id);
      expect(rated.status, a.status);
      expect(rated.patientName, a.patientName);
      expect(rated.canRate, isFalse);
      expect(rated.rating!.stars, 3);
    });
  });
}
