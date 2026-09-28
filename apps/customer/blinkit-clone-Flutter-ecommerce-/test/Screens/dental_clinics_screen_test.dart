import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:ecom/Screens/dental_clinic_detail_screen.dart';
import 'package:ecom/Screens/dental_clinics_screen.dart';
import 'package:ecom/Services/Exceptions/api_exception.dart';
import 'package:ecom/Services/Providers/dental.provider.dart';
import 'package:ecom/UI/Widgets/Atoms/app_skeleton.dart';

import '../fixtures/dental_fixtures.dart';

/// `dental_provider_test.dart`'s `_FakeDentalApi` pattern, duplicated per
/// this codebase's own convention (`_FakeOrdersApi`/`_FakeCatalog` are each
/// local to their test file too).
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

  Future<void> pumpScreen(WidgetTester tester) async {
    await tester.pumpWidget(
      ChangeNotifierProvider<DentalProvider>.value(
        value: provider,
        child: MaterialApp(
          home: const DentalClinicsScreen(),
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

  // Bounded: the skeleton pulse repeats forever, so pumpAndSettle can't
  // (product_details_screen_test.dart's `settle` idiom).
  Future<void> settle(WidgetTester tester) async {
    for (var i = 0; i < 8; i++) {
      await tester.pump(const Duration(milliseconds: 100));
    }
  }

  testWidgets('shows the loading skeleton while the first fetch is in flight', (tester) async {
    final pending = Completer<dynamic>();
    // The fake's route map only returns synchronous values, so a genuinely
    // pending fetch is driven directly at the request-function layer.
    provider = DentalProvider(request: (method, url, {body, query}) async {
      if (method == 'GET' && url == '/dental/clinics') return pending.future;
      throw ApiException(404, 'unexpected');
    });

    await pumpScreen(tester);

    expect(find.byKey(const Key('clinics-skeleton')), findsOneWidget);
    expect(find.byType(ListRowSkeleton), findsWidgets);

    pending.complete(_envelope({'clinics': []}));
    await settle(tester);
  });

  testWidgets('renders real clinic name, city and address once loaded', (tester) async {
    api.routes['GET /dental/clinics'] = (q, b) => _envelope({
          'clinics': [
            clinicJson(id: 'c1', name: 'Smile Dental Clinic', city: 'Colombo'),
            clinicJson(id: 'c2', name: 'Bright Smiles', city: 'Kandy'),
          ],
        });

    await pumpScreen(tester);
    await settle(tester);

    expect(find.text('Smile Dental Clinic'), findsOneWidget);
    expect(find.text('Colombo'), findsOneWidget);
    expect(find.text('123 Galle Road'), findsWidgets);
    expect(find.text('Bright Smiles'), findsOneWidget);
    expect(find.text('Kandy'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('shows the empty-state copy when there are no clinics', (tester) async {
    api.routes['GET /dental/clinics'] = (q, b) => _envelope({'clinics': []});

    await pumpScreen(tester);
    await settle(tester);

    expect(find.text('No doctors available yet'), findsOneWidget);
  });

  testWidgets('shows the error view with retry, and retry reloads', (tester) async {
    api.routes['GET /dental/clinics'] = (q, b) => ApiException(500, 'Something broke.');

    await pumpScreen(tester);
    await settle(tester);

    expect(find.text("We couldn't load clinics"), findsOneWidget);
    expect(find.byKey(const Key('clinics-retry')), findsOneWidget);

    api.routes['GET /dental/clinics'] = (q, b) => _envelope({
          'clinics': [clinicJson(id: 'c1', name: 'Smile Dental Clinic')],
        });
    await tester.tap(find.byKey(const Key('clinics-retry')));
    await settle(tester);

    expect(find.text("We couldn't load clinics"), findsNothing);
    expect(find.text('Smile Dental Clinic'), findsOneWidget);
  });

  testWidgets('tapping a clinic row navigates to /dental/clinic with the clinic id', (tester) async {
    api.routes['GET /dental/clinics'] = (q, b) => _envelope({
          'clinics': [clinicJson(id: 'c1', name: 'Smile Dental Clinic')],
        });

    await pumpScreen(tester);
    await settle(tester);

    await tester.tap(find.byKey(const Key('clinic-row-c1')));
    await settle(tester);

    expect(lastRoute?.name, '/dental/clinic');
    expect(lastRoute?.arguments, 'c1');
    expect(find.text('route:/dental/clinic'), findsOneWidget);
    // Ensures the screen these arguments were designed for accepts exactly
    // this shape (a bare clinic id String).
    expect(const DentalClinicDetailScreen(clinicId: 'c1').clinicId, 'c1');
  });

  testWidgets('the AppBar "My appointments" action navigates to /dental/appointments (task F5)', (tester) async {
    api.routes['GET /dental/clinics'] = (q, b) => _envelope({'clinics': []});

    await pumpScreen(tester);
    await settle(tester);

    await tester.tap(find.byKey(const Key('my-dental-appointments-action')));
    await settle(tester);

    expect(lastRoute?.name, '/dental/appointments');
    expect(find.text('route:/dental/appointments'), findsOneWidget);
  });

  testWidgets('typing into the search field debounces into one fetchClinics(search:) call', (tester) async {
    api.routes['GET /dental/clinics'] = (q, b) => _envelope({
          'clinics': [clinicJson(id: 'c1', name: 'Smile Dental Clinic')],
        });

    await pumpScreen(tester);
    await settle(tester);
    final callsBefore = api.calls.length;

    await tester.enterText(find.byType(TextField), 'Smile');
    await tester.pump(const Duration(milliseconds: 100));
    // Still inside the debounce window: no new request yet.
    expect(api.calls.length, callsBefore);

    await tester.pump(const Duration(milliseconds: 400));
    await settle(tester);

    final searchCalls = api.calls.where((c) => c['key'] == 'GET /dental/clinics').toList();
    expect((searchCalls.last['query'] as Map)['search'], 'Smile');
  });
}
