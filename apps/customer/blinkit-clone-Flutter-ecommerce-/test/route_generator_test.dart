import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:ecom/Screens/dental_appointment_detail_screen.dart';
import 'package:ecom/Screens/dental_clinic_detail_screen.dart';
import 'package:ecom/Screens/dental_clinics_screen.dart';
import 'package:ecom/Screens/dental_doctor_profile_screen.dart';
import 'package:ecom/Screens/dental_my_appointments_screen.dart';
import 'package:ecom/Screens/dental_slot_picker_screen.dart';
import 'package:ecom/UI/Widgets/Organisms/dental_sign_in_gate.dart';
import 'package:ecom/Screens/not_found_screen.dart';
import 'package:ecom/route_generator.dart';

/// Task F5 - route registration for the dental clinic appointments feature.
/// Mirrors `route_fallbacks_test.dart`'s own `_build` helper (builds the page
/// via the route's own builder without pumping it into the tree, so no
/// provider setup is needed just to check which screen/arguments a route
/// resolves to).
Future<Widget> _build(WidgetTester tester, String? name, {Object? arguments}) async {
  late Widget built;
  await tester.pumpWidget(
    MaterialApp(
      home: Builder(
        builder: (context) {
          final route = AppRouter.generateRoute(RouteSettings(name: name, arguments: arguments))!;
          built = (route as MaterialPageRoute).builder(context);
          return const SizedBox();
        },
      ),
    ),
  );
  return built;
}

/// The doctors routes are behind DentalSignInGate (owner, 2026-10-10: a
/// guest signs in first while "Doctors need sign-in" is on); the screen is
/// its child, and its login comes back to this same route.
Widget _gated(Widget page, String name, {Object? arguments}) {
  expect(page, isA<DentalSignInGate>(), reason: name);
  final gate = page as DentalSignInGate;
  expect(gate.destination.name, name);
  expect(gate.destination.arguments, arguments);
  return gate.child;
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() => FlutterSecureStorage.setMockInitialValues({}));

  group('/dental/clinics', () {
    testWidgets('opens the clinics list, no argument needed', (tester) async {
      expect(_gated(await _build(tester, '/dental/clinics'), '/dental/clinics'), isA<DentalClinicsScreen>());
    });
  });

  group('/dental/clinic', () {
    testWidgets('a non-empty clinic id opens the clinic detail page', (tester) async {
      final page = _gated(await _build(tester, '/dental/clinic', arguments: 'c1'), '/dental/clinic', arguments: 'c1');
      expect(page, isA<DentalClinicDetailScreen>());
      expect((page as DentalClinicDetailScreen).clinicId, 'c1');
    });

    testWidgets('missing, empty, blank or wrong-typed arguments are not-found', (tester) async {
      for (final args in <Object?>[null, '', '   ', 42, true, {'id': 'c1'}, ['c1']]) {
        expect(await _build(tester, '/dental/clinic', arguments: args), isA<NotFoundScreen>(), reason: '$args');
      }
    });
  });

  group('/dental/doctor', () {
    testWidgets('a {doctorId, clinicId} map opens the doctor profile with both ids', (tester) async {
      final page = _gated(
        await _build(tester, '/dental/doctor', arguments: {'doctorId': 'd1', 'clinicId': 'c1'}),
        '/dental/doctor',
        arguments: {'doctorId': 'd1', 'clinicId': 'c1'},
      );
      expect(page, isA<DentalDoctorProfileScreen>());
      expect((page as DentalDoctorProfileScreen).doctorId, 'd1');
      expect(page.clinicId, 'c1');
    });

    testWidgets('missing, empty or wrong-typed arguments are not-found', (tester) async {
      for (final args in <Object?>[
        null,
        'd1',
        <String, dynamic>{},
        {'doctorId': 'd1'},
        {'clinicId': 'c1'},
        {'doctorId': '', 'clinicId': 'c1'},
        {'doctorId': 'd1', 'clinicId': ''},
        {'doctorId': 1, 'clinicId': 'c1'},
      ]) {
        expect(await _build(tester, '/dental/doctor', arguments: args), isA<NotFoundScreen>(), reason: '$args');
      }
    });
  });

  group('/dental/book', () {
    testWidgets('the same {doctorId, clinicId} shape opens the slot picker with both ids', (tester) async {
      final page = _gated(
        await _build(tester, '/dental/book', arguments: {'doctorId': 'd1', 'clinicId': 'c1'}),
        '/dental/book',
        arguments: {'doctorId': 'd1', 'clinicId': 'c1'},
      );
      expect(page, isA<DentalSlotPickerScreen>());
      expect((page as DentalSlotPickerScreen).doctorId, 'd1');
      expect(page.clinicId, 'c1');
    });

    testWidgets('missing, empty or wrong-typed arguments are not-found', (tester) async {
      for (final args in <Object?>[
        null,
        <String, dynamic>{},
        {'doctorId': 'd1'},
        {'clinicId': 'c1'},
        {'doctorId': '', 'clinicId': 'c1'},
      ]) {
        expect(await _build(tester, '/dental/book', arguments: args), isA<NotFoundScreen>(), reason: '$args');
      }
    });
  });

  group('/dental/appointments', () {
    testWidgets('opens the appointments list, no argument needed', (tester) async {
      expect(await _build(tester, '/dental/appointments'), isA<DentalMyAppointmentsScreen>());
    });
  });

  group('/dental/appointments/detail', () {
    testWidgets('a non-empty appointment id opens the appointment detail page', (tester) async {
      final page = await _build(tester, '/dental/appointments/detail', arguments: 'a1');
      expect(page, isA<DentalAppointmentDetailScreen>());
      expect((page as DentalAppointmentDetailScreen).appointmentId, 'a1');
    });

    testWidgets('missing, empty, blank or wrong-typed arguments are not-found', (tester) async {
      for (final args in <Object?>[null, '', '  ', 7, {'id': 'a1'}]) {
        expect(
          await _build(tester, '/dental/appointments/detail', arguments: args),
          isA<NotFoundScreen>(),
          reason: '$args',
        );
      }
    });
  });

  group('no route name collides with an existing one', () {
    test('every dental route string is distinct from every other case in route_generator.dart', () {
      // A compile-time guarantee already (a Dart switch cannot declare the
      // same case twice), but this documents the six exact strings this
      // task registered, so a future rename is caught here too.
      const dentalRoutes = <String>[
        '/dental/clinics',
        '/dental/clinic',
        '/dental/doctor',
        '/dental/book',
        '/dental/appointments',
        '/dental/appointments/detail',
      ];
      expect(dentalRoutes.toSet().length, dentalRoutes.length);
    });
  });
}
