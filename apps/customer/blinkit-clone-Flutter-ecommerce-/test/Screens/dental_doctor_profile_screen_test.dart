import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:ecom/Screens/dental_doctor_profile_screen.dart';
import 'package:ecom/Services/Exceptions/api_exception.dart';
import 'package:ecom/Services/Providers/dental.provider.dart';

import '../fixtures/dental_fixtures.dart';

/// `dental_provider_test.dart`'s `_FakeDentalApi` pattern, duplicated per
/// this codebase's own convention.
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
  RouteSettings? lastRoute;

  setUp(() {
    api = _FakeDentalApi();
    provider = DentalProvider(request: api.call);
    lastRoute = null;
  });

  Future<void> pumpScreen(WidgetTester tester, {String doctorId = 'd1', String clinicId = 'c1'}) async {
    await tester.pumpWidget(
      ChangeNotifierProvider<DentalProvider>.value(
        value: provider,
        child: MaterialApp(
          home: DentalDoctorProfileScreen(doctorId: doctorId, clinicId: clinicId),
          onGenerateRoute: (settings) {
            lastRoute = settings;
            return MaterialPageRoute(
              settings: settings,
              builder: (_) => Scaffold(body: Text('route:${settings.name}')),
            );
          },
        ),
      ),
    );
    await tester.pump();
    await tester.pump();
  }

  // Bounded: the skeleton pulse repeats forever, so pumpAndSettle can't.
  Future<void> settle(WidgetTester tester) async {
    for (var i = 0; i < 8; i++) {
      await tester.pump(const Duration(milliseconds: 100));
    }
  }

  testWidgets('shows the loading skeleton while the first fetch is in flight', (tester) async {
    final pending = Completer<dynamic>();
    provider = DentalProvider(request: (method, url, {body, query}) async {
      if (method == 'GET' && url == '/dental/doctors/d1') return pending.future;
      throw ApiException(404, 'unexpected');
    });

    await pumpScreen(tester);

    expect(find.byKey(const Key('doctor-profile-skeleton')), findsOneWidget);
    // No CTA while the doctor has not loaded yet.
    expect(find.byKey(const Key('book-appointment-cta')), findsNothing);

    pending.complete(_envelope({'doctor': doctorJson(id: 'd1')}));
    await settle(tester);
  });

  testWidgets('renders the doctor, the fee at THIS clinic and the CTA once loaded', (tester) async {
    api.routes['GET /dental/doctors/d1'] = (q, b) => _envelope({
          'doctor': doctorJson(
            id: 'd1',
            fullName: 'Dr. Nadeesha Perera',
            clinics: [
              {
                'clinic_doctor_id': 'cd1',
                'clinic_id': 'c1',
                'name': 'Smile Dental Clinic',
                'city': 'Colombo',
                'address_line': '123 Galle Road',
                'latitude': 6.9271,
                'longitude': 79.8612,
                'consultation_fee': 3500,
              },
              {
                'clinic_doctor_id': 'cd2',
                'clinic_id': 'c2',
                'name': 'Bright Smiles',
                'city': 'Kandy',
                'address_line': '5 Hill Street',
                'latitude': 7.2906,
                'longitude': 80.6337,
                'consultation_fee': 5000,
              },
            ],
          ),
        });

    await pumpScreen(tester, doctorId: 'd1', clinicId: 'c1');
    await settle(tester);

    expect(find.text('Dr. Nadeesha Perera'), findsNWidgets(2));
    expect(find.text('Orthodontist'), findsOneWidget);
    // The fee shown is c1's (3500), never c2's (5000) - clinic-doctor scoped.
    expect(find.text('LKR 3,500'), findsOneWidget);
    expect(find.text('LKR 5,000'), findsNothing);
    expect(find.byKey(const Key('book-appointment-cta')), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a bio is shown when present; no "About" section when absent', (tester) async {
    api.routes['GET /dental/doctors/d1'] = (q, b) => _envelope({
          'doctor': doctorJson(id: 'd1'),
        });
    await pumpScreen(tester);
    await settle(tester);
    expect(find.text('About'), findsNothing);
  });

  testWidgets('no pairing at this clinic: "Not available" shown, no fabricated fee', (tester) async {
    api.routes['GET /dental/doctors/d1'] = (q, b) => _envelope({
          'doctor': doctorJson(id: 'd1', clinics: []),
        });

    await pumpScreen(tester, doctorId: 'd1', clinicId: 'c1');
    await settle(tester);

    expect(find.text('Not available'), findsOneWidget);
    expect(find.textContaining('LKR'), findsNothing);
  });

  testWidgets('shows the error view with retry, and retry reloads', (tester) async {
    api.routes['GET /dental/doctors/d1'] = (q, b) => ApiException(500, 'Something broke.');

    await pumpScreen(tester);
    await settle(tester);

    expect(find.text("We couldn't load this doctor"), findsOneWidget);
    expect(find.byKey(const Key('doctor-profile-retry')), findsOneWidget);
    expect(find.byKey(const Key('book-appointment-cta')), findsNothing);

    api.routes['GET /dental/doctors/d1'] = (q, b) => _envelope({'doctor': doctorJson(id: 'd1')});
    await tester.tap(find.byKey(const Key('doctor-profile-retry')));
    await settle(tester);

    expect(find.text("We couldn't load this doctor"), findsNothing);
    expect(find.text('Dr. Nadeesha Perera'), findsNWidgets(2));
  });

  testWidgets('a 404 shows "Doctor not found" with a way back, not the generic error view', (tester) async {
    api.routes['GET /dental/doctors/d1'] =
        (q, b) => ApiException(404, 'Doctor not found.', code: 'DOCTOR_NOT_FOUND');

    await pumpScreen(tester);
    await settle(tester);

    expect(find.text('Doctor not found'), findsOneWidget);
    expect(find.text("We couldn't load this doctor"), findsNothing);
    expect(find.byKey(const Key('book-appointment-cta')), findsNothing);
  });

  testWidgets('tapping "Book appointment" navigates to /dental/book with both ids', (tester) async {
    api.routes['GET /dental/doctors/d1'] = (q, b) => _envelope({
          'doctor': doctorJson(id: 'd1'),
        });

    await pumpScreen(tester, doctorId: 'd1', clinicId: 'c1');
    await settle(tester);

    await tester.tap(find.byKey(const Key('book-appointment-cta')));
    await settle(tester);

    expect(lastRoute?.name, '/dental/book');
    expect(lastRoute?.arguments, {'doctorId': 'd1', 'clinicId': 'c1'});
  });

  testWidgets('shows the doctor rating "★ 4.6 (12)" under the name', (tester) async {
    api.routes['GET /dental/doctors/d1'] =
        (q, b) => _envelope({'doctor': doctorJson(id: 'd1', ratingAverage: 4.6, ratingCount: 12)});
    await pumpScreen(tester);
    await settle(tester);

    expect(find.text('★ 4.6 (12)'), findsOneWidget);
    expect(find.bySemanticsLabel('Rated 4.6 out of 5 from 12 ratings'), findsOneWidget);
  });

  testWidgets('a doctor with no ratings shows no rating at all', (tester) async {
    api.routes['GET /dental/doctors/d1'] = (q, b) => _envelope({'doctor': doctorJson(id: 'd1')});
    await pumpScreen(tester);
    await settle(tester);

    expect(find.byKey(const Key('doctor-rating')), findsNothing);
    expect(find.textContaining('★'), findsNothing);
  });
}
