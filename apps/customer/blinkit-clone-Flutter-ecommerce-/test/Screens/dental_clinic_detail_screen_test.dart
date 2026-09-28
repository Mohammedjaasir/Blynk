import 'dart:async';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_maps_flutter_platform_interface/google_maps_flutter_platform_interface.dart' as gm;
import 'package:provider/provider.dart';

import 'package:ecom/Screens/dental_clinic_detail_screen.dart';
import 'package:ecom/Screens/dental_doctor_profile_screen.dart';
import 'package:ecom/Services/Exceptions/api_exception.dart';
import 'package:ecom/Services/Providers/dental.provider.dart';
import 'package:ecom/UI/Widgets/Atoms/app_skeleton.dart';
import 'package:ecom/UI/Widgets/Organisms/google_map_view.dart';
import 'package:ecom/UI/Widgets/Organisms/map_provider.dart';
import 'package:ecom/UI/Widgets/Organisms/map_provider_config.dart';

import '../fixtures/dental_fixtures.dart';
import '../fixtures/fake_google_maps_platform.dart';

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

/// `test/clinic_location_map_test.dart`'s fake map, reused here so every test
/// except the dedicated real-adapter one below needs no native platform view.
class _FakeTrackingMap extends TrackingMapView {
  const _FakeTrackingMap({
    required this.initialCenter,
    required this.initialZoom,
    required this.markers,
    this.semanticsLabel,
  }) : super.constructor();

  @override
  final GeoPoint initialCenter;
  @override
  final double initialZoom;
  @override
  final Set<MapMarkerSpec> markers;
  final String? semanticsLabel;

  @override
  Widget build(BuildContext context) => const SizedBox.expand(key: Key('fake-map'));
}

TrackingMapView _fakeMapBuilder({
  required GeoPoint initialCenter,
  required double initialZoom,
  required Set<MapMarkerSpec> markers,
  String? semanticsLabel,
}) =>
    _FakeTrackingMap(initialCenter: initialCenter, initialZoom: initialZoom, markers: markers, semanticsLabel: semanticsLabel);

void main() {
  late _FakeDentalApi api;
  late DentalProvider provider;
  RouteSettings? lastRoute;

  setUp(() {
    api = _FakeDentalApi();
    provider = DentalProvider(request: api.call);
    lastRoute = null;
  });

  Future<void> pumpScreen(
    WidgetTester tester, {
    String clinicId = 'c1',
    TrackingMapBuilder? mapBuilder = _fakeMapBuilder,
  }) async {
    await tester.pumpWidget(
      ChangeNotifierProvider<DentalProvider>.value(
        value: provider,
        child: MaterialApp(
          home: DentalClinicDetailScreen(clinicId: clinicId, mapBuilder: mapBuilder),
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

  void stubClinicAndDoctors({
    List<Map<String, dynamic>>? doctors,
  }) {
    api.routes['GET /dental/clinics/c1'] = (q, b) => _envelope({'clinic': clinicJson(id: 'c1')});
    api.routes['GET /dental/clinics/c1/doctors'] = (q, b) => _envelope({
          'doctors': doctors ?? [clinicDoctorJson()],
        });
  }

  testWidgets('shows the loading skeleton while the first fetch is in flight', (tester) async {
    final pendingClinic = Completer<dynamic>();
    provider = DentalProvider(request: (method, url, {body, query}) async {
      if (method == 'GET' && url == '/dental/clinics/c1') return pendingClinic.future;
      if (method == 'GET' && url == '/dental/clinics/c1/doctors') return _envelope({'doctors': []});
      throw ApiException(404, 'unexpected');
    });

    await pumpScreen(tester);

    expect(find.byKey(const Key('clinic-detail-skeleton')), findsOneWidget);
    expect(find.byType(ListRowSkeleton), findsWidgets);

    pendingClinic.complete(_envelope({'clinic': clinicJson(id: 'c1')}));
    await settle(tester);
  });

  testWidgets('renders the clinic, its map and its doctor roster once loaded', (tester) async {
    stubClinicAndDoctors(doctors: [
      clinicDoctorJson(clinicDoctorId: 'cd1', fullName: 'Dr. Nadeesha Perera', consultationFee: 3500),
    ]);

    await pumpScreen(tester);
    await settle(tester);

    // Shown both in the AppBar title and the body heading - intentional
    // (matches OrderSummaryScreen's own order-number-in-two-places pattern).
    expect(find.text('Smile Dental Clinic'), findsNWidgets(2));
    expect(find.text('123 Galle Road'), findsOneWidget);
    expect(find.text('Colombo'), findsOneWidget);
    expect(find.text('Open 09:00 – 18:00'), findsOneWidget);
    expect(find.byKey(const Key('fake-map')), findsOneWidget);

    // Doctor roster.
    expect(find.text('Dr. Nadeesha Perera'), findsOneWidget);
    expect(find.text('Orthodontist'), findsOneWidget);
    expect(find.text('LKR 3,500'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('an empty doctor roster shows the empty-state copy, not a blank section', (tester) async {
    stubClinicAndDoctors(doctors: []);

    await pumpScreen(tester);
    await settle(tester);

    expect(find.text('Smile Dental Clinic'), findsNWidgets(2));
    expect(find.text('No doctors listed at this clinic yet'), findsOneWidget);
  });

  testWidgets('shows the error view with retry, and retry reloads', (tester) async {
    api.routes['GET /dental/clinics/c1'] = (q, b) => ApiException(500, 'Something broke.');
    api.routes['GET /dental/clinics/c1/doctors'] = (q, b) => ApiException(500, 'Something broke.');

    await pumpScreen(tester);
    await settle(tester);

    expect(find.text("We couldn't load this clinic"), findsOneWidget);
    expect(find.byKey(const Key('clinic-detail-retry')), findsOneWidget);

    stubClinicAndDoctors();
    await tester.tap(find.byKey(const Key('clinic-detail-retry')));
    await settle(tester);

    expect(find.text("We couldn't load this clinic"), findsNothing);
    expect(find.text('Smile Dental Clinic'), findsNWidgets(2));
  });

  testWidgets('a 404 shows "Clinic not found" with a way back, not the generic error view', (tester) async {
    api.routes['GET /dental/clinics/c1'] =
        (q, b) => ApiException(404, 'Clinic not found.', code: 'CLINIC_NOT_FOUND');
    api.routes['GET /dental/clinics/c1/doctors'] =
        (q, b) => ApiException(404, 'Clinic not found.', code: 'CLINIC_NOT_FOUND');

    await pumpScreen(tester);
    await settle(tester);

    expect(find.text('Clinic not found'), findsOneWidget);
    expect(find.text("We couldn't load this clinic"), findsNothing);
    expect(find.byKey(const Key('clinic-detail-retry')), findsNothing);
  });

  testWidgets('tapping a doctor row navigates to /dental/doctor with both ids', (tester) async {
    stubClinicAndDoctors(doctors: [
      clinicDoctorJson(clinicDoctorId: 'cd1', doctorId: 'd1'),
    ]);

    await pumpScreen(tester, clinicId: 'c1');
    await settle(tester);

    await tester.tap(find.byKey(const Key('doctor-row-cd1')));
    await settle(tester);

    expect(lastRoute?.name, '/dental/doctor');
    expect(lastRoute?.arguments, {'doctorId': 'd1', 'clinicId': 'c1'});
    // The argument shape this route is designed for.
    expect(const DentalDoctorProfileScreen(doctorId: 'd1', clinicId: 'c1').doctorId, 'd1');
  });

  // Task-F1 review-fix round 1 parked a Minor specifically for whichever
  // screen first embeds `ClinicLocationMap` with the REAL Google adapter (not
  // clinic_location_map_test.dart's fake, which has no Semantics node of its
  // own and could not exercise this). That is this screen.
  group('the real map adapter, embedded in the actual clinic detail screen', () {
    late FakeGoogleMapsPlatform platform;

    setUp(() {
      // Google is opt-in since MapLibre became the default (2026-09-28).
      MapProviderConfig.debugOverride = MapProviderKind.google;
      addTearDown(() => MapProviderConfig.debugOverride = null);
      platform = FakeGoogleMapsPlatform.install();
      GoogleMarkerIcons.clearCache();
      GoogleMarkerIcons.debugRenderer =
          (tone, ratio) async => gm.BitmapDescriptor.bytes(Uint8List.fromList([tone.index, 7, 7]));
      addTearDown(() {
        GoogleMarkerIcons.debugRenderer = null;
        GoogleMarkerIcons.clearCache();
      });
    });

    testWidgets('builds exactly one real Google map, never the rider/delivery label', (tester) async {
      stubClinicAndDoctors();

      // No mapBuilder override: ClinicLocationMap gets the real adapter.
      await pumpScreen(tester, mapBuilder: null);
      await settle(tester);

      expect(platform.buildCount, 1);
      expect(tester.takeException(), isNull);
      // The generic rider/delivery phrase (google_map_view.dart's hardcoded
      // default) must never reach a clinic map - the exact defect task-F1's
      // fix round closed.
      final handle = tester.ensureSemantics();
      expect(find.bySemanticsLabel('Map showing the rider and your delivery address'), findsNothing);
      handle.dispose();
    });

    testWidgets('the semantics tree carries the clinic name, with no misleading text anywhere on the page',
        (tester) async {
      stubClinicAndDoctors();
      final handle = tester.ensureSemantics();

      await pumpScreen(tester, mapBuilder: null);
      await settle(tester);

      // The clinic name reaches assistive tech, and the wrong/generic
      // rider/delivery phrase never does anywhere on the page.
      expect(find.bySemanticsLabel('Smile Dental Clinic'), findsWidgets);
      expect(find.bySemanticsLabel('Map showing the rider and your delivery address'), findsNothing);

      // Confirmed exactly (not assumed) by dumping the real semantics tree
      // (`tester.binding.pipelineOwner.semanticsOwner!.rootSemanticsNode!.
      // toStringDeep()` while developing this test): FOUR separate
      // SemanticsNodes carry this exact label -
      //   1. the AppBar title Text("Smile Dental Clinic")
      //   2. the body heading Text("Smile Dental Clinic")
      //   3. the outer ClinicLocationMap `Semantics(label: ..., container:
      //      false)` wrapper, which - being non-boundary - merges UP into
      //      the ListView's own per-item semantics node for the map's list
      //      row (task-F1 review-fix round 1's documented mechanism)
      //   4. the inner Google adapter's own `Semantics(label: ...,
      //      container: true)` override (`google_map_view.dart`)
      // (1) and (2) are ordinary, correct duplication (an AppBar title
      // repeating the page's own heading is normal in this codebase -
      // OrderSummaryScreen shows its order number the same way). (3) and (4)
      // are task-F1's parked Minor: a screen reader swiping into the map row
      // hears "Smile Dental Clinic" twice in immediate succession. Both
      // instances say the same TRUE thing (never the wrong rider/delivery
      // phrase), so this is verbosity, not a misleading announcement - see
      // task-F2-report.md for the full verdict on closing this out.
      expect(find.bySemanticsLabel('Smile Dental Clinic'), findsNWidgets(4));

      expect(tester.takeException(), isNull);
      handle.dispose();
    });
  });
}
