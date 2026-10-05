import 'package:flutter/material.dart';

import 'package:ecom/Infrastructure/HttpMethods/requesting_methods.dart';
import 'package:ecom/Models/dental_appointment_model.dart';
import 'package:ecom/Models/dental_clinic_model.dart';
import 'package:ecom/Models/dental_doctor_model.dart';
import 'package:ecom/Services/Exceptions/api_exception.dart';

/// A request against the dental API. Defaults to the app's single
/// ApiService; injectable only so tests can replay captured real backend
/// JSON (and errors) - order.provider.dart's `OrderRequest` pattern.
typedef DentalRequest = Future<dynamic> Function(
  String method,
  String url, {
  Object? body,
  Map<String, dynamic>? query,
});

Future<dynamic> _apiRequest(
  String method,
  String url, {
  Object? body,
  Map<String, dynamic>? query,
}) {
  return ApiService.requestMethods(
    methodType: method,
    url: url,
    body: body,
    queryParameters: query,
  );
}

/// One row of `GET /dental/doctors/:id/availability`'s `availability` array
/// (`availability.service.ts DayAvailabilityResult`, task-B2-report.md /
/// task-B3-report.md §12). NOTE the backend returns this one specific shape
/// as plain JS object keys (`date`, `hasAvailability`) rather than going
/// through a snake_case DTO mapper like every other dental endpoint - see
/// `availability.service.ts` lines 36-39, returned unmapped by
/// `doctor.service.ts getDoctorAvailability` straight to
/// `res.json({ data: { availability } })`. Confirmed by reading the actual
/// interface + controller, not assumed.
class DateAvailability {
  final String date;
  final bool hasAvailability;

  const DateAvailability({required this.date, required this.hasAvailability});

  static DateAvailability? tryParse(Object? json) {
    if (json is! Map) return null;
    final map = json.cast<String, dynamic>();
    final date = (map['date'] ?? '').toString();
    if (date.isEmpty) return null;
    return DateAvailability(date: date, hasAvailability: map['hasAvailability'] == true);
  }
}

/// The result of a `holdSlot` attempt. Mirrors `order.provider.dart`'s
/// `CancelOutcome`: a real backend refusal (someone else has the slot, or
/// the time has already passed) is not thrown as a generic exception - it is
/// returned here as a distinguishable outcome the calling screen branches
/// on, per the brief's explicit instruction to surface `409`/`422` this way.
class HoldOutcome {
  const HoldOutcome({this.appointment, this.error, this.isIdempotentReplay = false});

  final AppointmentModel? appointment;
  final ApiException? error;

  /// `201` on a brand-new hold, `200` on an idempotent replay of the same
  /// request (task-B3-report.md §3: "201 on create, 200 on idempotent
  /// replay - not a uniform 200"). Both are success; this only tells the
  /// two apart for a caller that cares.
  final bool isIdempotentReplay;

  bool get ok => appointment != null;

  /// `409 SLOT_HELD` (someone else is holding it right now) or
  /// `409 SLOT_UNAVAILABLE` (already `CONFIRMED`, or lost the race at the
  /// unique-index backstop) - task-B3-report.md §3/§4. Retry with a
  /// DIFFERENT slot; the backend never re-derives availability for the same
  /// instant differently on a second try.
  bool get isSlotConflict => error?.code == 'SLOT_HELD' || error?.code == 'SLOT_UNAVAILABLE';

  /// `422 SLOT_IN_PAST` (task-B3-report.md §12): the requested `start_at`
  /// had already elapsed by the time the request reached the server. Unlike
  /// a conflict, retrying the SAME slot can never succeed - the caller must
  /// go back and pick a different time.
  bool get isSlotInPast => error?.code == 'SLOT_IN_PAST';
}

/// The result of a `confirmAppointment` attempt. Mirrors `CancelOutcome`'s
/// refusal-vs-error split, per the brief's explicit instruction, so F3 can
/// show a specific message for each of the two distinguishable 4xx outcomes
/// confirm can return (task-B3-report.md §3/§12).
class ConfirmOutcome {
  const ConfirmOutcome({this.appointment, this.error});

  final AppointmentModel? appointment;
  final ApiException? error;

  bool get ok => appointment != null;

  /// `410 HOLD_EXPIRED`: the five-minute hold ran out before confirm was
  /// submitted. The row is left `HELD` (task-B3-report.md §3) - the caller
  /// should route back to slot selection, not retry confirm on this id.
  bool get isHoldExpired => error?.code == 'HOLD_EXPIRED';

  /// `409 APPOINTMENT_NOT_HELD`: the row is no longer `HELD` by the time
  /// confirm ran (already confirmed, cancelled, or expired) - e.g. a
  /// double-submit race (task-B3-report.md concurrency test 6).
  bool get isNotHeld => error?.code == 'APPOINTMENT_NOT_HELD';
}

/// The result of a `cancelAppointment` attempt - `order.provider.dart`'s
/// `CancelOutcome`, renamed for this domain (an `OrderModel`-typed
/// `CancelOutcome` already exists and is not reused across domains).
class AppointmentCancelOutcome {
  const AppointmentCancelOutcome({this.appointment, this.error});

  final AppointmentModel? appointment;
  final ApiException? error;

  bool get ok => appointment != null;

  /// A `4xx` the backend returned deliberately (already cancelled, not
  /// confirmed, expired, not found) - not a timeout (408 is excluded, same
  /// as `CancelOutcome.isRefusal`).
  bool get isRefusal =>
      error != null && error!.statusCode >= 400 && error!.statusCode < 500 && error!.statusCode != 408;
}

/// The result of a `rateAppointment` attempt - the same refusal-vs-error
/// split as [AppointmentCancelOutcome]. On success [appointment] is the
/// backend's updated detail DTO (`can_rate: false`, `rating` set), which the
/// calling screen swaps in for the row it is showing.
class RatingOutcome {
  const RatingOutcome({this.rating, this.appointment, this.error});

  final DentalAppointmentRating? rating;
  final AppointmentModel? appointment;
  final ApiException? error;

  bool get ok => rating != null && error == null;

  /// `409 ALREADY_RATED`: a rating already exists (e.g. sent from another
  /// device) - the caller should refetch to show it.
  bool get isAlreadyRated => error?.code == 'ALREADY_RATED';

  /// A `4xx` the backend returned deliberately (`404 APPOINTMENT_NOT_FOUND`,
  /// `422 APPOINTMENT_NOT_RATEABLE`, `422 VISIT_NOT_FINISHED`,
  /// `409 ALREADY_RATED`, `400 VALIDATION_ERROR`) - not a timeout.
  bool get isRefusal =>
      error != null && error!.statusCode >= 400 && error!.statusCode < 500 && error!.statusCode != 408;
}

/// Covers B2's read-only discovery/availability endpoints and B3's booking
/// lifecycle endpoints (task-B2-report.md, task-B3-report.md). Follows
/// `order.provider.dart`'s exact shape: injectable request function,
/// injectable clock, typed outcome classes for expected-4xx domain refusals
/// vs. a thrown `ApiException` for a real/unexpected error. No business
/// logic here duplicates what the backend already decided - availability is
/// never client-trusted (common.md rule 8): every fetch re-queries the
/// server, and `/slots`/`/availability` must be re-fetched rather than
/// cached across a long-lived screen (task-B3-report.md §12.5) because an
/// elapsed time legitimately drops out of the list between two calls.
class DentalProvider extends ChangeNotifier {
  DentalProvider({DentalRequest? request, DateTime Function()? clock})
      : _request = request ?? _apiRequest,
        _clock = clock ?? DateTime.now;

  final DentalRequest _request;
  final DateTime Function() _clock;

  /// Exposed so a display-only "is this hold expired" check (see
  /// `AppointmentModel.isHoldExpiredAt`) can use the same injected clock a
  /// test controls, rather than a screen calling `DateTime.now()` itself.
  DateTime get now => _clock();

  ApiException _toApiException(Object e) => e is ApiException ? e : ApiService.handleError(e);

  /// A plain clinic-local calendar date (YYYY-MM-DD), per
  /// `dental.schema.ts`'s `dateOnlySchema` doc comment: "the clinic-local
  /// date the customer is browsing, not a UTC instant". Only the calendar
  /// components of [d] are used - no timezone conversion is applied here,
  /// deliberately: the caller passes the date the customer picked (e.g. from
  /// a date picker), and re-interpreting it through UTC could shift it to a
  /// different calendar day depending on the device's offset.
  static String _dateOnly(DateTime d) =>
      '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

  // --------------------------------------------------------------------
  // DISCOVERY (B2, read-only)
  // --------------------------------------------------------------------

  /// `GET /dental/clinics?city=&search=&page=&limit=`
  /// (task-B2-report.md; `clinic.service.ts listClinics`).
  Future<List<ClinicModel>> fetchClinics({String? city, String? search, int page = 1, int limit = 20}) async {
    try {
      final response = await _request(
        'GET',
        '/dental/clinics',
        query: {
          if (city != null && city.trim().isNotEmpty) 'city': city.trim(),
          if (search != null && search.trim().isNotEmpty) 'search': search.trim(),
          'page': '$page',
          'limit': '$limit',
        },
      );
      final data = (response is Map ? response['data'] : null) as Map?;
      final raw = (data?['clinics'] as List?) ?? const [];
      return raw.map(ClinicModel.tryParse).whereType<ClinicModel>().toList();
    } catch (e) {
      throw _toApiException(e);
    }
  }

  /// `GET /dental/clinics/:id` (`clinic.service.ts getClinicById`).
  Future<ClinicModel> fetchClinicDetail(String id) async {
    try {
      final response = await _request('GET', '/dental/clinics/$id');
      final data = (response is Map ? response['data'] : null) as Map?;
      final clinic = ClinicModel.tryParse(data?['clinic']);
      if (clinic == null) {
        throw ApiException(500, 'Clinic was not returned by the server.');
      }
      return clinic;
    } catch (e) {
      throw _toApiException(e);
    }
  }

  /// `GET /dental/clinics/:id/doctors` (`clinic.service.ts
  /// listClinicDoctors`).
  Future<List<ClinicDoctorModel>> fetchClinicDoctors(String clinicId) async {
    try {
      final response = await _request('GET', '/dental/clinics/$clinicId/doctors');
      final data = (response is Map ? response['data'] : null) as Map?;
      final raw = (data?['doctors'] as List?) ?? const [];
      return raw.map(ClinicDoctorModel.tryParse).whereType<ClinicDoctorModel>().toList();
    } catch (e) {
      throw _toApiException(e);
    }
  }

  /// `GET /dental/doctors/:id` (`doctor.service.ts getDoctorById`).
  Future<DoctorModel> fetchDoctorDetail(String id) async {
    try {
      final response = await _request('GET', '/dental/doctors/$id');
      final data = (response is Map ? response['data'] : null) as Map?;
      final doctor = DoctorModel.tryParse(data?['doctor']);
      if (doctor == null) {
        throw ApiException(500, 'Doctor was not returned by the server.');
      }
      return doctor;
    } catch (e) {
      throw _toApiException(e);
    }
  }

  /// `GET /dental/doctors/:id/availability?clinic_id=&from=&to=`
  /// (`doctor.service.ts getDoctorAvailability`, capped server-side at 30
  /// days - `dental.schema.ts availabilityQuerySchema` - a wider range is a
  /// `400`, thrown as-is, never silently clamped here either).
  Future<List<DateAvailability>> fetchDoctorAvailability({
    required String doctorId,
    required String clinicId,
    required DateTime from,
    required DateTime to,
  }) async {
    try {
      final response = await _request(
        'GET',
        '/dental/doctors/$doctorId/availability',
        query: {'clinic_id': clinicId, 'from': _dateOnly(from), 'to': _dateOnly(to)},
      );
      final data = (response is Map ? response['data'] : null) as Map?;
      final raw = (data?['availability'] as List?) ?? const [];
      return raw.map(DateAvailability.tryParse).whereType<DateAvailability>().toList();
    } catch (e) {
      throw _toApiException(e);
    }
  }

  /// `GET /dental/doctors/:id/slots?clinic_id=&date=`
  /// (`doctor.service.ts getDoctorSlots` -> `availability.service.ts
  /// computeDaySlots`). Returns the raw ISO-8601 instants exactly as the
  /// server computed them - already excludes elapsed times
  /// (task-B3-report.md §12) and already-occupied ones; this method performs
  /// no client-side filtering of its own (common.md rule 8).
  Future<List<DateTime>> fetchDoctorSlots({
    required String doctorId,
    required String clinicId,
    required DateTime date,
  }) async {
    try {
      final response = await _request(
        'GET',
        '/dental/doctors/$doctorId/slots',
        query: {'clinic_id': clinicId, 'date': _dateOnly(date)},
      );
      final data = (response is Map ? response['data'] : null) as Map?;
      final raw = (data?['slots'] as List?) ?? const [];
      return raw.map((s) => DateTime.tryParse(s.toString())).whereType<DateTime>().toList();
    } catch (e) {
      throw _toApiException(e);
    }
  }

  // --------------------------------------------------------------------
  // BOOKING LIFECYCLE (B3)
  // --------------------------------------------------------------------

  /// `POST /dental/appointments/holds` (task-B3-report.md §3/§4/§12).
  /// Returns `201` on a brand-new hold and `200` on an idempotent replay -
  /// both are success here (see [HoldOutcome.isIdempotentReplay]). A
  /// `409 SLOT_HELD`/`409 SLOT_UNAVAILABLE` (someone else has the slot) and
  /// a `422 SLOT_IN_PAST` (the time already elapsed) are real, expected
  /// refusals - returned as a typed [HoldOutcome], never thrown as a
  /// generic exception, so the caller can show "someone just took this
  /// slot" or "that time has passed, pick another" specifically.
  Future<HoldOutcome> holdSlot({
    required String clinicDoctorId,
    required DateTime startAt,
    String? idempotencyKey,
  }) async {
    try {
      final response = await _request(
        'POST',
        '/dental/appointments/holds',
        body: {
          'clinic_doctor_id': clinicDoctorId,
          'start_at': startAt.toUtc().toIso8601String(),
          if (idempotencyKey != null && idempotencyKey.trim().isNotEmpty)
            'idempotency_key': idempotencyKey.trim(),
        },
      );
      final data = (response is Map ? response['data'] : null) as Map?;
      final appointment = AppointmentModel.tryParse(data?['appointment']);
      if (appointment == null) {
        return HoldOutcome(error: ApiException(500, 'Hold was not returned by the server.'));
      }
      return HoldOutcome(appointment: appointment, isIdempotentReplay: data?['is_idempotent_replay'] == true);
    } catch (e) {
      return HoldOutcome(error: _toApiException(e));
    }
  }

  /// `POST /dental/appointments/:id/confirm` (task-B3-report.md §3/§12). A
  /// `410 HOLD_EXPIRED` or `409 APPOINTMENT_NOT_HELD` is a real, expected
  /// refusal - returned as a typed [ConfirmOutcome], never thrown, so F3 can
  /// show "your hold expired, pick a new time" specifically rather than a
  /// generic error.
  Future<ConfirmOutcome> confirmAppointment({
    required String id,
    required String patientName,
    required String patientPhone,
    String? patientNotes,
  }) async {
    try {
      final response = await _request(
        'POST',
        '/dental/appointments/$id/confirm',
        body: {
          'patient_name': patientName,
          'patient_phone': patientPhone,
          if (patientNotes != null && patientNotes.trim().isNotEmpty) 'patient_notes': patientNotes.trim(),
        },
      );
      final data = (response is Map ? response['data'] : null) as Map?;
      final appointment = AppointmentModel.tryParse(data?['appointment']);
      if (appointment == null) {
        return ConfirmOutcome(error: ApiException(500, 'Appointment was not returned by the server.'));
      }
      return ConfirmOutcome(appointment: appointment);
    } catch (e) {
      return ConfirmOutcome(error: _toApiException(e));
    }
  }

  /// `GET /dental/appointments?status=&bucket=&page=&limit=`
  /// (`appointment.service.ts listOwnAppointments`). Rows here never carry
  /// `patient_notes` (plan §16, asserted by B3's own tests) - only
  /// `fetchAppointmentDetail` returns it, to the owner only.
  Future<List<AppointmentModel>> fetchMyAppointments({
    String? bucket,
    String? status,
    int page = 1,
    int limit = 20,
  }) async {
    try {
      final response = await _request(
        'GET',
        '/dental/appointments',
        query: {
          if (bucket != null && bucket.isNotEmpty) 'bucket': bucket,
          if (status != null && status.isNotEmpty) 'status': status,
          'page': '$page',
          'limit': '$limit',
        },
      );
      final data = (response is Map ? response['data'] : null) as Map?;
      final raw = (data?['appointments'] as List?) ?? const [];
      return raw.map(AppointmentModel.tryParse).whereType<AppointmentModel>().toList();
    } catch (e) {
      throw _toApiException(e);
    }
  }

  /// `GET /dental/appointments/:id` (`appointment.service.ts
  /// getOwnedAppointment`). Same `404 APPOINTMENT_NOT_FOUND` body whether
  /// the id doesn't exist or belongs to someone else (task-B3-report.md §7
  /// IDOR) - thrown as-is, this method makes no attempt to tell the two
  /// apart.
  Future<AppointmentModel> fetchAppointmentDetail(String id) async {
    try {
      final response = await _request('GET', '/dental/appointments/$id');
      final data = (response is Map ? response['data'] : null) as Map?;
      final appointment = AppointmentModel.tryParse(data?['appointment']);
      if (appointment == null) {
        throw ApiException(500, 'Appointment was not returned by the server.');
      }
      return appointment;
    } catch (e) {
      throw _toApiException(e);
    }
  }

  /// `POST /dental/appointments/:id/cancel` (`appointment.service.ts
  /// cancelOwnAppointment`). A `4xx` the backend returns deliberately
  /// (already cancelled, not confirmed/expired, not found -
  /// `422 APPOINTMENT_NOT_CONFIRMED`, `409 APPOINTMENT_ALREADY_CANCELLED`,
  /// `422 APPOINTMENT_EXPIRED`, `404 APPOINTMENT_NOT_FOUND`) is a refusal via
  /// [AppointmentCancelOutcome.isRefusal], mirroring
  /// `order.provider.dart`'s `cancelOrder` exactly. No cancellation cutoff is
  /// enforced client-side or assumed here (DENTAL-07 is an open decision -
  /// see `appointment.service.ts canCustomerCancel`); the backend's
  /// `can_cancel` field on the model is the only source of truth for whether
  /// the button should even be shown.
  Future<AppointmentCancelOutcome> cancelAppointment({required String id, String? reason}) async {
    try {
      final response = await _request(
        'POST',
        '/dental/appointments/$id/cancel',
        body: reason != null && reason.trim().isNotEmpty ? {'reason': reason.trim()} : null,
      );
      final data = (response is Map ? response['data'] : null) as Map?;
      final appointment = AppointmentModel.tryParse(data?['appointment']);
      if (appointment == null) {
        return AppointmentCancelOutcome(error: ApiException(500, 'Appointment was not returned by the server.'));
      }
      return AppointmentCancelOutcome(appointment: appointment);
    } catch (e) {
      return AppointmentCancelOutcome(error: _toApiException(e));
    }
  }

  /// Longest comment the backend accepts on a rating.
  static const int ratingCommentMaxLength = 500;

  /// `POST /dental/appointments/:id/rating` - `{stars: 1..5, comment?}`.
  /// The comment is trimmed and a blank one is sent as no comment at all;
  /// whether the visit can be rated at all is the backend's call
  /// (`can_rate`), never re-checked here. Every refusal comes back as a
  /// typed [RatingOutcome] carrying the server's own message, never thrown.
  Future<RatingOutcome> rateAppointment({required String id, required int stars, String? comment}) async {
    final trimmed = comment?.trim();
    try {
      final response = await _request(
        'POST',
        '/dental/appointments/$id/rating',
        body: {
          'stars': stars,
          if (trimmed != null && trimmed.isNotEmpty) 'comment': trimmed,
        },
      );
      final data = (response is Map ? response['data'] : null) as Map?;
      final rating = DentalAppointmentRating.tryParse(data?['rating']);
      if (rating == null) {
        return RatingOutcome(error: ApiException(500, 'Rating was not returned by the server.'));
      }
      return RatingOutcome(rating: rating, appointment: AppointmentModel.tryParse(data?['appointment']));
    } catch (e) {
      return RatingOutcome(error: _toApiException(e));
    }
  }
}
