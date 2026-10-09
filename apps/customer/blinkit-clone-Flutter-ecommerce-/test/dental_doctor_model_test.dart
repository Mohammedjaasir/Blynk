import 'package:flutter_test/flutter_test.dart';
import 'package:ecom/Models/dental_doctor_model.dart';

import 'fixtures/dental_fixtures.dart';

void main() {
  group('dentalSpecialtyLabel', () {
    // Free text since migration 030 (owner, 2026-10-09).
    test('shows a free-text specialty exactly as Operations/Admin wrote it (trimmed)', () {
      expect(dentalSpecialtyLabel('Cosmetic dentist'), 'Cosmetic dentist');
      expect(dentalSpecialtyLabel('  Prosthodontist '), 'Prosthodontist');
      expect(dentalSpecialtyLabel('Orthodontist'), 'Orthodontist');
    });

    test('an old enum code (before migration 030) still reads as its label', () {
      expect(dentalSpecialtyLabel('GENERAL_DENTIST'), 'General dentist');
      expect(dentalSpecialtyLabel('ORTHODONTIST'), 'Orthodontist');
      expect(dentalSpecialtyLabel('PERIODONTIST'), 'Periodontist');
      expect(dentalSpecialtyLabel('ENDODONTIST'), 'Endodontist');
      expect(dentalSpecialtyLabel('ORAL_SURGEON'), 'Oral surgeon');
      expect(dentalSpecialtyLabel('PEDIATRIC_DENTIST'), 'Pediatric dentist');
    });

    test('a missing value reads as the generic "Dentist", never crashes', () {
      expect(dentalSpecialtyLabel(null), 'Dentist');
      expect(dentalSpecialtyLabel(''), 'Dentist');
      expect(dentalSpecialtyLabel('   '), 'Dentist');
    });
  });

  group('ClinicDoctorModel', () {
    test('parses a ClinicDoctorDto exactly as clinic.service.ts listClinicDoctors returns it', () {
      final doc = ClinicDoctorModel.fromJson(clinicDoctorJson());

      expect(doc.clinicDoctorId, 'cd0000001-0000-0000-0000-000000000001');
      expect(doc.doctorId, 'd0000001-0000-0000-0000-000000000001');
      expect(doc.fullName, 'Dr. Nadeesha Perera');
      expect(doc.specialty, 'Orthodontist');
      expect(doc.photoUrl, 'https://example.com/photo.jpg');
      expect(doc.bio, '10 years of experience.');
      expect(doc.consultationFee, 3500.0);
    });

    test('a null consultation_fee (unset by an admin) parses as null, not zero', () {
      final doc = ClinicDoctorModel.fromJson(clinicDoctorJson(consultationFee: null));
      expect(doc.consultationFee, isNull);
    });

    test('a NUMERIC fee arriving as a string still parses', () {
      final doc = ClinicDoctorModel.fromJson({...clinicDoctorJson(), 'consultation_fee': '3500.00'});
      expect(doc.consultationFee, 3500.0);
    });

    test('a free-text specialty is shown as written; an old enum code as its label', () {
      final doc = ClinicDoctorModel.fromJson(clinicDoctorJson(specialty: 'Cosmetic dentist'));
      expect(doc.specialty, 'Cosmetic dentist');
      expect(doc.rawSpecialty, 'Cosmetic dentist');
      final legacy = ClinicDoctorModel.fromJson(clinicDoctorJson(specialty: 'ORAL_SURGEON'));
      expect(legacy.specialty, 'Oral surgeon');
      expect(legacy.rawSpecialty, 'ORAL_SURGEON');
    });

    test('tryParse rejects a payload with no clinic_doctor_id', () {
      expect(ClinicDoctorModel.tryParse(null), isNull);
      expect(ClinicDoctorModel.tryParse({'doctor_id': 'd1'}), isNull);
    });
  });

  group('DoctorModel', () {
    test('parses a DoctorDto exactly as doctor.service.ts getDoctorById returns it, including embedded clinics', () {
      final doctor = DoctorModel.fromJson(doctorJson());

      expect(doctor.id, 'd0000001-0000-0000-0000-000000000001');
      expect(doctor.fullName, 'Dr. Nadeesha Perera');
      expect(doctor.specialty, 'Orthodontist');
      expect(doctor.photoUrl, isNull);
      expect(doctor.bio, isNull);
      expect(doctor.clinics, hasLength(1));

      final clinic = doctor.clinics.single;
      expect(clinic.clinicDoctorId, 'cd0000001-0000-0000-0000-000000000001');
      expect(clinic.clinicId, 'c0000001-0000-0000-0000-000000000001');
      expect(clinic.name, 'Smile Dental Clinic');
      expect(clinic.city, 'Colombo');
      expect(clinic.latitude, 6.9271);
      expect(clinic.longitude, 79.8612);
      expect(clinic.consultationFee, 3500.0);
    });

    test('a doctor practicing at no active clinic parses with an empty list, not a crash', () {
      final doctor = DoctorModel.fromJson(doctorJson(clinics: []));
      expect(doctor.clinics, isEmpty);
    });

    test('a per-clinic null consultation_fee parses as null', () {
      final doctor = DoctorModel.fromJson(doctorJson(clinics: [
        {
          'clinic_doctor_id': 'cd1',
          'clinic_id': 'c1',
          'name': 'Bright Smiles',
          'city': 'Kandy',
          'address_line': '5 Hill Street',
          'latitude': 7.2906,
          'longitude': 80.6337,
          'consultation_fee': null,
        },
      ]));
      expect(doctor.clinics.single.consultationFee, isNull);
    });

    test('tryParse rejects a payload with no id', () {
      expect(DoctorModel.tryParse(null), isNull);
      expect(DoctorModel.tryParse('x'), isNull);
      expect(DoctorModel.tryParse({'full_name': 'No id'}), isNull);
    });
  });

  group('ratings (rating_average / rating_count)', () {
    test('a rated doctor profile parses the average and count, and labels them', () {
      final doctor = DoctorModel.fromJson(doctorJson(ratingAverage: 4.6, ratingCount: 12));
      expect(doctor.ratingAverage, 4.6);
      expect(doctor.ratingCount, 12);
      expect(doctor.ratingLabel, '★ 4.6 (12)');
    });

    test('a clinic roster row parses the same two fields', () {
      final row = ClinicDoctorModel.fromJson(clinicDoctorJson(ratingAverage: 5, ratingCount: 1));
      expect(row.ratingAverage, 5.0);
      expect(row.ratingCount, 1);
      expect(row.ratingLabel, '★ 5.0 (1)');
    });

    test('no ratings (null average, zero count) has no label', () {
      final doctor = DoctorModel.fromJson(doctorJson());
      expect(doctor.ratingAverage, isNull);
      expect(doctor.ratingCount, 0);
      expect(doctor.ratingLabel, isNull);
      expect(ClinicDoctorModel.fromJson(clinicDoctorJson()).ratingLabel, isNull);
    });

    test('an older backend without the fields reads as no ratings', () {
      final json = doctorJson()
        ..remove('rating_average')
        ..remove('rating_count');
      final doctor = DoctorModel.fromJson(json);
      expect(doctor.ratingAverage, isNull);
      expect(doctor.ratingCount, 0);
    });

    test('dentalRatingLabel: exactly one decimal; nothing without both an average and a count', () {
      expect(dentalRatingLabel(4.56, 3), '★ 4.6 (3)');
      expect(dentalRatingLabel(4, 2), '★ 4.0 (2)');
      expect(dentalRatingLabel(null, 5), isNull);
      expect(dentalRatingLabel(4.5, 0), isNull);
    });
  });
}
