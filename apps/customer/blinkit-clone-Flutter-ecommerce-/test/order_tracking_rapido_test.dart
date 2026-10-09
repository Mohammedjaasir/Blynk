import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:ecom/Models/order_model.dart';
import 'package:ecom/Models/rider_route_model.dart';
import 'package:ecom/Services/Providers/location.provider.dart';
import 'package:ecom/Services/Providers/rider_route.provider.dart';
import 'package:ecom/UI/Widgets/Organisms/map_provider.dart';
import 'package:ecom/UI/Widgets/Organisms/map_provider_config.dart';
import 'package:ecom/UI/Widgets/Organisms/order_tracking_map.dart';

import 'fixtures/order_fixtures.dart';

/// Rapido-style tracking on the order screen (owner, 2026-10-10): the
/// route-aware map seam, "Arriving in ~N min", hiding both when the route
/// cannot be had, "Call rider", the turning bike's heading, and the
/// full-screen map.

/// Records what it was asked to draw, including the route and whether it is
/// the interactive (full-screen) map.
class _FakeRoutedMap extends TrackingMapView {
  const _FakeRoutedMap({
    required this.initialCenter,
    required this.initialZoom,
    required this.markers,
    required this.route,
    required this.interactive,
  }) : super.constructor();

  @override
  final GeoPoint initialCenter;
  @override
  final double initialZoom;
  @override
  final Set<MapMarkerSpec> markers;
  final List<GeoPoint> route;
  final bool interactive;

  @override
  Widget build(BuildContext context) => const SizedBox.expand();
}

TrackingMapView _routedBuilder({
  required GeoPoint initialCenter,
  required double initialZoom,
  required Set<MapMarkerSpec> markers,
  required List<GeoPoint> route,
  required bool interactive,
}) =>
    _FakeRoutedMap(
      initialCenter: initialCenter,
      initialZoom: initialZoom,
      markers: markers,
      route: route,
      interactive: interactive,
    );

OrderModel _order({Map<String, dynamic>? contact}) => OrderModel.fromJson({
      ...orderJson(status: 'OUT_FOR_DELIVERY'),
      'delivery_latitude': '6.4351',
      'delivery_longitude': '80.0243',
      'rider_contact': contact,
    });

final RiderRoute _route = RiderRoute.tryParse({
  'coordinates': [
    [80.03, 6.44],
    [80.027, 6.438],
    [80.0243, 6.4351],
  ],
  'distance_m': 2400,
  'duration_s': 380,
  'computed_at': '2026-10-10T09:00:00.000Z',
})!;

class _Harness {
  _Harness({this.fail = false}) {
    location = LocationProvider(opener: (_) => stream.stream, now: () => clock, freshnessInterval: const Duration(seconds: 1));
    routes = RiderRouteProvider(
      fetcher: (_) async {
        fetches++;
        if (fail) throw Exception('503 ROUTING_UNAVAILABLE');
        return _route;
      },
      now: () => clock,
    );
  }

  final StreamController<String> stream = StreamController<String>();
  late final LocationProvider location;
  late final RiderRouteProvider routes;
  DateTime clock = DateTime.utc(2026, 10, 10, 9, 0, 0);
  bool fail;
  int fetches = 0;
  final opened = <String>[];
  bool openResult = true;

  void point(double lat, double lng, {Duration age = const Duration(seconds: 2)}) {
    final at = clock.subtract(age);
    stream.add('event: location\n'
        'data: {"latitude":$lat,"longitude":$lng,"accuracy":8,'
        '"captured_at":"${at.toIso8601String()}","received_at":"${at.toIso8601String()}"}\n\n');
  }

  void closed() => stream.add('event: closed\ndata: {"reason":"delivery_closed"}\n\n');

  bool open(String url) {
    opened.add(url);
    return openResult;
  }

  void dispose() {
    location.dispose();
    routes.dispose();
    stream.close();
  }
}

Future<_Harness> _pump(WidgetTester tester, OrderModel order, {bool fail = false}) async {
  final h = _Harness(fail: fail);
  h.location.watch(order.id);
  await tester.pumpWidget(
    MultiProvider(
      providers: [
        ChangeNotifierProvider<LocationProvider>.value(value: h.location),
        ChangeNotifierProvider<RiderRouteProvider>.value(value: h.routes),
      ],
      child: MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            child: OrderTrackingMap(order: order, routedMapBuilder: _routedBuilder, openLink: h.open),
          ),
        ),
      ),
    ),
  );
  await tester.pump();
  return h;
}

Future<void> _settle(WidgetTester tester) async {
  await tester.pump();
  await tester.pump();
  await tester.pump();
}

_FakeRoutedMap _inline(WidgetTester tester) => tester.widgetList<_FakeRoutedMap>(find.byType(_FakeRoutedMap)).first;

void _testTracking(String name, Future<void> Function(WidgetTester tester, List<_Harness> open) body) {
  testWidgets(name, (tester) async {
    MapProviderConfig.debugOverride = MapProviderKind.maplibre;
    final open = <_Harness>[];
    try {
      await body(tester, open);
    } finally {
      await tester.pumpWidget(const SizedBox());
      for (final h in open) {
        h.dispose();
      }
      MapProviderConfig.debugOverride = null;
    }
  });
}

void main() {
  _testTracking('a live rider: the route line and "Arriving in ~7 min" come from the backend route', (tester, open) async {
    final h = await _pump(tester, _order(contact: {'first_name': 'Kamal', 'phone': '+94770000001'}));
    open.add(h);
    expect(_inline(tester).route, isEmpty);
    expect(find.textContaining('Arriving'), findsNothing);

    h.point(6.44, 80.03);
    await _settle(tester);
    expect(h.fetches, 1);
    expect(_inline(tester).route, [const GeoPoint(6.44, 80.03), const GeoPoint(6.438, 80.027), const GeoPoint(6.4351, 80.0243)]);
    expect(find.text('Arriving in ~7 min'), findsOneWidget);
    expect(find.text('Kamal is on the way'), findsOneWidget);
    expect(_inline(tester).interactive, isFalse);
  });

  _testTracking('the routing engine down: no line and no time, never a guess', (tester, open) async {
    final h = await _pump(tester, _order(contact: {'first_name': 'Kamal', 'phone': '+94770000001'}), fail: true);
    open.add(h);
    h.point(6.44, 80.03);
    await _settle(tester);
    expect(h.fetches, 1);
    expect(_inline(tester).route, isEmpty);
    expect(find.textContaining('Arriving'), findsNothing);
    expect(find.textContaining(RegExp(r'\bmin\b')), findsNothing);
    // The rest of the card still works.
    expect(find.text('Kamal is on the way'), findsOneWidget);
    expect(find.byKey(const Key('call-rider')), findsOneWidget);
  });

  _testTracking('a stale rider keeps the line but loses the time (a time from an old position would be made up)', (tester, open) async {
    final h = await _pump(tester, _order());
    open.add(h);
    h.point(6.44, 80.03);
    await _settle(tester);
    expect(find.text('Arriving in ~7 min'), findsOneWidget);

    h.clock = h.clock.add(const Duration(seconds: 40)); // past the live window
    await tester.pump(const Duration(seconds: 1));
    await _settle(tester);
    expect(_inline(tester).markers.singleWhere((m) => m.id == 'rider').tone, MapMarkerTone.riderStale);
    expect(_inline(tester).route, isNotEmpty);
    expect(find.textContaining('Arriving'), findsNothing);
  });

  _testTracking('the rider marker carries the travel heading for the turning bike', (tester, open) async {
    final h = await _pump(tester, _order());
    open.add(h);
    h.point(6.4400, 80.0300);
    await _settle(tester);
    expect(_inline(tester).markers.singleWhere((m) => m.id == 'rider').heading, isNull);

    h.clock = h.clock.add(const Duration(seconds: 5));
    h.point(6.4400, 80.0306); // ~66 m east
    await _settle(tester);
    expect(_inline(tester).markers.singleWhere((m) => m.id == 'rider').heading, closeTo(90, 0.5));
  });

  _testTracking('no contact from the backend: no name, no call button', (tester, open) async {
    final h = await _pump(tester, _order());
    open.add(h);
    h.point(6.44, 80.03);
    await _settle(tester);
    expect(find.byKey(const Key('call-rider')), findsNothing);
    expect(find.textContaining('Kamal'), findsNothing);
  });

  _testTracking('"Call rider" opens tel: with the rider phone', (tester, open) async {
    final h = await _pump(tester, _order(contact: {'first_name': 'Kamal', 'phone': '+94770000001'}));
    open.add(h);
    await tester.ensureVisible(find.byKey(const Key('call-rider')));
    await tester.tap(find.byKey(const Key('call-rider')));
    await tester.pump();
    expect(h.opened, ['tel:+94770000001']);
    expect(find.byType(SnackBar), findsNothing);
  });

  _testTracking('"Call rider" where a link cannot open copies the number and says so', (tester, open) async {
    String? copied;
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform, (call) async {
      if (call.method == 'Clipboard.setData') copied = (call.arguments as Map)['text'] as String?;
      return null;
    });
    addTearDown(() => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform, null));
    final h = await _pump(tester, _order(contact: {'first_name': null, 'phone': '+94770000001'}));
    open.add(h);
    h.openResult = false;
    expect(find.text('Your rider is on the way'), findsOneWidget);
    await tester.ensureVisible(find.byKey(const Key('call-rider')));
    await tester.tap(find.byKey(const Key('call-rider')));
    await tester.pump();
    expect(copied, '+94770000001');
    expect(find.text('Number copied: +94770000001'), findsOneWidget);
  });

  _testTracking('a tap on the map opens it full screen (interactive, same route and card); back returns', (tester, open) async {
    final h = await _pump(tester, _order(contact: {'first_name': 'Kamal', 'phone': '+94770000001'}));
    open.add(h);
    h.point(6.44, 80.03);
    await _settle(tester);

    await tester.tap(find.byKey(const Key('order-tracking-map-tap')));
    await tester.pumpAndSettle();
    final full = find.descendant(of: find.byKey(const Key('order-tracking-full-map')), matching: find.byType(_FakeRoutedMap));
    expect(full, findsOneWidget);
    final fullMap = tester.widget<_FakeRoutedMap>(full);
    expect(fullMap.interactive, isTrue);
    expect(fullMap.route, hasLength(3));
    expect(fullMap.markers.any((m) => m.id == 'rider'), isTrue);
    final card = find.byKey(const Key('order-tracking-full-card'));
    expect(find.descendant(of: card, matching: find.text('Arriving in ~7 min')), findsOneWidget);
    expect(find.descendant(of: card, matching: find.byKey(const Key('call-rider'))), findsOneWidget);
    expect(find.descendant(of: card, matching: find.textContaining('BL-20260919-4821')), findsOneWidget);

    await tester.tap(find.byKey(const Key('order-tracking-full-back')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('order-tracking-full-map')), findsNothing);
    expect(find.byKey(const Key('order-tracking-map-frame')), findsOneWidget);
  });

  _testTracking('the "Full map" button opens it too, and the full screen closes itself when the server ends tracking', (tester, open) async {
    final h = await _pump(tester, _order());
    open.add(h);
    h.point(6.44, 80.03);
    await _settle(tester);
    await tester.tap(find.byKey(const Key('order-tracking-full-screen')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('order-tracking-full-map')), findsOneWidget);

    h.closed();
    await _settle(tester);
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('order-tracking-full-map')), findsNothing);
  });

  testWidgets('without a RiderRouteProvider in the tree the map simply has no route and no time', (tester) async {
    final stream = StreamController<String>();
    final location = LocationProvider(opener: (_) => stream.stream);
    location.watch('x');
    await tester.pumpWidget(
      ChangeNotifierProvider<LocationProvider>.value(
        value: location,
        child: MaterialApp(
          home: Scaffold(body: SingleChildScrollView(child: OrderTrackingMap(order: _order(), routedMapBuilder: _routedBuilder))),
        ),
      ),
    );
    await tester.pump();
    expect(_inline(tester).route, isEmpty);
    expect(find.textContaining('Arriving'), findsNothing);
    await tester.pumpWidget(const SizedBox());
    location.dispose();
    unawaited(stream.close());
  });
}
