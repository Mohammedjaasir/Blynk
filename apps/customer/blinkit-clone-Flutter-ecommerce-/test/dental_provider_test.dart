import 'package:flutter_test/flutter_test.dart';

import 'package:ecom/Models/dental_appointment_model.dart';
import 'package:ecom/Services/Exceptions/api_exception.dart';
import 'package:ecom/Services/Providers/dental.provider.dart';

import 'fixtures/dental_fixtures.dart';

/// A fake `DentalRequest`, keyed by `method url` (order_provider_test.dart's
/// `_FakeOrdersApi` pattern). Every call is recorded (with its query/body)
/// so a test can assert exactly what was sent, not just what came back.
class _FakeDentalApi {
  final calls = <Map<String, dynamic>>[];
  final Map<String, Object Function(Map<String, dynamic>? query, Object? body)> routes = {};

  Future<dynamic> call(String method, String url, {Object? body, Map<String, dynamic>? query}) async {
    final key = '$method $url';
    calls.add({'key': key, 'query': query, 'body': body});
    final r = routes[key];
    if (r == null) throw ApiException(404, 'No route registered for $key.', code: 'NOT_FOUND');
    final v = r(query, body);
    if (v is ApiException) throw v;
    return v;
  }
}

Map<String, dynamic> _envelope(Object? data) => {'success': true, 'data': data};

void main() {
  late _FakeDentalApi api;
  late DentalProvider provider;

  setUp(() {
    api = _FakeDentalApi();
    provider = DentalProvider(request: api.call, clock: () => DateTime.utc(2027, 6, 7, 3, 0, 0));
  });

  group('now (injected clock)', () {
    test('never reads the real system clock - always the injected one', () {
      expect(provider.now, DateTime.utc(2027, 6, 7, 3, 0, 0));
    });
  });

  group('fetchClinics', () {
    test('parses the list and sends city/search/page/limit as query params', () async {
      api.routes['GET /dental/clinics'] = (query, body) => _envelope({
            'clinics': [clinicJson(id: 'c1'), clinicJson(id: 'c2')],
            'pagination': {'page': 1, 'limit': 20, 'total': 2, 'total_pages': 1},
          });

      final clinics = await provider.fetchClinics(city: 'Colombo', search: 'Smile');

      expect(clinics.map((c) => c.id), ['c1', 'c2']);
      final sentQuery = api.calls.single['query'] as Map;
      expect(sentQuery['city'], 'Colombo');
      expect(sentQuery['search'], 'Smile');
      expect(sentQuery['page'], '1');
      expect(sentQuery['limit'], '20');
    });

    test('omits city/search from the query when not given', () async {
      api.routes['GET /dental/clinics'] = (query, body) => _envelope({'clinics': []});
      await provider.fetchClinics();
      final sentQuery = api.calls.single['query'] as Map;
      expect(sentQuery.containsKey('city'), isFalse);
      expect(sentQuery.containsKey('search'), isFalse);
    });

    test('skips a malformed row rather than throwing', () async {
      api.routes['GET /dental/clinics'] = (query, body) => _envelope({
            'clinics': [clinicJson(id: 'c1'), 'junk', null],
          });
      final clinics = await provider.fetchClinics();
      expect(clinics, hasLength(1));
    });
  });

  group('fetchClinicDetail', () {
    test('returns the parsed clinic', () async {
      api.routes['GET /dental/clinics/c1'] = (query, body) => _envelope({'clinic': clinicJson(id: 'c1')});
      final clinic = await provider.fetchClinicDetail('c1');
      expect(clinic.id, 'c1');
    });

    test('a 404 CLINIC_NOT_FOUND propagates as ApiException', () async {
      api.routes['GET /dental/clinics/missing'] =
          (q, b) => ApiException(404, 'Clinic not found.', code: 'CLINIC_NOT_FOUND');
      await expectLater(
        provider.fetchClinicDetail('missing'),
        throwsA(isA<ApiException>().having((e) => e.code, 'code', 'CLINIC_NOT_FOUND')),
      );
    });
  });

  group('fetchClinicDoctors', () {
    test('returns the parsed clinic-doctor rows', () async {
      api.routes['GET /dental/clinics/c1/doctors'] = (q, b) => _envelope({
            'doctors': [clinicDoctorJson(clinicDoctorId: 'cd1'), clinicDoctorJson(clinicDoctorId: 'cd2')],
          });
      final doctors = await provider.fetchClinicDoctors('c1');
      expect(doctors.map((d) => d.clinicDoctorId), ['cd1', 'cd2']);
    });
  });

  group('fetchDoctorDetail', () {
    test('returns the parsed doctor, including embedded clinics', () async {
      api.routes['GET /dental/doctors/d1'] = (q, b) => _envelope({'doctor': doctorJson(id: 'd1')});
      final doctor = await provider.fetchDoctorDetail('d1');
      expect(doctor.id, 'd1');
      expect(doctor.clinics, isNotEmpty);
    });

    test('a 404 DOCTOR_NOT_FOUND propagates as ApiException', () async {
      api.routes['GET /dental/doctors/missing'] =
          (q, b) => ApiException(404, 'Doctor not found.', code: 'DOCTOR_NOT_FOUND');
      await expectLater(
        provider.fetchDoctorDetail('missing'),
        throwsA(isA<ApiException>().having((e) => e.code, 'code', 'DOCTOR_NOT_FOUND')),
      );
    });
  });

  group('fetchDoctorAvailability', () {
    test('parses the camelCase DayAvailabilityResult shape and sends plain calendar dates', () async {
      api.routes['GET /dental/doctors/d1/availability'] = (query, body) => _envelope({
            'availability': [
              {'date': '2027-06-07', 'hasAvailability': true},
              {'date': '2027-06-08', 'hasAvailability': false},
            ],
          });

      final result = await provider.fetchDoctorAvailability(
        doctorId: 'd1',
        clinicId: 'c1',
        from: DateTime.utc(2027, 6, 7),
        to: DateTime.utc(2027, 6, 14),
      );

      expect(result, hasLength(2));
      expect(result[0].date, '2027-06-07');
      expect(result[0].hasAvailability, isTrue);
      expect(result[1].hasAvailability, isFalse);

      final sentQuery = api.calls.single['query'] as Map;
      expect(sentQuery['clinic_id'], 'c1');
      expect(sentQuery['from'], '2027-06-07');
      expect(sentQuery['to'], '2027-06-14');
    });

    test('the date sent uses the DateTime\'s own calendar fields, not a UTC re-conversion', () async {
      api.routes['GET /dental/doctors/d1/availability'] = (query, body) => _envelope({'availability': []});
      // A local-feeling date with an hour component: only y/m/d must be sent.
      await provider.fetchDoctorAvailability(
        doctorId: 'd1',
        clinicId: 'c1',
        from: DateTime(2027, 6, 7, 23, 30),
        to: DateTime(2027, 6, 7, 23, 45),
      );
      final sentQuery = api.calls.single['query'] as Map;
      expect(sentQuery['from'], '2027-06-07');
      expect(sentQuery['to'], '2027-06-07');
    });
  });

  group('fetchDoctorSlots', () {
    test('parses the raw ISO instant list, already-filtered by the server', () async {
      api.routes['GET /dental/doctors/d1/slots'] = (query, body) => _envelope({
            'date': '2027-06-07',
            'slots': ['2027-06-07T03:30:00Z', '2027-06-07T04:10:00Z'],
            'blockedReason': null,
          });

      final slots = await provider.fetchDoctorSlots(doctorId: 'd1', clinicId: 'c1', date: DateTime.utc(2027, 6, 7));

      expect(slots, [DateTime.parse('2027-06-07T03:30:00Z'), DateTime.parse('2027-06-07T04:10:00Z')]);
      final sentQuery = api.calls.single['query'] as Map;
      expect(sentQuery['clinic_id'], 'c1');
      expect(sentQuery['date'], '2027-06-07');
    });

    test('an empty (blocked or elapsed) day parses as an empty list, not an error', () async {
      api.routes['GET /dental/doctors/d1/slots'] =
          (q, b) => _envelope({'date': '2027-06-07', 'slots': [], 'blockedReason': 'Public holiday'});
      final slots = await provider.fetchDoctorSlots(doctorId: 'd1', clinicId: 'c1', date: DateTime.utc(2027, 6, 7));
      expect(slots, isEmpty);
    });
  });

  group('holdSlot', () {
    test('a 201 create is ok and not a replay; start_at is sent as a UTC ISO instant with an offset', () async {
      api.routes['POST /dental/appointments/holds'] = (query, body) {
        final b = body as Map;
        expect(b['clinic_doctor_id'], 'cd1');
        expect(b['start_at'], '2027-06-07T03:30:00.000Z');
        expect(b.containsKey('idempotency_key'), isFalse);
        return _envelope({'appointment': holdAppointmentJson(), 'is_idempotent_replay': false});
      };

      final outcome = await provider.holdSlot(clinicDoctorId: 'cd1', startAt: DateTime.utc(2027, 6, 7, 3, 30));

      expect(outcome.ok, isTrue);
      expect(outcome.isIdempotentReplay, isFalse);
      expect(outcome.appointment!.status, AppointmentStatus.held);
    });

    test('a 200 idempotent replay is still ok, flagged as a replay', () async {
      api.routes['POST /dental/appointments/holds'] =
          (q, b) => _envelope({'appointment': holdAppointmentJson(), 'is_idempotent_replay': true});
      final outcome = await provider.holdSlot(clinicDoctorId: 'cd1', startAt: DateTime.utc(2027, 6, 7, 3, 30));
      expect(outcome.ok, isTrue);
      expect(outcome.isIdempotentReplay, isTrue);
    });

    test('an idempotency key, when given, is sent on the body', () async {
      api.routes['POST /dental/appointments/holds'] = (query, body) {
        expect((body as Map)['idempotency_key'], 'my-key-1');
        return _envelope({'appointment': holdAppointmentJson(), 'is_idempotent_replay': false});
      };
      await provider.holdSlot(clinicDoctorId: 'cd1', startAt: DateTime.utc(2027, 6, 7, 3, 30), idempotencyKey: 'my-key-1');
    });

    test('409 SLOT_HELD is a distinguishable slot conflict, never a generic error', () async {
      api.routes['POST /dental/appointments/holds'] =
          (q, b) => ApiException(409, 'Someone else is holding this slot right now.', code: 'SLOT_HELD');
      final outcome = await provider.holdSlot(clinicDoctorId: 'cd1', startAt: DateTime.utc(2027, 6, 7, 3, 30));
      expect(outcome.ok, isFalse);
      expect(outcome.isSlotConflict, isTrue);
      expect(outcome.isSlotInPast, isFalse);
    });

    test('409 SLOT_UNAVAILABLE is also a slot conflict', () async {
      api.routes['POST /dental/appointments/holds'] =
          (q, b) => ApiException(409, 'This time slot is no longer available.', code: 'SLOT_UNAVAILABLE');
      final outcome = await provider.holdSlot(clinicDoctorId: 'cd1', startAt: DateTime.utc(2027, 6, 7, 3, 30));
      expect(outcome.isSlotConflict, isTrue);
    });

    test('422 SLOT_IN_PAST is distinguishable from a slot conflict (B3 fix round I1)', () async {
      api.routes['POST /dental/appointments/holds'] =
          (q, b) => ApiException(422, 'That appointment time has already passed.', code: 'SLOT_IN_PAST');
      final outcome = await provider.holdSlot(clinicDoctorId: 'cd1', startAt: DateTime.utc(2020, 1, 1));
      expect(outcome.ok, isFalse);
      expect(outcome.isSlotInPast, isTrue);
      expect(outcome.isSlotConflict, isFalse);
    });

    test('a 404 CLINIC_DOCTOR_NOT_FOUND is neither a conflict nor "in past" - a bare error', () async {
      api.routes['POST /dental/appointments/holds'] =
          (q, b) => ApiException(404, 'This doctor is not currently bookable at this clinic.', code: 'CLINIC_DOCTOR_NOT_FOUND');
      final outcome = await provider.holdSlot(clinicDoctorId: 'cd1', startAt: DateTime.utc(2027, 6, 7, 3, 30));
      expect(outcome.ok, isFalse);
      expect(outcome.isSlotConflict, isFalse);
      expect(outcome.isSlotInPast, isFalse);
      expect(outcome.error!.code, 'CLINIC_DOCTOR_NOT_FOUND');
    });
  });

  group('confirmAppointment', () {
    test('success returns the confirmed appointment', () async {
      api.routes['POST /dental/appointments/a1/confirm'] = (query, body) {
        final b = body as Map;
        expect(b['patient_name'], 'Jane Silva');
        expect(b['patient_phone'], '+94771234567');
        expect(b.containsKey('patient_notes'), isFalse);
        return _envelope({'appointment': appointmentJson(status: 'CONFIRMED')});
      };

      final outcome = await provider.confirmAppointment(id: 'a1', patientName: 'Jane Silva', patientPhone: '+94771234567');

      expect(outcome.ok, isTrue);
      expect(outcome.appointment!.status, AppointmentStatus.confirmed);
    });

    test('a non-empty patientNotes is sent, a blank one is omitted', () async {
      api.routes['POST /dental/appointments/a1/confirm'] = (query, body) {
        expect((body as Map)['patient_notes'], 'Please call before arrival');
        return _envelope({'appointment': appointmentJson()});
      };
      await provider.confirmAppointment(
        id: 'a1',
        patientName: 'Jane Silva',
        patientPhone: '+94771234567',
        patientNotes: 'Please call before arrival',
      );
    });

    test('410 HOLD_EXPIRED is distinguishable, never a generic error', () async {
      api.routes['POST /dental/appointments/a1/confirm'] =
          (q, b) => ApiException(410, 'Your hold on this slot has expired. Please pick the time again.', code: 'HOLD_EXPIRED');
      final outcome = await provider.confirmAppointment(id: 'a1', patientName: 'Jane Silva', patientPhone: '+94771234567');
      expect(outcome.ok, isFalse);
      expect(outcome.isHoldExpired, isTrue);
      expect(outcome.isNotHeld, isFalse);
    });

    test('409 APPOINTMENT_NOT_HELD is distinguishable from HOLD_EXPIRED', () async {
      api.routes['POST /dental/appointments/a1/confirm'] =
          (q, b) => ApiException(409, 'This appointment is not on hold.', code: 'APPOINTMENT_NOT_HELD');
      final outcome = await provider.confirmAppointment(id: 'a1', patientName: 'Jane Silva', patientPhone: '+94771234567');
      expect(outcome.ok, isFalse);
      expect(outcome.isNotHeld, isTrue);
      expect(outcome.isHoldExpired, isFalse);
    });
  });

  group('fetchMyAppointments', () {
    test('parses the list and sends bucket/status/page/limit as query params', () async {
      api.routes['GET /dental/appointments'] = (query, body) => _envelope({
            'appointments': [appointmentJson(id: 'a1', detail: false), appointmentJson(id: 'a2', detail: false)],
            'pagination': {'page': 1, 'limit': 20, 'total': 2, 'total_pages': 1},
          });

      final appointments = await provider.fetchMyAppointments(bucket: 'upcoming', status: 'CONFIRMED');

      expect(appointments.map((a) => a.id), ['a1', 'a2']);
      final sentQuery = api.calls.single['query'] as Map;
      expect(sentQuery['bucket'], 'upcoming');
      expect(sentQuery['status'], 'CONFIRMED');
    });

    test('list rows never carry patient_notes (plan §16)', () async {
      api.routes['GET /dental/appointments'] =
          (q, b) => _envelope({'appointments': [appointmentJson(id: 'a1', detail: false)]});
      final appointments = await provider.fetchMyAppointments();
      expect(appointments.single.patientNotes, isNull);
    });
  });

  group('fetchAppointmentDetail', () {
    test('returns the parsed appointment, including patient_notes', () async {
      api.routes['GET /dental/appointments/a1'] = (q, b) => _envelope({'appointment': appointmentJson(id: 'a1')});
      final a = await provider.fetchAppointmentDetail('a1');
      expect(a.id, 'a1');
      expect(a.patientNotes, isNotNull);
    });

    test('a 404 APPOINTMENT_NOT_FOUND propagates as ApiException (same body for missing or not-mine)', () async {
      api.routes['GET /dental/appointments/missing'] =
          (q, b) => ApiException(404, 'Appointment not found.', code: 'APPOINTMENT_NOT_FOUND');
      await expectLater(
        provider.fetchAppointmentDetail('missing'),
        throwsA(isA<ApiException>().having((e) => e.code, 'code', 'APPOINTMENT_NOT_FOUND')),
      );
    });
  });

  group('cancelAppointment', () {
    test('success returns the cancelled appointment', () async {
      api.routes['POST /dental/appointments/a1/cancel'] = (query, body) {
        expect((body as Map)['reason'], 'Change of plans');
        return _envelope({
          'appointment': appointmentJson(status: 'CANCELLED_BY_CUSTOMER', cancellationReason: 'Change of plans', canCancel: false),
        });
      };
      final outcome = await provider.cancelAppointment(id: 'a1', reason: 'Change of plans');
      expect(outcome.ok, isTrue);
      expect(outcome.appointment!.status, AppointmentStatus.cancelledByCustomer);
    });

    test('a blank reason is sent as no body at all', () async {
      api.routes['POST /dental/appointments/a1/cancel'] = (query, body) {
        expect(body, isNull);
        return _envelope({'appointment': appointmentJson(status: 'CANCELLED_BY_CUSTOMER')});
      };
      await provider.cancelAppointment(id: 'a1', reason: '   ');
    });

    test('a 422 APPOINTMENT_NOT_CONFIRMED refusal never throws - it is a typed outcome', () async {
      api.routes['POST /dental/appointments/a1/cancel'] =
          (q, b) => ApiException(422, 'Only a confirmed appointment can be cancelled.', code: 'APPOINTMENT_NOT_CONFIRMED');
      final outcome = await provider.cancelAppointment(id: 'a1');
      expect(outcome.ok, isFalse);
      expect(outcome.isRefusal, isTrue);
    });

    test('a 409 APPOINTMENT_ALREADY_CANCELLED is also a refusal', () async {
      api.routes['POST /dental/appointments/a1/cancel'] =
          (q, b) => ApiException(409, 'This appointment is already cancelled.', code: 'APPOINTMENT_ALREADY_CANCELLED');
      final outcome = await provider.cancelAppointment(id: 'a1');
      expect(outcome.isRefusal, isTrue);
    });

    test('a timeout (408) is not ok and not a refusal', () async {
      api.routes['POST /dental/appointments/a1/cancel'] =
          (q, b) => ApiException(408, 'Connection timed out.', code: 'TIMEOUT');
      final outcome = await provider.cancelAppointment(id: 'a1');
      expect(outcome.ok, isFalse);
      expect(outcome.isRefusal, isFalse);
    });
  });

  group('rateAppointment', () {
    test('posts stars + trimmed comment; success returns the rating and the rated appointment', () async {
      api.routes['POST /dental/appointments/a1/rating'] = (query, body) => _envelope({
            'rating': ratingJson(stars: 4, comment: 'Gentle and on time.'),
            'appointment': appointmentJson(id: 'a1', rating: ratingJson(stars: 4, comment: 'Gentle and on time.')),
          });

      final outcome = await provider.rateAppointment(id: 'a1', stars: 4, comment: '  Gentle and on time.  ');

      expect(api.calls.single['body'], {'stars': 4, 'comment': 'Gentle and on time.'});
      expect(outcome.ok, isTrue);
      expect(outcome.rating!.stars, 4);
      expect(outcome.appointment!.id, 'a1');
      expect(outcome.appointment!.canRate, isFalse);
      expect(outcome.appointment!.rating!.comment, 'Gentle and on time.');
    });

    test('a blank comment is not sent at all', () async {
      api.routes['POST /dental/appointments/a1/rating'] =
          (query, body) => _envelope({'rating': ratingJson(stars: 2, comment: null)});
      final outcome = await provider.rateAppointment(id: 'a1', stars: 2, comment: '   ');
      expect(api.calls.single['body'], {'stars': 2});
      expect(outcome.ok, isTrue);
      expect(outcome.appointment, isNull);
    });

    test('409 ALREADY_RATED never throws: a typed refusal carrying the server message', () async {
      api.routes['POST /dental/appointments/a1/rating'] =
          (q, b) => ApiException(409, 'You have already rated this visit.', code: 'ALREADY_RATED');
      final outcome = await provider.rateAppointment(id: 'a1', stars: 5);
      expect(outcome.ok, isFalse);
      expect(outcome.isRefusal, isTrue);
      expect(outcome.isAlreadyRated, isTrue);
      expect(outcome.error!.message, 'You have already rated this visit.');
    });

    test('422 VISIT_NOT_FINISHED is a refusal, not already-rated', () async {
      api.routes['POST /dental/appointments/a1/rating'] =
          (q, b) => ApiException(422, 'You can rate this visit once it is over.', code: 'VISIT_NOT_FINISHED');
      final outcome = await provider.rateAppointment(id: 'a1', stars: 5);
      expect(outcome.isRefusal, isTrue);
      expect(outcome.isAlreadyRated, isFalse);
    });

    test('a timeout is not ok and not a refusal', () async {
      api.routes['POST /dental/appointments/a1/rating'] =
          (q, b) => ApiException(408, 'Connection timed out.', code: 'TIMEOUT');
      final outcome = await provider.rateAppointment(id: 'a1', stars: 5);
      expect(outcome.ok, isFalse);
      expect(outcome.isRefusal, isFalse);
    });

    test('a success body without a rating is reported as an error, never a silent success', () async {
      api.routes['POST /dental/appointments/a1/rating'] = (q, b) => _envelope({'rating': null});
      final outcome = await provider.rateAppointment(id: 'a1', stars: 5);
      expect(outcome.ok, isFalse);
      expect(outcome.error!.statusCode, 500);
    });
  });
}
