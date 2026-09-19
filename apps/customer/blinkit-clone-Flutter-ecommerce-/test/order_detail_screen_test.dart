import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:ecom/Models/order_format.dart';
import 'package:ecom/Screens/order_summary_screen.dart';
import 'package:ecom/Services/Exceptions/api_exception.dart';
import 'package:ecom/Services/Providers/order.provider.dart';
import 'package:ecom/UI/Widgets/Organisms/order_bill_card.dart';
import 'package:ecom/app_theme.dart';

import 'fixtures/order_fixtures.dart';

const _id = 'c0000001-0000-0000-0000-000000000001';
const _getKey = 'GET /orders/$_id';
const _cancelKey = 'POST /orders/$_id/cancel';

const _cancelButton = Key('cancel-order-button');
const _refreshFailed = Key('order-refresh-failed');
const _confirmCancel = Key('confirm-cancel');
const _keepOrder = Key('keep-order');
const _retry = Key('order-retry');

/// A fake `OrderRequest` in the style of test/order_provider_test.dart's
/// `_FakeOrdersApi`: routes keyed by `method url`, every call recorded so a
/// test can assert exactly how many GETs/POSTs the screen sent. A route may
/// return an envelope, return an [ApiException] (which is thrown), or await
/// a Completer so a test can hold a request open.
class _FakeOrdersApi {
  final calls = <String>[];
  final Map<String, Future<Object?> Function()> routes = {};

  Future<dynamic> call(String method, String url,
      {Object? body, Map<String, dynamic>? query}) async {
    final key = '$method $url';
    calls.add(key);
    final route = routes[key];
    if (route == null) throw ApiException(404, 'Order not found.', code: 'ORDER_NOT_FOUND');
    final value = await route();
    if (value is ApiException) throw value;
    return value;
  }

  int countOf(String key) => calls.where((c) => c == key).length;
}

Map<String, dynamic> _envelope(Map<String, dynamic> order) => {
      'success': true,
      'data': {'order': order},
    };

/// Pumps the real screen over the real [OrderProvider] with only the network
/// faked. The viewport is made tall enough that the lazy ListView builds
/// every section (the default 800x600 test surface would leave the last
/// sections unbuilt and make "is the cancel button there?" meaningless).
Future<OrderProvider> _pumpDetail(
  WidgetTester tester,
  _FakeOrdersApi api, {
  Size size = const Size(400, 2000),
  bool settle = true,
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);

  final provider = OrderProvider(request: api.call);
  await tester.pumpWidget(
    ChangeNotifierProvider<OrderProvider>.value(
      value: provider,
      child: MaterialApp(
        theme: AppTheme.appTHeme,
        home: const OrderSummaryScreen(orderId: _id),
      ),
    ),
  );
  if (settle) await tester.pumpAndSettle();
  return provider;
}

/// Opens the confirmation sheet and confirms the cancellation.
Future<void> _confirmCancellation(WidgetTester tester) async {
  await tester.tap(find.byKey(_cancelButton));
  await tester.pumpAndSettle();
  await tester.tap(find.byKey(_confirmCancel));
  await tester.pumpAndSettle();
}

/// Lets the SnackBar's auto-dismiss timer run out so the test doesn't end
/// with a pending timer.
Future<void> _drainSnackBar(WidgetTester tester) async {
  await tester.pumpAndSettle(const Duration(seconds: 5));
}

/// Sends the app to the background and back, which is one of the screen's
/// three refetch triggers.
Future<void> _returnToForeground(WidgetTester tester) async {
  tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
  tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
  await tester.pumpAndSettle();
}

void main() {
  late _FakeOrdersApi api;

  setUp(() => api = _FakeOrdersApi());

  // 1
  testWidgets('renders the status header, the items, the bill and "Delivery to"', (tester) async {
    api.routes[_getKey] = () async => _envelope(orderJson(canCancel: true));

    await _pumpDetail(tester, api);

    // Status header (section 1), on the page background.
    expect(find.byKey(const Key('order-status-header')), findsOneWidget);
    expect(
      find.descendant(
        of: find.byKey(const Key('order-status-header')),
        matching: find.text('Order placed'),
      ),
      findsOneWidget,
    );
    expect(find.text("We've received your order."), findsOneWidget);

    // Timeline (section 2).
    expect(find.byKey(const Key('order-timeline')), findsOneWidget);
    expect(find.text(formatOrderTime(DateTime.parse('2026-09-19T10:00:00.000Z'))), findsOneWidget);

    // Items (section 3): both lines, the quantity sum and the line subtotals.
    expect(find.text('Items'), findsOneWidget);
    expect(find.text('3 items'), findsOneWidget);
    expect(find.text('Kotmale Fresh Milk 1L'), findsOneWidget);
    expect(find.text('Butter 200g'), findsOneWidget);
    expect(find.text('1 pc × 2'), findsOneWidget);
    expect(find.text('1 pc × 1'), findsOneWidget);
    expect(find.text('Rs. 1,080'), findsOneWidget);
    expect(find.text('Rs. 805'), findsOneWidget);

    // Bill (section 4).
    expect(find.text('Bill'), findsOneWidget);
    expect(find.text('Rs. 1,885'), findsOneWidget);
    expect(find.text('Rs. 70'), findsOneWidget);
    expect(find.text('Rs. 1,955'), findsOneWidget);
    expect(find.text('Cash on delivery — pay Rs. 1,955 to the rider'), findsOneWidget);

    // Delivery to (section 5).
    expect(find.text('Delivery to'), findsOneWidget);
    expect(find.text('Jane Silva'), findsOneWidget);
    expect(find.text('+94771234567'), findsOneWidget);
    expect(find.text('12 Galle Road'), findsOneWidget);
    expect(find.text('Dharga Town'), findsOneWidget);
    expect(find.text('Instructions: Blue gate'), findsOneWidget);

    // AppBar carries the order number.
    expect(find.text('BL-20260919-4821'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  // 2
  group('the cancel button follows the backend can_cancel flag', () {
    testWidgets('visible when can_cancel is true', (tester) async {
      api.routes[_getKey] = () async => _envelope(orderJson(status: 'PLACED', canCancel: true));
      await _pumpDetail(tester, api);
      expect(find.byKey(_cancelButton), findsOneWidget);
      expect(find.text('You can cancel until your order is out for delivery.'), findsOneWidget);
    });

    testWidgets('hidden for PACKED with can_cancel false', (tester) async {
      api.routes[_getKey] = () async => _envelope(orderJson(status: 'PACKED', canCancel: false));
      await _pumpDetail(tester, api);
      expect(find.text('Packed'), findsWidgets);
      expect(find.byKey(_cancelButton), findsNothing);
    });

    testWidgets('hidden when the field is absent (fail closed)', (tester) async {
      api.routes[_getKey] = () async => _envelope(orderJson(status: 'PLACED'));
      await _pumpDetail(tester, api);
      expect(find.byKey(_cancelButton), findsNothing);
    });
  });

  // 3
  testWidgets('confirming the cancel posts once and the screen shows the backend truth',
      (tester) async {
    final cancelled = orderJson(
      status: 'CANCELLED',
      canCancel: false,
      cancellationReason: 'Changed my mind',
      history: [
        [null, 'PLACED', '2026-09-19T10:00:00.000Z'],
        ['PLACED', 'CANCELLED', '2026-09-19T10:20:00.000Z'],
      ],
    );
    api.routes[_getKey] = () async => _envelope(orderJson(status: 'PLACED', canCancel: true));

    await _pumpDetail(tester, api);
    expect(find.byKey(_cancelButton), findsOneWidget);

    api.routes[_cancelKey] = () async => _envelope(cancelled);
    api.routes[_getKey] = () async => _envelope(cancelled);

    await tester.tap(find.byKey(_cancelButton));
    await tester.pumpAndSettle();
    expect(find.text('Cancel this order?'), findsOneWidget);
    expect(find.text("This can't be undone."), findsOneWidget);

    await tester.tap(find.byKey(_confirmCancel));
    await tester.pumpAndSettle();

    expect(api.countOf(_cancelKey), 1);
    expect(
      find.descendant(
        of: find.byKey(const Key('order-status-header')),
        matching: find.text('Cancelled'),
      ),
      findsOneWidget,
    );
    expect(find.text('Reason: Changed my mind'), findsOneWidget);
    expect(
      find.descendant(
        of: find.byKey(const Key('timeline-row-1')),
        matching: find.text('Cancelled'),
      ),
      findsOneWidget,
    );
    expect(find.text('Nothing to pay'), findsOneWidget);
    expect(find.byKey(_cancelButton), findsNothing);
  });

  // 4
  testWidgets('"Keep order" closes the sheet and sends nothing', (tester) async {
    api.routes[_getKey] = () async => _envelope(orderJson(status: 'PLACED', canCancel: true));
    await _pumpDetail(tester, api);

    await tester.tap(find.byKey(_cancelButton));
    await tester.pumpAndSettle();
    expect(find.byKey(_keepOrder), findsOneWidget);

    await tester.tap(find.byKey(_keepOrder));
    await tester.pumpAndSettle();

    expect(find.text('Cancel this order?'), findsNothing);
    expect(api.countOf(_cancelKey), 0);
    expect(api.countOf(_getKey), 1);
    expect(find.byKey(_cancelButton), findsOneWidget);
  });

  // 5
  testWidgets('a stale can_cancel: the refusal is shown and the screen refetches the truth',
      (tester) async {
    api.routes[_getKey] = () async => _envelope(orderJson(status: 'PLACED', canCancel: true));
    await _pumpDetail(tester, api);
    expect(find.byKey(_cancelButton), findsOneWidget);

    api.routes[_cancelKey] = () async => ApiException(
          400,
          'Order is already out for delivery or delivered and cannot be cancelled online.',
          code: 'ORDER_ALREADY_OUT_FOR_DELIVERY',
        );
    api.routes[_getKey] = () async => _envelope(orderJson(
          status: 'OUT_FOR_DELIVERY',
          canCancel: false,
          history: [
            [null, 'PLACED', '2026-09-19T10:00:00.000Z'],
            ['PLACED', 'PACKED', '2026-09-19T10:10:00.000Z'],
            ['PACKED', 'OUT_FOR_DELIVERY', '2026-09-19T10:20:00.000Z'],
          ],
        ));

    await _confirmCancellation(tester);

    expect(find.text("Your order is already on its way, so it can't be cancelled."), findsOneWidget);
    expect(
      find.descendant(
        of: find.byKey(const Key('order-status-header')),
        matching: find.text('Out for delivery'),
      ),
      findsOneWidget,
    );
    expect(find.byKey(_cancelButton), findsNothing);
    expect(api.countOf(_cancelKey), 1);

    await _drainSnackBar(tester);
  });

  // 6
  testWidgets('a cancel timeout says so and refetches exactly once', (tester) async {
    api.routes[_getKey] = () async => _envelope(orderJson(status: 'PLACED', canCancel: true));
    await _pumpDetail(tester, api);
    final getsBefore = api.countOf(_getKey);

    api.routes[_cancelKey] =
        () async => ApiException(408, 'The request timed out.', code: 'TIMEOUT');

    await _confirmCancellation(tester);

    expect(find.text("We couldn't confirm the cancellation. Checking your order…"), findsOneWidget);
    expect(api.countOf(_cancelKey), 1);
    expect(api.countOf(_getKey), getsBefore + 1);

    await _drainSnackBar(tester);
  });

  // 7
  testWidgets('a second tap while the cancel is in flight sends no second request',
      (tester) async {
    final gate = Completer<void>();
    final cancelled = orderJson(status: 'CANCELLED', canCancel: false);
    api.routes[_getKey] = () async => _envelope(orderJson(status: 'PLACED', canCancel: true));

    await _pumpDetail(tester, api);

    api.routes[_cancelKey] = () async {
      await gate.future;
      return _envelope(cancelled);
    };
    api.routes[_getKey] = () async => _envelope(cancelled);

    await tester.tap(find.byKey(_cancelButton));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(_confirmCancel));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 500)); // the sheet is gone; the POST is in flight

    expect(api.countOf(_cancelKey), 1);
    expect(
      find.descendant(of: find.byKey(_cancelButton), matching: find.byType(CircularProgressIndicator)),
      findsOneWidget,
    );

    await tester.tap(find.byKey(_cancelButton), warnIfMissed: false);
    await tester.pump();
    expect(api.countOf(_cancelKey), 1);
    expect(find.text('Cancel this order?'), findsNothing);

    gate.complete();
    await tester.pumpAndSettle();
    expect(api.countOf(_cancelKey), 1);
    expect(find.byKey(_cancelButton), findsNothing);
  });

  // 8
  group('load failures', () {
    testWidgets('a 404 says the order could not be found, with no retry', (tester) async {
      // No route -> the fake throws 404 ORDER_NOT_FOUND, like the backend.
      await _pumpDetail(tester, api);

      expect(find.text('This order could not be found.'), findsOneWidget);
      expect(find.byKey(_retry), findsNothing);
      expect(find.text("Couldn't load this order."), findsNothing);
    });

    testWidgets('a 400 says the order could not be found, with no retry', (tester) async {
      api.routes[_getKey] = () async => ApiException(400, 'Invalid order id.', code: 'VALIDATION_ERROR');
      await _pumpDetail(tester, api);

      expect(find.text('This order could not be found.'), findsOneWidget);
      expect(find.byKey(_retry), findsNothing);
    });

    testWidgets('a 500 shows the message and a retry that reloads', (tester) async {
      api.routes[_getKey] = () async => ApiException(500, 'Something broke.');
      await _pumpDetail(tester, api);

      expect(find.text("Couldn't load this order."), findsOneWidget);
      expect(find.text('Something broke.'), findsOneWidget);
      expect(find.byKey(_retry), findsOneWidget);

      api.routes[_getKey] = () async => _envelope(orderJson(status: 'PLACED', canCancel: true));
      await tester.tap(find.byKey(_retry));
      await tester.pumpAndSettle();

      expect(find.text("Couldn't load this order."), findsNothing);
      expect(find.text('Kotmale Fresh Milk 1L'), findsOneWidget);
      expect(api.countOf(_getKey), 2);
    });

    testWidgets('a timeout shows the message and a retry', (tester) async {
      api.routes[_getKey] =
          () async => ApiException(408, 'The connection timed out.', code: 'TIMEOUT');
      await _pumpDetail(tester, api);

      expect(find.text("Couldn't load this order."), findsOneWidget);
      expect(find.text('The connection timed out.'), findsOneWidget);
      expect(find.byKey(_retry), findsOneWidget);
    });
  });

  // 9
  testWidgets('a failed delivery with no delivery block renders', (tester) async {
    api.routes[_getKey] = () async => _envelope(orderJson(
          status: 'FAILED',
          canCancel: false,
          history: [
            [null, 'PLACED', '2026-09-19T10:00:00.000Z'],
            ['PLACED', 'PACKED', '2026-09-19T10:10:00.000Z'],
            ['PACKED', 'OUT_FOR_DELIVERY', '2026-09-19T10:20:00.000Z'],
            ['OUT_FOR_DELIVERY', 'FAILED', '2026-09-19T10:40:00.000Z'],
          ],
        ));

    await _pumpDetail(tester, api);

    expect(
      find.descendant(
        of: find.byKey(const Key('order-status-header')),
        matching: find.text('Delivery failed'),
      ),
      findsOneWidget,
    );
    expect(find.text('Not paid'), findsOneWidget);
    expect(find.byKey(_cancelButton), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a re-staged delivered order shows all seven history rows and "Paid in cash"',
      (tester) async {
    api.routes[_getKey] = () async => _envelope(restagedDeliveredJson());

    await _pumpDetail(tester, api, size: const Size(400, 2600));

    for (var i = 0; i < 7; i++) {
      expect(find.byKey(Key('timeline-row-$i')), findsOneWidget, reason: 'row $i');
    }
    expect(find.byKey(const Key('timeline-row-7')), findsNothing);
    expect(find.text('Packed again for redelivery'), findsOneWidget);
    expect(find.text('Paid in cash'), findsOneWidget);
    expect(
      find.text(formatOrderTime(DateTime.parse('2026-09-19T11:30:00.000Z'))),
      findsOneWidget,
    );
  });

  // 10
  testWidgets('item statuses: unavailable is struck through, substituted is labelled',
      (tester) async {
    api.routes[_getKey] = () async => _envelope(orderJson(
          status: 'ITEM_UNAVAILABLE',
          canCancel: false,
          items: [
            itemJson('i1', 'Kotmale Fresh Milk 1L', 2, 540, status: 'UNAVAILABLE'),
            itemJson('i2', 'Butter 200g', 1, 805, status: 'SUBSTITUTED'),
            itemJson('i3', 'Rice 5kg', 1, 1200, status: 'SOURCED'),
          ],
        ));

    await _pumpDetail(tester, api);

    expect(find.text('Unavailable — not charged'), findsOneWidget);
    expect(find.text('Replaced by the store'), findsOneWidget);

    final name = tester.widget<Text>(find.text('Kotmale Fresh Milk 1L'));
    expect(name.style?.decoration, TextDecoration.lineThrough);
    final subtotal = tester.widget<Text>(find.text('Rs. 1,080'));
    expect(subtotal.style?.decoration, TextDecoration.lineThrough);

    final sourcedName = tester.widget<Text>(find.text('Rice 5kg'));
    expect(sourcedName.style?.decoration, isNot(TextDecoration.lineThrough));
    // Internal sourcing states are never shown to the customer.
    for (final internal in ['SOURCED', 'PENDING', 'PACKED', 'Sourced', 'Pending']) {
      expect(find.textContaining(internal), findsNothing, reason: internal);
    }
  });

  // 11
  testWidgets('returning to the foreground refetches the order', (tester) async {
    api.routes[_getKey] = () async => _envelope(orderJson(status: 'PLACED', canCancel: true));
    await _pumpDetail(tester, api);
    expect(api.countOf(_getKey), 1);

    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pumpAndSettle();

    expect(api.countOf(_getKey), 2);
  });

  // 12
  testWidgets('there is no "Repeat Order" action anywhere', (tester) async {
    api.routes[_getKey] = () async => _envelope(restagedDeliveredJson());
    await _pumpDetail(tester, api, size: const Size(400, 2600));

    expect(find.textContaining('Repeat'), findsNothing);
    expect(find.textContaining('repeat'), findsNothing);
  });

  // 13
  group('no client-side status list decides cancellability', () {
    testWidgets('PACKED with can_cancel false hides the button', (tester) async {
      api.routes[_getKey] = () async => _envelope(orderJson(status: 'PACKED', canCancel: false));
      await _pumpDetail(tester, api);
      expect(find.byKey(_cancelButton), findsNothing);
    });

    testWidgets('ITEM_UNAVAILABLE with can_cancel true shows the button', (tester) async {
      api.routes[_getKey] =
          () async => _envelope(orderJson(status: 'ITEM_UNAVAILABLE', canCancel: true));
      await _pumpDetail(tester, api);
      expect(find.byKey(_cancelButton), findsOneWidget);
    });

    testWidgets('OUT_FOR_DELIVERY with can_cancel true shows the button', (tester) async {
      api.routes[_getKey] =
          () async => _envelope(orderJson(status: 'OUT_FOR_DELIVERY', canCancel: true));
      await _pumpDetail(tester, api);
      expect(find.byKey(_cancelButton), findsOneWidget);
    });
  });

  // 14
  testWidgets('does not overflow at 360x800', (tester) async {
    api.routes[_getKey] = () async => _envelope(restagedDeliveredJson());
    await _pumpDetail(tester, api, size: const Size(360, 800));

    await tester.fling(find.byType(ListView), const Offset(0, -2000), 4000);
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
  });

  testWidgets('a cancellable order does not overflow at 360x800', (tester) async {
    api.routes[_getKey] = () async => _envelope(orderJson(status: 'PLACED', canCancel: true));
    await _pumpDetail(tester, api, size: const Size(360, 800));

    await tester.fling(find.byType(ListView), const Offset(0, -2000), 4000);
    await tester.pumpAndSettle();
    expect(find.byKey(_cancelButton), findsOneWidget);

    await tester.tap(find.byKey(_cancelButton));
    await tester.pumpAndSettle();
    expect(find.text('Cancel this order?'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  // 15 (a): a refresh that fails is never silent, and never throws the
  // already-loaded order away.
  testWidgets('a failed refresh keeps the order and says it could not refresh', (tester) async {
    api.routes[_getKey] = () async => _envelope(orderJson(status: 'PLACED', canCancel: true));
    await _pumpDetail(tester, api);
    expect(find.byKey(_refreshFailed), findsNothing);

    api.routes[_getKey] =
        () async => ApiException(503, 'Network unreachable.', code: 'NETWORK_ERROR');
    await _returnToForeground(tester);

    expect(find.byKey(_refreshFailed), findsOneWidget);
    expect(find.text("Couldn't refresh this order. Pull down to try again."), findsOneWidget);
    // The order that is on screen stays on screen.
    expect(find.text('Kotmale Fresh Milk 1L'), findsOneWidget);
    expect(find.byKey(_cancelButton), findsOneWidget);
    expect(find.text("Couldn't load this order."), findsNothing);

    // A later successful refresh clears the notice.
    api.routes[_getKey] = () async => _envelope(orderJson(status: 'PACKED', canCancel: true));
    await _returnToForeground(tester);

    expect(find.byKey(_refreshFailed), findsNothing);
    expect(find.text('Packed'), findsWidgets);
  });

  // 15 (b): the timeout copy promises a check - when that check itself
  // fails, the screen has to say so instead of quietly showing stale state.
  testWidgets('a cancel timeout whose refetch also fails shows the refresh notice',
      (tester) async {
    api.routes[_getKey] = () async => _envelope(orderJson(status: 'PLACED', canCancel: true));
    await _pumpDetail(tester, api);

    api.routes[_cancelKey] =
        () async => ApiException(408, 'The request timed out.', code: 'TIMEOUT');
    api.routes[_getKey] =
        () async => ApiException(503, 'Network unreachable.', code: 'NETWORK_ERROR');

    await _confirmCancellation(tester);

    expect(find.text("We couldn't confirm the cancellation. Checking your order…"), findsOneWidget);
    expect(find.byKey(_refreshFailed), findsOneWidget);
    expect(find.text("Couldn't refresh this order. Pull down to try again."), findsOneWidget);
    // Stale-but-real content stays; nothing is invented and nothing is lost.
    expect(find.text('Kotmale Fresh Milk 1L'), findsOneWidget);
    expect(
      find.descendant(
        of: find.byKey(const Key('order-status-header')),
        matching: find.text('Order placed'),
      ),
      findsOneWidget,
    );
    expect(api.countOf(_cancelKey), 1);

    await _drainSnackBar(tester);
  });

  // 15 (c)
  testWidgets('the sections are in the designed order', (tester) async {
    api.routes[_getKey] = () async => _envelope(orderJson(
          status: 'PLACED',
          canCancel: true,
          history: [
            [null, 'PLACED', '2026-09-19T10:00:00.000Z'],
          ],
        ));

    await _pumpDetail(tester, api);

    double top(Finder finder) => tester.getTopLeft(finder).dy;

    final header = top(find.byKey(const Key('order-status-header')));
    final timeline = top(find.byKey(const Key('order-timeline')));
    final items = top(find.byKey(const Key('order-items')));
    final bill = top(find.byType(OrderBillCard));
    final deliveryTo = top(find.byKey(const Key('order-delivery-to')));
    final cancel = top(find.byKey(_cancelButton));

    expect(header, lessThan(timeline));
    expect(timeline, lessThan(items));
    expect(items, lessThan(bill));
    expect(bill, lessThan(deliveryTo));
    expect(deliveryTo, lessThan(cancel));
  });

  // 15 (d): the delivery block is never rendered - no rider, no delivery
  // timestamps, nothing beyond the header sentence.
  testWidgets('no delivery block: rider timestamps and wording never appear', (tester) async {
    api.routes[_getKey] = () async => _envelope(restagedDeliveredJson());

    await _pumpDetail(tester, api, size: const Size(400, 2600));

    // assigned_at (11:05) is the one delivery timestamp that is not also a
    // history time; if a delivery block were rendered it would show up.
    expect(
      find.text(formatOrderTime(DateTime.parse('2026-09-19T11:05:00.000Z'))),
      findsNothing,
    );
    for (final word in ['rider', 'Rider', 'assigned', 'Assigned', 'picked up', 'Picked up']) {
      expect(find.textContaining(word), findsNothing, reason: word);
    }
  });
}
