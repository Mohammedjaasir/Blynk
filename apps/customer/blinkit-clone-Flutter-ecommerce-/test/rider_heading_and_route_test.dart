import 'dart:async';

import 'package:flutter_test/flutter_test.dart';

import 'package:ecom/Models/order_model.dart';
import 'package:ecom/Models/rider_heading.dart';
import 'package:ecom/Models/rider_route_model.dart';
import 'package:ecom/Services/Providers/location.provider.dart';
import 'package:ecom/Services/Providers/rider_route.provider.dart';
import 'package:ecom/UI/Widgets/Organisms/map_marker_logic.dart';
import 'package:ecom/UI/Widgets/Organisms/map_provider.dart';

import 'fixtures/order_fixtures.dart';

/// Rapido-style tracking (owner, 2026-10-10): the bike's heading from
/// consecutive fixes, the backend route + "Arriving in" text, the route
/// provider's polling rules, and the rider contact on the order.
void main() {
  group('heading from consecutive points', () {
    test('bearingDegrees: north, east, south, west', () {
      expect(bearingDegrees(6.40, 80.00, 6.41, 80.00), closeTo(0, 0.01));
      expect(bearingDegrees(6.40, 80.00, 6.40, 80.01), closeTo(90, 0.1));
      expect(bearingDegrees(6.41, 80.00, 6.40, 80.00), closeTo(180, 0.01));
      expect(bearingDegrees(6.40, 80.01, 6.40, 80.00), closeTo(270, 0.1));
    });

    test('lerpAngle turns the short way round through north', () {
      expect(lerpAngle(350, 10, 0.5), closeTo(0, 1e-9));
      expect(lerpAngle(10, 350, 0.5), closeTo(0, 1e-9));
      expect(lerpAngle(90, 180, 0.5), closeTo(135, 1e-9));
      expect(angleDelta(350, 10), closeTo(20, 1e-9));
      expect(angleDelta(10, 350), closeTo(-20, 1e-9));
    });

    String frame(double lat, double lng, DateTime at) => 'event: location\n'
        'data: {"latitude":$lat,"longitude":$lng,"accuracy":8,'
        '"captured_at":"${at.toIso8601String()}","received_at":"${at.toIso8601String()}"}\n\n';

    test('LocationProvider.heading: null until a real move, the travel bearing after, unchanged by jitter, reset by a new watch', () async {
      final stream = StreamController<String>();
      var clock = DateTime.utc(2026, 10, 10, 9);
      final p = LocationProvider(opener: (_) => stream.stream, now: () => clock);
      addTearDown(() {
        p.dispose();
        stream.close();
      });
      p.watch('order-1');
      await Future<void>.delayed(Duration.zero);

      stream.add(frame(6.4000, 80.0000, clock));
      await Future<void>.delayed(Duration.zero);
      expect(p.current, isNotNull);
      expect(p.heading, isNull, reason: 'one point has no direction');

      clock = clock.add(const Duration(seconds: 5));
      stream.add(frame(6.4000, 80.0005, clock)); // ~55 m east
      await Future<void>.delayed(Duration.zero);
      expect(p.heading, closeTo(90, 0.5));

      clock = clock.add(const Duration(seconds: 5));
      stream.add(frame(6.40002, 80.0005, clock)); // ~2 m north: GPS jitter
      await Future<void>.delayed(Duration.zero);
      expect(p.heading, closeTo(90, 0.5), reason: 'jitter below the threshold never spins the bike');

      clock = clock.add(const Duration(seconds: 5));
      stream.add(frame(6.4005, 80.0005, clock)); // ~55 m north
      await Future<void>.delayed(Duration.zero);
      expect(p.heading, closeTo(0, 3));

      p.stopWatching();
      expect(p.heading, isNull);
    });

    test('MarkerMotion eases the heading over the glide and never snaps it mid-move', () {
      final m = MarkerMotion();
      const a = GeoPoint(6.4, 80.0);
      const b = GeoPoint(6.4001, 80.0);
      m.retarget({const MapMarkerSpec(id: 'rider', position: a, tone: MapMarkerTone.riderLive, heading: 350)}, snapAll: true);
      final wanted = {const MapMarkerSpec(id: 'rider', position: b, tone: MapMarkerTone.riderLive, heading: 30)};
      expect(m.retarget(wanted), isTrue);
      m.tick(0.5);
      expect(m.shownSpecs(wanted).single.heading, closeTo(10, 1e-9)); // 350 -> 30 through north
      m.tick(1);
      expect(m.shownSpecs(wanted).single.heading, closeTo(30, 1e-9));
    });

    test('MarkerMotion: a heading-only change still animates; no heading stays null', () {
      final m = MarkerMotion();
      const a = GeoPoint(6.4, 80.0);
      m.retarget({const MapMarkerSpec(id: 'rider', position: a, tone: MapMarkerTone.riderLive, heading: 0)}, snapAll: true);
      expect(m.retarget({const MapMarkerSpec(id: 'rider', position: a, tone: MapMarkerTone.riderLive, heading: 90)}), isTrue);
      final none = {const MapMarkerSpec(id: 'destination', position: a, tone: MapMarkerTone.destination)};
      m.retarget(none, snapAll: true);
      expect(m.shownSpecs(none).single.heading, isNull);
    });
  });

  group('RiderRoute and the "Arriving in" text', () {
    final json = {
      'coordinates': [
        [80.03, 6.44],
        [80.025, 6.437],
        [80.0243, 6.4351],
      ],
      'distance_m': 2400,
      'duration_s': 380,
      'computed_at': '2026-10-10T09:00:00.000Z',
    };

    test('parses [lng, lat] pairs into (lat, lng) points', () {
      final r = RiderRoute.tryParse(json)!;
      expect(r.points.first, (6.44, 80.03));
      expect(r.points, hasLength(3));
      expect(r.distanceMeters, 2400);
      expect(r.durationSeconds, 380);
    });

    test('anything malformed is no route at all, never half a route', () {
      expect(RiderRoute.tryParse(null), isNull);
      expect(RiderRoute.tryParse({...json, 'duration_s': null}), isNull);
      expect(RiderRoute.tryParse({...json, 'coordinates': [[80.03, 6.44]]}), isNull);
      expect(RiderRoute.tryParse({...json, 'coordinates': [[80.03, 6.44], ['x', 6.4]]}), isNull);
      expect(RiderRoute.tryParse({...json, 'coordinates': [[80.03, 96.44], [80.0, 6.4]]}), isNull);
      expect(RiderRoute.tryParse({...json, 'computed_at': 'soon'}), isNull);
    });

    test('arrivingText rounds up to whole minutes, never below 1', () {
      expect(arrivingText(380), 'Arriving in ~7 min');
      expect(arrivingText(360), 'Arriving in ~6 min');
      expect(arrivingText(61), 'Arriving in ~2 min');
      expect(arrivingText(40), 'Arriving in ~1 min');
      expect(arrivingText(0), 'Arriving in ~1 min');
    });
  });

  group('RiderRouteProvider polling', () {
    final route = RiderRoute.tryParse({
      'coordinates': [
        [80.03, 6.44],
        [80.0243, 6.4351],
      ],
      'distance_m': 900,
      'duration_s': 150,
      'computed_at': '2026-10-10T09:00:00.000Z',
    })!;

    test('fetches only for a live rider, then at most once per refresh interval', () async {
      var clock = DateTime(2026, 10, 10, 9);
      var calls = 0;
      final p = RiderRouteProvider(fetcher: (_) async {
        calls++;
        return route;
      }, now: () => clock);
      addTearDown(p.dispose);

      p.refreshIfDue(riderLive: true);
      expect(calls, 0, reason: 'nothing is watched yet');
      p.watch('order-1');
      p.refreshIfDue(riderLive: false);
      expect(calls, 0, reason: 'no time from a stale or missing rider');
      p.refreshIfDue(riderLive: true);
      await Future<void>.delayed(Duration.zero);
      expect(calls, 1);
      expect(p.route, same(route));

      clock = clock.add(const Duration(seconds: 10));
      p.refreshIfDue(riderLive: true);
      expect(calls, 1, reason: 'inside the 25 s interval');
      clock = clock.add(const Duration(seconds: 16));
      p.refreshIfDue(riderLive: true);
      await Future<void>.delayed(Duration.zero);
      expect(calls, 2);
    });

    test('a failure clears the route (line and time hidden) and is retried only after the back-off', () async {
      var clock = DateTime(2026, 10, 10, 9);
      var fail = false;
      var calls = 0;
      final p = RiderRouteProvider(fetcher: (_) async {
        calls++;
        if (fail) throw Exception('503 ROUTING_UNAVAILABLE');
        return route;
      }, now: () => clock);
      addTearDown(p.dispose);
      p.watch('order-1');
      p.refreshIfDue(riderLive: true);
      await Future<void>.delayed(Duration.zero);
      expect(p.route, isNotNull);

      fail = true;
      clock = clock.add(const Duration(seconds: 26));
      p.refreshIfDue(riderLive: true);
      await Future<void>.delayed(Duration.zero);
      expect(p.route, isNull);

      clock = clock.add(const Duration(seconds: 30));
      p.refreshIfDue(riderLive: true);
      expect(calls, 2, reason: 'failure back-off is 60 s');
      fail = false;
      clock = clock.add(const Duration(seconds: 31));
      p.refreshIfDue(riderLive: true);
      await Future<void>.delayed(Duration.zero);
      expect(calls, 3);
      expect(p.route, isNotNull);
    });

    test('a null answer (no rider point on the server) is no route', () async {
      final p = RiderRouteProvider(fetcher: (_) async => null);
      addTearDown(p.dispose);
      p.watch('order-1');
      p.refreshIfDue(riderLive: true);
      await Future<void>.delayed(Duration.zero);
      expect(p.route, isNull);
    });

    test('a late answer for a watch that was stopped is discarded', () async {
      final gate = Completer<RiderRoute?>();
      final p = RiderRouteProvider(fetcher: (_) => gate.future);
      addTearDown(p.dispose);
      p.watch('order-1');
      p.refreshIfDue(riderLive: true);
      p.stopWatching('order-1');
      gate.complete(route);
      await Future<void>.delayed(Duration.zero);
      expect(p.route, isNull);
      expect(p.orderId, isNull);
    });

    test('stopWatching another order id does not stop the current watch', () {
      final p = RiderRouteProvider(fetcher: (_) async => route);
      addTearDown(p.dispose);
      p.watch('order-2');
      p.stopWatching('order-1');
      expect(p.orderId, 'order-2');
    });
  });

  group('OrderModel.riderContact', () {
    test('parses the first name and phone; null without a phone or outside the window', () {
      final on = OrderModel.fromJson({
        ...orderJson(status: 'OUT_FOR_DELIVERY'),
        'rider_contact': {'first_name': 'Kamal', 'phone': '+94770000001'},
      });
      expect(on.riderContact!.firstName, 'Kamal');
      expect(on.riderContact!.phone, '+94770000001');

      final noName = OrderModel.fromJson({
        ...orderJson(status: 'OUT_FOR_DELIVERY'),
        'rider_contact': {'first_name': null, 'phone': '+94770000001'},
      });
      expect(noName.riderContact!.firstName, isNull);

      expect(OrderModel.fromJson({...orderJson(status: 'DELIVERED'), 'rider_contact': null}).riderContact, isNull);
      expect(OrderModel.fromJson({...orderJson(status: 'OUT_FOR_DELIVERY'), 'rider_contact': {'first_name': 'K'}}).riderContact, isNull);
      expect(OrderModel.fromJson(orderJson(status: 'OUT_FOR_DELIVERY')).riderContact, isNull);
    });
  });
}
