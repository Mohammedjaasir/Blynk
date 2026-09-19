import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:ecom/Models/order_format.dart';
import 'package:ecom/Models/order_model.dart';
import 'package:ecom/Screens/user_orders_screen.dart';
import 'package:ecom/Services/Providers/order.provider.dart';
import 'package:ecom/UI/Widgets/Atoms/card_order_details.dart';

import 'fixtures/order_fixtures.dart';

/// Builds a list-shaped order (GET /orders row - no history/delivery/payment)
/// from the shared fixture, with the item list built by the caller so tests
/// can control names/quantities without a hand-written JSON map.
OrderModel _order({
  required String id,
  required String number,
  required String status,
  List<int> quantities = const [2, 1],
  String? scheduledFor,
}) {
  final names = ['Kotmale Fresh Milk 1L', 'Butter 200g', 'Rice 5kg', 'Eggs 10pk', 'Sugar 1kg'];
  final items = [
    for (var i = 0; i < quantities.length; i++) itemJson('i$id-$i', names[i], quantities[i], 540),
  ];
  return OrderModel.fromJson(orderJson(
    id: id,
    number: number,
    status: status,
    items: items,
    scheduledFor: scheduledFor,
    detail: false,
  ));
}

/// The real provider with its network load replaced by fixed, overridable
/// state so every screen state (loading/error/empty/pagination) can be
/// exercised without touching the network. Counts loadOrders/loadMoreOrders
/// calls so tests can assert retry/refresh/pagination wiring.
class _FixedOrders extends OrderProvider {
  _FixedOrders(
    this._fixed, {
    String? ordersError,
    bool hasMoreOrders = false,
    bool isLoadingMore = false,
    String? loadMoreError,
  })  : _ordersError = ordersError,
        _fixedHasMoreOrders = hasMoreOrders,
        _fixedIsLoadingMore = isLoadingMore,
        _loadMoreError = loadMoreError;

  final List<OrderModel> _fixed;
  final String? _ordersError;
  final bool _fixedHasMoreOrders;
  final bool _fixedIsLoadingMore;
  final String? _loadMoreError;

  int loadOrdersCalls = 0;
  int loadMoreOrdersCalls = 0;

  @override
  List<OrderModel> get orders => _fixed;
  @override
  bool get isLoadingOrders => false;
  @override
  String? get ordersError => _ordersError;
  @override
  bool get hasMoreOrders => _fixedHasMoreOrders;
  @override
  bool get isLoadingMore => _fixedIsLoadingMore;
  @override
  String? get loadMoreError => _loadMoreError;

  @override
  Future<void> loadOrders() async {
    loadOrdersCalls++;
  }

  @override
  Future<void> loadMoreOrders() async {
    loadMoreOrdersCalls++;
  }
}

/// A provider fake whose `ordersError` can change between calls, without
/// ever clearing `orders` - the shape a real refresh failure takes once
/// orders are already on screen (see OrderProvider.loadOrders: it never
/// touches `_orders` on a caught error). Lets a test drive "refresh fails,
/// then a later refresh succeeds" without touching the network.
class _MutableOrders extends OrderProvider {
  _MutableOrders(this._orders);

  final List<OrderModel> _orders;
  String? _ordersError;

  /// Consumed by the next loadOrders() call, then left in place as the
  /// resulting `ordersError` - set by the test right before triggering a
  /// refresh (pull-to-refresh or retry) to make that refresh fail or
  /// succeed.
  String? nextError;

  int loadOrdersCalls = 0;

  @override
  List<OrderModel> get orders => _orders;
  @override
  bool get isLoadingOrders => false;
  @override
  String? get ordersError => _ordersError;
  @override
  bool get hasMoreOrders => false;
  @override
  bool get isLoadingMore => false;
  @override
  String? get loadMoreError => null;

  @override
  Future<void> loadOrders() async {
    loadOrdersCalls++;
    _ordersError = nextError;
    notifyListeners();
  }
}

void main() {
  group('Orders list', () {
    late List<RouteSettings> pushed;

    Future<_FixedOrders> pumpList(
      WidgetTester tester,
      List<OrderModel> orders, {
      String? ordersError,
      bool hasMoreOrders = false,
      bool isLoadingMore = false,
      String? loadMoreError,
    }) async {
      pushed = [];
      final provider = _FixedOrders(
        orders,
        ordersError: ordersError,
        hasMoreOrders: hasMoreOrders,
        isLoadingMore: isLoadingMore,
        loadMoreError: loadMoreError,
      );
      await tester.pumpWidget(
        ChangeNotifierProvider<OrderProvider>.value(
          value: provider,
          child: MaterialApp(
            home: const OrdersScreen(),
            onGenerateRoute: (settings) {
              pushed.add(settings);
              return MaterialPageRoute(builder: (_) => const SizedBox.shrink(), settings: settings);
            },
          ),
        ),
      );
      await tester.pump();
      return provider;
    }

    testWidgets('shows the real item count from the list payload', (tester) async {
      await pumpList(tester, [_order(id: 'o1', number: 'BL-20260919-0001', status: 'PLACED', quantities: [2, 1])]);
      expect(find.textContaining('3 items'), findsOneWidget);
      expect(find.textContaining('0 items'), findsNothing);
    });

    testWidgets('shows the item names and the total', (tester) async {
      await pumpList(tester, [_order(id: 'o1', number: 'BL-20260919-0001', status: 'PLACED', quantities: [2, 1])]);
      expect(find.text('Kotmale Fresh Milk 1L, Butter 200g'), findsOneWidget);
      expect(find.text('Rs. 1,955'), findsOneWidget);
    });

    testWidgets('a three-item order shows the first two names plus "+1 more"', (tester) async {
      await pumpList(tester, [
        _order(id: 'o1', number: 'BL-20260919-0001', status: 'PLACED', quantities: [1, 1, 1]),
      ]);
      expect(find.text('Kotmale Fresh Milk 1L, Butter 200g +1 more'), findsOneWidget);
    });

    testWidgets('tapping anywhere on the order opens its detail', (tester) async {
      await pumpList(tester, [_order(id: 'o1', number: 'BL-20260919-0001', status: 'OUT_FOR_DELIVERY')]);
      await tester.tap(find.text('BL-20260919-0001'));
      await tester.pumpAndSettle();
      expect(pushed.map((s) => s.name), contains('/order'));
      expect(pushed.firstWhere((s) => s.name == '/order').arguments, equals('o1'));
    });

    testWidgets('row exposes a single semantics label with number, status and total', (tester) async {
      final handle = tester.ensureSemantics();
      await pumpList(tester, [_order(id: 'o1', number: 'BL-20260919-0001', status: 'OUT_FOR_DELIVERY')]);
      expect(
        find.bySemanticsLabel('BL-20260919-0001, Out for delivery, Rs. 1,955'),
        findsOneWidget,
      );
      handle.dispose();
    });

    testWidgets('labels each lifecycle state', (tester) async {
      // Taller than the default test viewport so all six (now four-line)
      // rows are built by the lazy ListView, not just the ones that would
      // fit on screen.
      tester.view.physicalSize = const Size(400, 2400);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      await pumpList(tester, [
        _order(id: 'a', number: 'N-A', status: 'PLACED'),
        _order(id: 'b', number: 'N-B', status: 'PACKED'),
        _order(id: 'c', number: 'N-C', status: 'OUT_FOR_DELIVERY'),
        _order(id: 'd', number: 'N-D', status: 'DELIVERED'),
        _order(id: 'e', number: 'N-E', status: 'CANCELLED'),
        _order(id: 'f', number: 'N-F', status: 'FAILED'),
      ]);
      for (final label in ['Order placed', 'Packed', 'Out for delivery', 'Delivered', 'Cancelled', 'Delivery failed']) {
        expect(find.text(label), findsOneWidget, reason: label);
      }
    });

    testWidgets('labels item-unavailable and customer-unavailable states', (tester) async {
      await pumpList(tester, [
        _order(id: 'g', number: 'N-G', status: 'ITEM_UNAVAILABLE'),
        _order(id: 'h', number: 'N-H', status: 'CUSTOMER_UNAVAILABLE'),
      ]);
      expect(find.text('Item unavailable'), findsOneWidget);
      expect(find.text("We couldn't reach you"), findsOneWidget);
    });

    testWidgets('a pre-dispatch scheduled order shows the schedule notice', (tester) async {
      const iso = '2026-09-20T08:00:00.000Z';
      await pumpList(tester, [
        _order(id: 'o1', number: 'BL-20260919-0001', status: 'PLACED', scheduledFor: iso),
      ]);
      expect(find.byIcon(Icons.schedule), findsOneWidget);
      expect(find.text('Scheduled · ${formatScheduled(DateTime.parse(iso))}'), findsOneWidget);
    });

    testWidgets('an out-for-delivery scheduled order shows no schedule notice', (tester) async {
      const iso = '2026-09-20T08:00:00.000Z';
      await pumpList(tester, [
        _order(id: 'o1', number: 'BL-20260919-0001', status: 'OUT_FOR_DELIVERY', scheduledFor: iso),
      ]);
      expect(find.byIcon(Icons.schedule), findsNothing);
      expect(find.textContaining('Scheduled ·'), findsNothing);
    });

    testWidgets('error state shows the message and a retry button that calls loadOrders', (tester) async {
      final provider = await pumpList(tester, [], ordersError: 'Network unreachable');
      expect(find.text("Couldn't load your orders."), findsOneWidget);
      expect(find.text('Network unreachable'), findsOneWidget);

      final retry = find.byKey(const Key('orders-retry'));
      expect(retry, findsOneWidget);
      final callsBeforeRetry = provider.loadOrdersCalls; // initState's own load already ran once
      await tester.tap(retry);
      await tester.pump();
      expect(provider.loadOrdersCalls, callsBeforeRetry + 1);
    });

    testWidgets('empty state shows the empty copy', (tester) async {
      await pumpList(tester, []);
      expect(find.text("You haven't placed any orders yet."), findsOneWidget);
    });

    testWidgets('pull-to-refresh works in the error state', (tester) async {
      final provider = await pumpList(tester, [], ordersError: 'Network unreachable');
      final callsBeforeRefresh = provider.loadOrdersCalls; // initState's own load already ran once
      await tester.fling(find.byType(ListView), const Offset(0, 300), 1000);
      await tester.pump();
      await tester.pump(const Duration(seconds: 1));
      expect(provider.loadOrdersCalls, callsBeforeRefresh + 1);
    });

    testWidgets('pull-to-refresh works in the empty state', (tester) async {
      final provider = await pumpList(tester, []);
      final callsBeforeRefresh = provider.loadOrdersCalls; // initState's own load already ran once
      await tester.fling(find.byType(ListView), const Offset(0, 300), 1000);
      await tester.pump();
      await tester.pump(const Duration(seconds: 1));
      expect(provider.loadOrdersCalls, callsBeforeRefresh + 1);
    });

    testWidgets('pull-to-refresh works with orders already on screen', (tester) async {
      final provider = await pumpList(tester, [
        _order(id: 'o1', number: 'BL-20260919-0001', status: 'PLACED'),
      ]);
      final callsBeforeRefresh = provider.loadOrdersCalls; // initState's own load already ran once
      await tester.fling(find.byType(ListView), const Offset(0, 300), 1000);
      await tester.pump();
      await tester.pump(const Duration(seconds: 1));
      expect(provider.loadOrdersCalls, callsBeforeRefresh + 1);
    });

    testWidgets('coming back to the foreground refetches the list', (tester) async {
      final provider = await pumpList(tester, [
        _order(id: 'o1', number: 'BL-20260919-0001', status: 'PLACED'),
      ]);
      final callsBeforeResume = provider.loadOrdersCalls; // initState's own load already ran once
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pump();
      expect(provider.loadOrdersCalls, callsBeforeResume + 1);
    });

    testWidgets(
        'a refresh failure with orders already on screen shows a notice and keeps the rows, '
        'cleared by the next successful refresh', (tester) async {
      final provider = _MutableOrders([
        _order(id: 'o1', number: 'BL-20260919-0001', status: 'PLACED'),
      ]);
      await tester.pumpWidget(
        ChangeNotifierProvider<OrderProvider>.value(
          value: provider,
          child: const MaterialApp(home: OrdersScreen()),
        ),
      );
      await tester.pump(); // initState's own load - no error yet

      expect(find.byKey(const Key('orders-refresh-failed')), findsNothing);
      expect(find.text('BL-20260919-0001'), findsOneWidget);

      provider.nextError = 'Network unreachable';
      await tester.fling(find.byType(ListView), const Offset(0, 300), 1000);
      await tester.pump();
      await tester.pump(const Duration(seconds: 1));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('orders-refresh-failed')), findsOneWidget);
      expect(find.text("Couldn't refresh your orders. Pull down to try again."), findsOneWidget);
      // The rows already on screen stay - a failed refresh is not silent,
      // but it also never hides real, already-loaded content.
      expect(find.text('BL-20260919-0001'), findsOneWidget);

      provider.nextError = null;
      await tester.fling(find.byType(ListView), const Offset(0, 300), 1000);
      await tester.pump();
      await tester.pump(const Duration(seconds: 1));

      expect(find.byKey(const Key('orders-refresh-failed')), findsNothing);
      expect(find.text('BL-20260919-0001'), findsOneWidget);
    });

    testWidgets('scrolling to the end calls loadMoreOrders when hasMoreOrders', (tester) async {
      final orders = [
        for (var i = 0; i < 15; i++) _order(id: 'o$i', number: 'BL-2026-$i', status: 'PLACED'),
      ];
      final provider = await pumpList(tester, orders, hasMoreOrders: true);
      await tester.fling(find.byType(ListView), const Offset(0, -3000), 8000);
      await tester.pumpAndSettle();
      expect(provider.loadMoreOrdersCalls, greaterThan(0));
    });

    testWidgets('does not overflow at 360x800', (tester) async {
      tester.view.physicalSize = const Size(360, 800);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      await pumpList(tester, [
        _order(id: 'o1', number: 'BL-20260919-0001', status: 'PLACED', quantities: [1, 1, 1]),
        _order(
          id: 'o2',
          number: 'BL-20260919-0002',
          status: 'OUT_FOR_DELIVERY',
          scheduledFor: '2026-09-20T08:00:00.000Z',
        ),
      ]);
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
    });
  });

  // Status, payment and cancellation moved to their own detail sections
  // (order_detail_screen_test.dart covers the whole screen); this card is
  // now only "Delivery to".
  group('Order detail delivery card', () {
    testWidgets('shows who the order is going to and where', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: OrderDetailsCard(
              order: OrderModel.fromJson(orderJson(id: 'o1', number: 'N-1', status: 'OUT_FOR_DELIVERY')),
            ),
          ),
        ),
      );
      expect(find.text('Delivery to'), findsOneWidget);
      expect(find.text('Jane Silva'), findsOneWidget);
      expect(find.text('+94771234567'), findsOneWidget);
      expect(find.text('12 Galle Road'), findsOneWidget);
      expect(find.text('Dharga Town'), findsOneWidget);
      expect(find.text('Instructions: Blue gate'), findsOneWidget);
      // The card no longer speaks for the order's status.
      expect(find.text('Status'), findsNothing);
      expect(find.text('Out for delivery'), findsNothing);
    });
  });
}
