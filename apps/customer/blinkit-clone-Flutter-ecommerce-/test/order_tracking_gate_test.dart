import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:ecom/Models/order_model.dart';
import 'package:ecom/Screens/order_summary_screen.dart';
import 'package:ecom/Services/Exceptions/api_exception.dart';
import 'package:ecom/Services/Providers/location.provider.dart';
import 'package:ecom/Services/Providers/order.provider.dart';
import 'package:ecom/UI/Widgets/Organisms/map_provider.dart';
import 'package:ecom/UI/Widgets/Organisms/order_tracking_map.dart';
import 'package:ecom/app_theme.dart';
import 'package:ecom/main.dart' show buildAppProviders;

import 'fixtures/order_fixtures.dart';
import 'fixtures/tracking_fakes.dart';

const _id = 'c0000001-0000-0000-0000-000000000001';
const _otherId = 'c0000002-0000-0000-0000-000000000002';
const _getKey = 'GET /orders/$_id';

/// Order JSON at [status] with a delivery block at [assignment] (null = no
/// delivery block at all) and destination coordinates, so OrderTrackingMap
/// actually builds its map (the fake one, via the screen's test seam).
Map<String, dynamic> _json({
  String status = 'OUT_FOR_DELIVERY',
  String? assignment = 'PICKED_UP',
  String id = _id,
}) =>
    {
      ...orderJson(
        id: id,
        status: status,
        delivery: assignment == null ? null : {'assignment_status': assignment},
      ),
      'delivery_latitude': '6.4382',
      'delivery_longitude': '80.0274',
    };

Map<String, dynamic> _envelope(Map<String, dynamic> order) => {
      'success': true,
      'data': {'order': order},
    };

OrderModel _order({String status = 'OUT_FOR_DELIVERY', String? assignment = 'PICKED_UP'}) =>
    OrderModel.fromJson(_json(status: status, assignment: assignment));

class _FakeOrdersApi {
  final calls = <String>[];
  final Map<String, Future<Object?> Function()> routes = {};

  Future<dynamic> call(String method, String url, {Object? body, Map<String, dynamic>? query}) async {
    final key = '$method $url';
    calls.add(key);
    final route = routes[key];
    if (route == null) throw ApiException(404, 'Order not found.', code: 'ORDER_NOT_FOUND');
    final value = await route();
    if (value is ApiException) throw value;
    return value;
  }

  int countOf(String key) => calls.where((c) => c == key).length;

  void serve(Map<String, dynamic> order) => routes[_getKey] = () async => _envelope(order);
}

Future<void> _pump(WidgetTester tester, _FakeOrdersApi api, SpyLocationProvider location) async {
  tester.view.physicalSize = const Size(400, 2000);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);

  await tester.pumpWidget(
    MultiProvider(
      providers: [
        ChangeNotifierProvider<OrderProvider>.value(value: OrderProvider(request: api.call)),
        ChangeNotifierProvider<LocationProvider>.value(value: location),
      ],
      child: MaterialApp(
        theme: AppTheme.appTHeme,
        // These tests count refetches around the live stream, so the 20 s
        // auto-refresh (covered in order_progress_test.dart) is off here.
        home: const OrderSummaryScreen(orderId: _id, mapBuilder: fakeMapBuilder, autoRefresh: false),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

/// A foreground refetch that never touches the watch on its own: `inactive`
/// (notification shade, a system dialog) -> `resumed`.
Future<void> _refresh(WidgetTester tester) async {
  tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
  tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
  await tester.pumpAndSettle();
}

/// A stream event reaches the provider in a microtask that runs after the
/// frame pump, so a second pump is needed for the map's Consumer to rebuild.
Future<void> _settle(WidgetTester tester) async {
  await tester.pump();
  await tester.pump();
}

Future<void> _unmount(WidgetTester tester) async {
  await tester.pumpWidget(const SizedBox());
  await tester.pumpAndSettle();
}

Set<MapMarkerSpec> _markersOnScreen(WidgetTester tester) =>
    tester.widget<FakeTrackingMap>(find.byType(FakeTrackingMap)).markers;

void main() {
  late _FakeOrdersApi api;
  late SpyLocationProvider location;

  setUp(() {
    api = _FakeOrdersApi();
    location = SpyLocationProvider();
  });

  group('isLiveTrackable (pure gate)', () {
    test('true only for OUT_FOR_DELIVERY with a PICKED_UP delivery', () {
      expect(isLiveTrackable(_order()), isTrue);
    });

    test('false in every other combination the backend can produce', () {
      final cases = <String, OrderModel>{
        'PLACED, no delivery': _order(status: 'PLACED', assignment: null),
        'PACKED, no delivery': _order(status: 'PACKED', assignment: null),
        'PACKED + ASSIGNED': _order(status: 'PACKED', assignment: 'ASSIGNED'),
        'OUT_FOR_DELIVERY + ASSIGNED': _order(assignment: 'ASSIGNED'),
        'OUT_FOR_DELIVERY + ARRIVED_AT_CUSTOMER': _order(assignment: 'ARRIVED_AT_CUSTOMER'),
        'OUT_FOR_DELIVERY + DELIVERED': _order(assignment: 'DELIVERED'),
        'OUT_FOR_DELIVERY + FAILED': _order(assignment: 'FAILED'),
        'OUT_FOR_DELIVERY + missing delivery': _order(assignment: null),
        'OUT_FOR_DELIVERY + lower-case value': _order(assignment: 'picked_up'),
        'DELIVERED + PICKED_UP (stale delivery)': _order(status: 'DELIVERED', assignment: 'PICKED_UP'),
        'FAILED + PICKED_UP': _order(status: 'FAILED', assignment: 'PICKED_UP'),
        'CANCELLED + PICKED_UP': _order(status: 'CANCELLED', assignment: 'PICKED_UP'),
        'PACKED + PICKED_UP': _order(status: 'PACKED', assignment: 'PICKED_UP'),
        'unknown status + PICKED_UP': _order(status: 'SOMETHING_NEW', assignment: 'PICKED_UP'),
      };
      cases.forEach((name, order) => expect(isLiveTrackable(order), isFalse, reason: name));
    });
  });

  group('the map only exists in the trackable window', () {
    testWidgets('shown at OUT_FOR_DELIVERY + PICKED_UP, between the header and the timeline',
        (tester) async {
      api.serve(_json());
      await _pump(tester, api, location);

      expect(find.byType(OrderTrackingMap), findsOneWidget);
      expect(find.byKey(const Key('fake-map')), findsOneWidget);

      double top(Finder f) => tester.getTopLeft(f).dy;
      final header = top(find.byKey(const Key('order-status-header')));
      final map = top(find.byType(OrderTrackingMap));
      final timeline = top(find.byKey(const Key('order-timeline')));
      expect(header, lessThan(map));
      expect(map, lessThan(timeline));

      await _unmount(tester);
    });

    final untrackable = <String, Map<String, dynamic>>{
      'PACKED (not yet picked up)': _json(status: 'PACKED', assignment: null),
      'PACKED + ASSIGNED': _json(status: 'PACKED', assignment: 'ASSIGNED'),
      'OUT_FOR_DELIVERY + ASSIGNED': _json(assignment: 'ASSIGNED'),
      'OUT_FOR_DELIVERY + ARRIVED_AT_CUSTOMER': _json(assignment: 'ARRIVED_AT_CUSTOMER'),
      'OUT_FOR_DELIVERY + missing delivery': _json(assignment: null),
      'DELIVERED': _json(status: 'DELIVERED', assignment: 'DELIVERED'),
      'FAILED': _json(status: 'FAILED', assignment: 'FAILED'),
      'CANCELLED': _json(status: 'CANCELLED', assignment: null),
    };
    untrackable.forEach((name, json) {
      testWidgets('not shown, nothing watched: $name', (tester) async {
        api.serve(json);
        await _pump(tester, api, location);

        expect(find.byType(OrderTrackingMap), findsNothing);
        expect(find.byKey(const Key('fake-map')), findsNothing);
        expect(location.calls, isEmpty);
        expect(location.opened, isEmpty);
      });
    });
  });

  group('watch lifecycle', () {
    testWidgets('watch is called exactly once, with the order id, across several refreshes',
        (tester) async {
      api.serve(_json());
      await _pump(tester, api, location);
      expect(location.calls, ['watch:$_id']);

      await _refresh(tester);
      await _refresh(tester);
      await _refresh(tester);

      expect(api.countOf(_getKey), 4);
      expect(location.calls, ['watch:$_id']);
      expect(location.opened, [_id]);

      await _unmount(tester);
    });

    testWidgets('a live point survives refreshes (watch is not re-called, state is not reset)',
        (tester) async {
      api.serve(_json());
      await _pump(tester, api, location);
      location.sendPoint();
      await _settle(tester);
      expect(_markersOnScreen(tester).map((m) => m.id), containsAll(['destination', 'rider']));

      await _refresh(tester);

      expect(location.watchCount, 1);
      expect(_markersOnScreen(tester).map((m) => m.id), containsAll(['destination', 'rider']));

      await _unmount(tester);
    });

    testWidgets('stopWatching when a later refresh says the order is no longer trackable',
        (tester) async {
      api.serve(_json());
      await _pump(tester, api, location);
      expect(location.calls, ['watch:$_id']);

      api.serve(_json(status: 'DELIVERED', assignment: 'DELIVERED'));
      await _refresh(tester);

      expect(find.byType(OrderTrackingMap), findsNothing);
      expect(location.calls, ['watch:$_id', 'stop']);
    });

    testWidgets('stopWatching on dispose', (tester) async {
      api.serve(_json());
      await _pump(tester, api, location);
      expect(location.stopCount, 0);

      await _unmount(tester);

      expect(location.calls, ['watch:$_id', 'stop']);
    });

    testWidgets('dispose without ever watching does not call stopWatching', (tester) async {
      api.serve(_json(status: 'PACKED', assignment: null));
      await _pump(tester, api, location);
      await _unmount(tester);
      expect(location.calls, isEmpty);
    });

    testWidgets('a different order id: the old watch is stopped and a new one started', (tester) async {
      api.serve(_json());
      await _pump(tester, api, location);

      api.serve(_json(id: _otherId));
      await _refresh(tester);

      expect(location.calls, ['watch:$_id', 'stop', 'watch:$_otherId']);
      expect(location.opened, [_id, _otherId]);

      await _unmount(tester);
    });

    group('app lifecycle', () {
      testWidgets('going to the background (inactive -> hidden -> paused) stops the watch once',
          (tester) async {
        api.serve(_json());
        await _pump(tester, api, location);

        tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
        tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.hidden);
        tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
        await tester.pump();

        expect(location.calls, ['watch:$_id', 'stop']);
      });

      testWidgets('hidden alone (the state before paused) stops the watch', (tester) async {
        api.serve(_json());
        await _pump(tester, api, location);

        tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
        tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.hidden);
        await tester.pump();

        expect(location.calls, ['watch:$_id', 'stop']);
      });

      testWidgets('inactive alone (still visible: shade, dialog) keeps the watch', (tester) async {
        api.serve(_json());
        await _pump(tester, api, location);

        tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
        await tester.pump();

        expect(location.calls, ['watch:$_id']);
        tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
        await tester.pumpAndSettle();
        await _unmount(tester);
      });

      testWidgets('resuming refetches and, if still trackable, starts a FRESH watch', (tester) async {
        api.serve(_json());
        await _pump(tester, api, location);
        location.sendPoint();
        await tester.pump();

        tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
        await tester.pump();
        expect(location.current, isNull, reason: 'stopWatching cleared the point');

        tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
        await tester.pumpAndSettle();

        expect(api.countOf(_getKey), 2);
        expect(location.calls, ['watch:$_id', 'stop', 'watch:$_id']);
        expect(location.current, isNull);

        await _unmount(tester);
      });

      testWidgets('resuming when the order left the trackable state does not re-watch', (tester) async {
        api.serve(_json());
        await _pump(tester, api, location);

        tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
        await tester.pump();
        api.serve(_json(status: 'DELIVERED', assignment: 'DELIVERED'));
        tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
        await tester.pumpAndSettle();

        expect(location.calls, ['watch:$_id', 'stop']);
        expect(find.byType(OrderTrackingMap), findsNothing);
      });

      testWidgets('a failed refetch on resume still re-watches the (stale but trackable) order',
          (tester) async {
        api.serve(_json());
        await _pump(tester, api, location);

        tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
        await tester.pump();
        api.routes[_getKey] = () async => ApiException(503, 'Network unreachable.', code: 'NETWORK_ERROR');
        tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
        await tester.pumpAndSettle();

        expect(location.calls, ['watch:$_id', 'stop', 'watch:$_id']);
        expect(find.byType(OrderTrackingMap), findsOneWidget);

        await _unmount(tester);
      });

      testWidgets('a fetch that lands while backgrounded never opens a watch', (tester) async {
        api.serve(_json(status: 'PACKED', assignment: 'ASSIGNED'));
        await _pump(tester, api, location);
        expect(location.calls, isEmpty);

        final gate = Completer<void>();
        api.routes[_getKey] = () async {
          await gate.future;
          return _envelope(_json());
        };
        tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
        tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
        await tester.pump(); // fetch in flight...
        tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
        await tester.pump();
        gate.complete(); // ...answers while the app is in the background
        await tester.pumpAndSettle();

        // (Flutter draws no frames while paused, so the widget tree is not
        // inspected here; the point is that no connection was opened.)
        expect(api.countOf(_getKey), 2);
        expect(location.calls, isEmpty, reason: 'no connection is opened in the background');

        api.serve(_json());
        tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
        await tester.pumpAndSettle();
        expect(location.calls, ['watch:$_id']);
        expect(find.byType(OrderTrackingMap), findsOneWidget);

        await _unmount(tester);
      });
    });

    testWidgets('failed -> re-staged -> new delivery: a FRESH watch, nothing from the first survives',
        (tester) async {
      api.serve(_json());
      await _pump(tester, api, location);
      location.sendPoint(lat: 6.5, lng: 80.1);
      await _settle(tester);
      expect(_markersOnScreen(tester).map((m) => m.id), containsAll(['destination', 'rider']));
      expect(location.current, isNotNull);

      // Delivery failed: the order leaves the trackable state.
      api.serve(_json(status: 'FAILED', assignment: 'FAILED'));
      await _refresh(tester);
      expect(find.byType(OrderTrackingMap), findsNothing);
      expect(location.calls, ['watch:$_id', 'stop']);
      expect(location.current, isNull);

      // Re-staged (PACKED again, new ASSIGNED delivery): still no map.
      api.serve(_json(status: 'PACKED', assignment: 'ASSIGNED'));
      await _refresh(tester);
      expect(find.byType(OrderTrackingMap), findsNothing);

      // A new rider picks it up: trackable again.
      api.serve(_json());
      await _refresh(tester);

      expect(find.byType(OrderTrackingMap), findsOneWidget);
      expect(location.calls, ['watch:$_id', 'stop', 'watch:$_id']);
      expect(location.opened, [_id, _id], reason: 'a second, separate stream');
      expect(location.current, isNull, reason: "the first delivery's point did not survive");
      // The widget shows only the destination and the "unavailable" caption,
      // never the earlier rider position.
      expect(_markersOnScreen(tester).map((m) => m.id), ['destination']);
      expect(find.text('Live location unavailable right now.'), findsOneWidget);

      await _unmount(tester);
    });
  });

  group('server close refreshes the order', () {
    testWidgets('closed -> exactly one extra fetch; a non-trackable answer removes the map and stops',
        (tester) async {
      api.serve(_json());
      await _pump(tester, api, location);
      expect(api.countOf(_getKey), 1);

      api.serve(_json(status: 'DELIVERED', assignment: 'DELIVERED'));
      location.sendClosed();
      await tester.pumpAndSettle();

      expect(api.countOf(_getKey), 2, reason: 'one guarded refetch');
      expect(find.byType(OrderTrackingMap), findsNothing);
      expect(location.calls, ['watch:$_id', 'stop']);
      expect(location.closed, isFalse, reason: 'stopWatching reset the provider');
      expect(
        find.descendant(
          of: find.byKey(const Key('order-status-header')),
          matching: find.text('Delivered'),
        ),
        findsOneWidget,
      );
    });

    testWidgets('closed while the order still reads trackable: one refetch, no loop, no re-watch',
        (tester) async {
      api.serve(_json());
      await _pump(tester, api, location);

      // The refetch (a moment behind the backend) still says PICKED_UP.
      location.sendClosed();
      await tester.pumpAndSettle();
      expect(api.countOf(_getKey), 2);
      expect(location.closed, isTrue);
      expect(find.byType(OrderTrackingMap), findsOneWidget);

      // Time passing, more frames and further notifications from the (still
      // closed) provider must not refetch or re-watch.
      location.poke();
      location.poke();
      await tester.pump(const Duration(minutes: 2));
      await tester.pumpAndSettle();
      expect(api.countOf(_getKey), 2);
      expect(location.calls, ['watch:$_id']);

      await _unmount(tester);
    });

    testWidgets('a failing close-triggered refetch is not retried', (tester) async {
      api.serve(_json());
      await _pump(tester, api, location);

      api.routes[_getKey] = () async => ApiException(503, 'Network unreachable.', code: 'NETWORK_ERROR');
      location.sendClosed();
      await tester.pumpAndSettle();

      expect(api.countOf(_getKey), 2);
      await tester.pump(const Duration(minutes: 2));
      expect(api.countOf(_getKey), 2);

      await _unmount(tester);
    });

    testWidgets('a rider point alone never refetches the order', (tester) async {
      api.serve(_json());
      await _pump(tester, api, location);

      location.sendPoint();
      await _settle(tester);
      location.sendPoint(lat: 6.51);
      await _settle(tester);

      expect(api.countOf(_getKey), 1);

      await _unmount(tester);
    });
  });

  group('LocationProvider is registered in the app provider tree', () {
    test('buildAppProviders includes a ChangeNotifierProvider<LocationProvider>', () {
      final providers = buildAppProviders();
      expect(providers.whereType<ChangeNotifierProvider<LocationProvider>>(), hasLength(1));
      expect(providers.whereType<ChangeNotifierProvider<OrderProvider>>(), hasLength(1));
    });

    testWidgets('it can be read from the tree and is disposed with it', (tester) async {
      final entry = buildAppProviders().whereType<ChangeNotifierProvider<LocationProvider>>().single;
      late LocationProvider read;
      await tester.pumpWidget(
        MultiProvider(
          providers: [entry],
          child: Builder(builder: (context) {
            read = context.read<LocationProvider>();
            return const SizedBox();
          }),
        ),
      );
      expect(read.current, isNull);

      await tester.pumpWidget(const SizedBox());

      // A disposed ChangeNotifier refuses new listeners: proof the provider
      // tree (not the screen) owns and disposed it.
      expect(() => read.addListener(() {}), throwsFlutterError);
    });
  });
}
