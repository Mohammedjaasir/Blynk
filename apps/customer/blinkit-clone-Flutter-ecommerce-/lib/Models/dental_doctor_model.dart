// The two doctor DTOs B2 returns (task-B2-report.md;
// backend/api/src/modules/dental/doctor.service.ts / clinic.service.ts).

/// The six enum codes `doctors.specialty` held before migration 030, in case
/// an old value comes back before the backend is migrated.
const Map<String, String> _legacySpecialtyLabels = {
  'GENERAL_DENTIST': 'General dentist',
  'ORTHODONTIST': 'Orthodontist',
  'PERIODONTIST': 'Periodontist',
  'ENDODONTIST': 'Endodontist',
  'ORAL_SURGEON': 'Oral surgeon',
  'PEDIATRIC_DENTIST': 'Pediatric dentist',
};

/// A doctor's specialty for display. Since migration 030 (owner,
/// 2026-10-09) it is free text written by Operations/Admin (e.g.
/// "Cosmetic dentist") and is shown as-is; an old enum code reads as its
/// label, and a missing one as the generic "Dentist".
String dentalSpecialtyLabel(String? raw) {
  final text = (raw ?? '').trim();
  if (text.isEmpty) return 'Dentist';
  return _legacySpecialtyLabels[text] ?? text;
}

double? _ratingAverage(Object? v) => v == null ? null : double.tryParse(v.toString());

int _ratingCount(Object? v) => v == null ? 0 : (num.tryParse(v.toString())?.toInt() ?? 0);

/// The doctor's public rating as one compact label - `★ 4.6 (12)` - with
/// the average always at exactly one decimal. Null when there is nothing
/// real to show (no ratings yet, or no average from the server), so the
/// caller renders nothing at all rather than a "0.0" or "(0)".
String? dentalRatingLabel(double? average, int count) {
  if (average == null || count <= 0) return null;
  return '★ ${average.toStringAsFixed(1)} ($count)';
}

/// One clinic a doctor practices at, as embedded in `GET /dental/doctors/:id`
/// (`doctor.service.ts getDoctorById` -> `DoctorClinicDto`). This is the
/// doctor -> clinics direction; `ClinicDoctorModel` below is the clinic ->
/// doctors direction returned by a different endpoint - the two DTOs are not
/// the same shape on the backend, so they are not force-fit into one model
/// here either.
class DoctorClinicModel {
  final String clinicDoctorId;
  final String clinicId;
  final String name;
  final String city;
  final String addressLine;
  final double latitude;
  final double longitude;
  final double? consultationFee;

  const DoctorClinicModel({
    required this.clinicDoctorId,
    required this.clinicId,
    required this.name,
    required this.city,
    required this.addressLine,
    required this.latitude,
    required this.longitude,
    this.consultationFee,
  });

  factory DoctorClinicModel.fromJson(Map<String, dynamic> json) {
    return DoctorClinicModel(
      clinicDoctorId: (json['clinic_doctor_id'] ?? '').toString(),
      clinicId: (json['clinic_id'] ?? '').toString(),
      name: (json['name'] ?? '').toString(),
      city: (json['city'] ?? '').toString(),
      addressLine: (json['address_line'] ?? '').toString(),
      latitude: double.tryParse((json['latitude'] ?? 0).toString()) ?? 0.0,
      longitude: double.tryParse((json['longitude'] ?? 0).toString()) ?? 0.0,
      consultationFee:
          json['consultation_fee'] == null ? null : double.tryParse(json['consultation_fee'].toString()),
    );
  }
}

/// `GET /dental/doctors/:id` (`doctor.service.ts getDoctorById` ->
/// `DoctorDto`).
class DoctorModel {
  final String id;
  final String fullName;
  /// Display text - see [dentalSpecialtyLabel].
  final String specialty;
  final String rawSpecialty;
  final String? photoUrl;
  final String? bio;
  final List<DoctorClinicModel> clinics;

  /// `rating_average` (one decimal, null with no ratings) and
  /// `rating_count` (0 with none). Missing on an older backend - read as
  /// null/0, i.e. "no ratings".
  final double? ratingAverage;
  final int ratingCount;

  const DoctorModel({
    required this.id,
    required this.fullName,
    required this.specialty,
    required this.rawSpecialty,
    this.photoUrl,
    this.bio,
    this.clinics = const [],
    this.ratingAverage,
    this.ratingCount = 0,
  });

  /// See [dentalRatingLabel].
  String? get ratingLabel => dentalRatingLabel(ratingAverage, ratingCount);

  factory DoctorModel.fromJson(Map<String, dynamic> json) {
    final rawClinics = (json['clinics'] as List?) ?? const [];
    return DoctorModel(
      id: (json['id'] ?? '').toString(),
      fullName: (json['full_name'] ?? '').toString(),
      specialty: dentalSpecialtyLabel(json['specialty']?.toString()),
      rawSpecialty: (json['specialty'] ?? '').toString(),
      photoUrl: json['photo_url']?.toString(),
      bio: json['bio']?.toString(),
      clinics: rawClinics
          .whereType<Map>()
          .map((c) => DoctorClinicModel.fromJson(c.cast<String, dynamic>()))
          .toList(),
      ratingAverage: _ratingAverage(json['rating_average']),
      ratingCount: _ratingCount(json['rating_count']),
    );
  }

  static DoctorModel? tryParse(Object? json) {
    if (json is! Map) return null;
    final map = json.cast<String, dynamic>();
    if ((map['id'] ?? '').toString().isEmpty) return null;
    return DoctorModel.fromJson(map);
  }
}

/// One row of `GET /dental/clinics/:id/doctors` (`clinic.service.ts
/// listClinicDoctors` -> `ClinicDoctorDto`): a doctor practicing at ONE
/// clinic (the clinic named by the path), with the fee for that specific
/// pairing. `clinicDoctorId` IS `clinic_doctors.id` - the exact id to send as
/// `clinic_doctor_id` when holding a slot (task-B3-report.md
/// `createHoldSchema`). There is no separate `clinicId` field in this
/// response (the backend does not return one here - it's implied by the
/// path parameter used to fetch this list), so this model does not invent
/// one either.
class ClinicDoctorModel {
  final String clinicDoctorId;
  final String doctorId;
  final String fullName;
  /// Display text - see [dentalSpecialtyLabel].
  final String specialty;
  final String rawSpecialty;
  final String? photoUrl;
  final String? bio;
  final double? consultationFee;

  /// Same as [DoctorModel.ratingAverage] / [DoctorModel.ratingCount].
  final double? ratingAverage;
  final int ratingCount;

  const ClinicDoctorModel({
    required this.clinicDoctorId,
    required this.doctorId,
    required this.fullName,
    required this.specialty,
    required this.rawSpecialty,
    this.photoUrl,
    this.bio,
    this.consultationFee,
    this.ratingAverage,
    this.ratingCount = 0,
  });

  /// See [dentalRatingLabel].
  String? get ratingLabel => dentalRatingLabel(ratingAverage, ratingCount);

  factory ClinicDoctorModel.fromJson(Map<String, dynamic> json) {
    return ClinicDoctorModel(
      clinicDoctorId: (json['clinic_doctor_id'] ?? '').toString(),
      doctorId: (json['doctor_id'] ?? '').toString(),
      fullName: (json['full_name'] ?? '').toString(),
      specialty: dentalSpecialtyLabel(json['specialty']?.toString()),
      rawSpecialty: (json['specialty'] ?? '').toString(),
      photoUrl: json['photo_url']?.toString(),
      bio: json['bio']?.toString(),
      consultationFee:
          json['consultation_fee'] == null ? null : double.tryParse(json['consultation_fee'].toString()),
      ratingAverage: _ratingAverage(json['rating_average']),
      ratingCount: _ratingCount(json['rating_count']),
    );
  }

  static ClinicDoctorModel? tryParse(Object? json) {
    if (json is! Map) return null;
    final map = json.cast<String, dynamic>();
    if ((map['clinic_doctor_id'] ?? '').toString().isEmpty) return null;
    return ClinicDoctorModel.fromJson(map);
  }
}
