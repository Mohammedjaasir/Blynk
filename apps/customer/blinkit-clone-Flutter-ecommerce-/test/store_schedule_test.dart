// Store timing decided by Ops/Admin: live hours, the closed banner, and
// scheduled delivery slots at checkout (owner, 2026-10-10).
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:ecom/Models/colombo_time.dart';
import 'package:ecom/Models/delivery_slot_model.dart';
import 'package:ecom/Models/order_format.dart';
import 'package:ecom/Models/order_model.dart';
import 'package:ecom/Models/product_model.dart';
import 'package:ecom/Models/store_status_model.dart';
import 'package:ecom/Services/Exceptions/api_exception.dart';
import 'package:ecom/Services/Providers/address.provider.dart';
import 'package:ecom/Services/Providers/cart.provider.dart';
import 'package:ecom/Services/Providers/order.provider.dart';
import 'package:ecom/Services/Providers/store_info.provider.dart';
import 'package:ecom/Services/ordering_hours.dart';
import 'package:ecom/Services/store_info.dart';
import 'package:ecom/UI/Widgets/Atoms/blynk_button.dart';
import 'package:ecom/UI/Widgets/Atoms/store_closed_banner.dart';
import 'package:ecom/UI/Widgets/Organisms/cart_screen_payment_container.dart';
import 'package:ecom/UI/Widgets/Organisms/checkout_slot_picker.dart';
import 'package:ecom/app_theme.dart';
import 'package:ecom/design/tokens.dart';

import 'fixtures/order_fixtures.dart';

// The pinned test clock (flutter_test_config.dart): Tue 6 Oct 2026, 06:30 UTC
// = 12:00 noon in Colombo.
final DateTime _noon = DateTime.utc(2026, 10, 6, 6, 30);

/// A Colombo wall-clock time as the instant it is.
DateTime _lk(int day, int hour, [int minute = 0]) =>
    DateTime.utc(2026, 10, day, hour, minute).subtract(colomboOffset);

String _iso(DateTime d) => d.toUtc().toIso8601String();

Map<String, dynamic> _week({String open = '08:00', String close = '21:00', Set<String> closedDays = const {}}) => {
      for (final k in storeDayKeys) k: {'closed': closedDays.contains(k), 'open': open, 'close': close},
    };

/// GET /store's data, the new fields included.
Map<String, dynamic> _storeData({
  bool open = true,
  String kind = 'OPEN',
  String? reason,
  DateTime? nextOpenAt,
  DateTime? reopensAt,
  String start = '08:00',
  String end = '21:00',
  bool slots = false,
  Map<String, dynamic>? days,
  bool sameEveryDay = true,
  List<Map<String, dynamic>> holidays = const [],
  bool todayClosed = false,
}) =>
    {
      'delivery_fee_lkr': 100,
      'hub_name': 'Hub',
      'radius_km': 4,
      'coupons_enabled': false,
      'delivery_hours': {'start': start, 'end': end, 'timezone': 'Asia/Colombo'},
      'hours': {'same_every_day': sameEveryDay, 'days': days ?? _week(open: start, close: end)},
      'is_open_now': open,
      'closed_kind': kind,
      'closed_reason': reason,
      'reopens_at': reopensAt == null ? null : _iso(reopensAt),
      'next_open_at': nextOpenAt == null ? null : _iso(nextOpenAt),
      'today_hours': todayClosed ? null : {'open': start, 'close': end},
      'upcoming_holidays': holidays,
      'delivery_slots_enabled': slots,
    };

StoreStatus _status(Map<String, dynamic> data, {DateTime? fetchedAt}) =>
    StoreStatus.tryParse(data, fetchedAt: fetchedAt ?? _noon)!;

Map<String, dynamic> _slot(DateTime start, DateTime end, String day, String time, {int remaining = 5}) => {
      'start': _iso(start),
      'end': _iso(end),
      'day_label': day,
      'time_label': time,
      'label': '$day $time',
      'remaining': remaining,
      'available': remaining > 0,
    };

Map<String, dynamic> _slotsData({bool enabled = true, bool asap = true, List<Map<String, dynamic>>? slots}) => {
      'enabled': enabled,
      'asap_available': asap,
      'is_open_now': asap,
      'closed_kind': asap ? 'OPEN' : 'OUTSIDE_HOURS',
      'closed_reason': null,
      'reopens_at': null,
      'next_open_at': null,
      'slots': slots ??
          [
            _slot(_lk(6, 16), _lk(6, 18), 'Today', '4–6 PM'),
            _slot(_lk(6, 18), _lk(6, 20), 'Today', '6–8 PM', remaining: 0),
            _slot(_lk(7, 8), _lk(7, 10), 'Tomorrow', '8–10 AM'),
          ],
    };

void main() {
  final pinned = OrderingHours.clock;
  tearDown(() => OrderingHours.clock = pinned);

  group('clock labels', () {
    test('whole hours bare, half hours with minutes, noon and midnight', () {
      expect(formatClockTime(8 * 60), '8 AM');
      expect(formatClockTime(8 * 60 + 30), '8:30 AM');
      expect(formatClockTime(12 * 60), '12 PM');
      expect(formatClockTime(30), '12:30 AM');
      expect(formatClockTime(21 * 60 + 45), '9:45 PM');
    });

    test('hours range keeps the spaced en dash of the old constant', () {
      expect(formatHoursRange(8 * 60, 21 * 60), StoreInfo.deliveryHoursLabel);
      expect(formatHoursRange(8 * 60 + 30, 17 * 60 + 30), '8:30 AM – 5:30 PM');
    });

    test('slot windows share a meridiem when they can', () {
      expect(formatTimeWindow(8 * 60, 10 * 60), '8–10 AM');
      expect(formatTimeWindow(8 * 60 + 30, 9 * 60 + 30), '8:30–9:30 AM');
      expect(formatTimeWindow(11 * 60, 13 * 60), '11 AM–1 PM');
      expect(formatTimeWindow(16 * 60, 18 * 60), '4–6 PM');
    });

    test('HH:MM parsing', () {
      expect(parseHhMm('08:00'), 480);
      expect(parseHhMm('17:30'), 1050);
      expect(parseHhMm('25:00'), isNull);
      expect(parseHhMm('8am'), isNull);
      expect(parseHhMm(null), isNull);
    });
  });

  group('StoreStatus.tryParse (GET /store new fields)', () {
    test('reads every new field', () {
      final s = _status(_storeData(
        open: false,
        kind: 'CLOSED_NOW',
        reason: 'Rain',
        nextOpenAt: _lk(10, 8),
        reopensAt: _lk(10, 8),
        slots: true,
        holidays: [
          {'date': '2026-10-12', 'reason': 'Poya'},
          {'date': 'bad'},
        ],
      ));
      expect(s.isOpenNow, isFalse);
      expect(s.closedKind, 'CLOSED_NOW');
      expect(s.closedReason, 'Rain');
      expect(s.nextOpenAt, _lk(10, 8));
      expect(s.reopensAt, _lk(10, 8));
      expect(s.todayOpen, 480);
      expect(s.todayClose, 1260);
      expect(s.days.length, 7);
      expect(s.upcomingHolidays.single.date, '2026-10-12');
      expect(s.upcomingHolidays.single.reason, 'Poya');
      expect(s.upcomingHolidays.single.dateLabel, 'Mon 12 Oct');
      expect(s.deliverySlotsEnabled, isTrue);
      expect(s.hoursLabel, '8 AM – 9 PM');
      expect(s.opensAtLabel, '8 AM');
    });

    test('labels are built from delivery_hours, half hours included', () {
      final s = _status(_storeData(start: '08:30', end: '21:30'));
      expect(s.hoursLabel, '8:30 AM – 9:30 PM');
      expect(s.opensAtLabel, '8:30 AM');
    });

    test('an older answer without hours or status is not a status', () {
      expect(StoreStatus.tryParse({'delivery_fee_lkr': 100}, fetchedAt: _noon), isNull);
      expect(StoreStatus.tryParse(null, fetchedAt: _noon), isNull);
    });

    test('hours without a status: live label, open/closed left to the clock', () {
      final s = StoreStatus.tryParse({
        'delivery_hours': {'start': '09:00', 'end': '18:00'},
      }, fetchedAt: _noon)!;
      expect(s.hoursLabel, '9 AM – 6 PM');
      expect(s.isOpenNow, isNull);
      expect(s.isOpenAt(_noon), isNull);
    });

    test('bad delivery_hours give no label (the fallback shows)', () {
      final s = _status(_storeData(start: '21:00', end: '08:00'));
      expect(s.hoursLabel, isNull);
    });

    test('the week in words', () {
      expect(_status(_storeData()).weekSentence, '8 AM – 9 PM, every day');
      final days = _week(closedDays: {'sun'});
      days['sat'] = {'closed': false, 'open': '09:00', 'close': '13:00'};
      expect(
        _status(_storeData(days: days, sameEveryDay: false)).weekSentence,
        'Mon–Fri 8 AM – 9 PM, Sat 9 AM – 1 PM, Sun closed',
      );
    });
  });

  group('closed banner text', () {
    test('a staff closure with a reason and a reopening later in the week', () {
      final s = _status(_storeData(open: false, kind: 'CLOSED_NOW', reason: 'Rain', nextOpenAt: _lk(10, 8)));
      expect(s.closedText(_noon), 'Closed — Rain · back Sat 8 AM');
    });

    test('at night: back at opening tomorrow', () {
      final night = _lk(6, 22);
      final s = _status(_storeData(open: false, kind: 'OUTSIDE_HOURS', nextOpenAt: _lk(7, 8)), fetchedAt: night);
      expect(s.closedText(night), 'Closed now — back at 8 AM tomorrow');
    });

    test('early morning: back at opening today', () {
      final early = _lk(6, 6);
      final s = _status(_storeData(open: false, kind: 'OUTSIDE_HOURS', nextOpenAt: _lk(6, 8)), fetchedAt: early);
      expect(s.closedText(early), 'Closed now — back at 8 AM');
    });

    test('a holiday or a closed day: closed today', () {
      final s = _status(_storeData(open: false, kind: 'CLOSED_DAY', nextOpenAt: _lk(7, 8), todayClosed: true));
      expect(s.closedText(_noon), 'Closed today — back at 8 AM tomorrow');
    });

    test('a half-hour reopening with a reason', () {
      final s = _status(_storeData(open: false, kind: 'CLOSED_NOW', reason: 'Rain', nextOpenAt: _lk(6, 15, 30)));
      expect(s.closedText(_noon), 'Closed — Rain · back at 3:30 PM');
    });

    test('a reopening more than a week away carries the date', () {
      final s = _status(_storeData(open: false, kind: 'CLOSED_NOW', nextOpenAt: _lk(24, 8)));
      expect(s.closedText(_noon), 'Closed now — back Sat 24 Oct 8 AM');
    });

    test('no known reopening: closed for now, with the reason when there is one', () {
      expect(_status(_storeData(open: false, kind: 'CLOSED_NOW', reason: 'Stock count')).closedText(_noon),
          'Closed for now — Stock count');
      expect(_status(_storeData(open: false, kind: 'CLOSED_NOW')).closedText(_noon), 'Closed for now');
    });
  });

  group('the status ages until the next refresh', () {
    test('an open store closes at today\'s closing time', () {
      final s = _status(_storeData());
      expect(s.isOpenAt(_lk(6, 20, 59)), isTrue);
      expect(s.isOpenAt(_lk(6, 21)), isFalse);
      expect(s.nextChangeAfter(_noon), _lk(6, 21));
      // Past closing, the banner works out the next opening from the week.
      expect(s.closedText(_lk(6, 22)), 'Closed now — back at 8 AM tomorrow');
    });

    test('a closure ends at its next_open_at', () {
      final s = _status(_storeData(open: false, kind: 'CLOSED_NOW', nextOpenAt: _lk(6, 15)));
      expect(s.isOpenAt(_lk(6, 14, 59)), isFalse);
      expect(s.isOpenAt(_lk(6, 15)), isTrue);
      expect(s.nextChangeAfter(_noon), _lk(6, 15));
    });

    test('closed until staff reopen stays closed', () {
      final s = _status(_storeData(open: false, kind: 'CLOSED_NOW'));
      expect(s.isOpenAt(_lk(9, 12)), isFalse);
      expect(s.nextChangeAfter(_noon), isNull);
    });
  });

  group('StoreInfoProvider', () {
    StoreInfoProvider provider(Map<String, dynamic>? data, {List<String>? calls}) => StoreInfoProvider(
          request: (url) async {
            calls?.add(url);
            if (data == null) throw ApiException(0, 'offline');
            return {'success': true, 'data': data};
          },
          readCache: () async => null,
          writeCache: (_) async {},
        );

    test('falls back to the constants and the clock until GET /store answers', () async {
      final p = provider(null);
      await p.load();
      expect(p.status, isNull);
      expect(p.hoursLabel, StoreInfo.deliveryHoursLabel);
      expect(p.opensAtLabel, StoreInfo.opensAtLabel);
      expect(p.deliverySlotsEnabled, isFalse);
      expect(p.isOpenAt(_noon), isTrue);
      expect(p.isOpenAt(_lk(6, 22)), isFalse);
      expect(p.closedMessage(_lk(6, 22)), StoreInfoProvider.fallbackClosedMessage());
    });

    test('takes the live hours and status', () async {
      final p = provider(_storeData(
        open: false,
        kind: 'CLOSED_NOW',
        reason: 'Rain',
        nextOpenAt: _lk(10, 8),
        start: '09:30',
        end: '18:00',
        slots: true,
      ));
      await p.load();
      expect(p.hoursLabel, '9:30 AM – 6 PM');
      expect(p.opensAtLabel, '9:30 AM');
      expect(p.deliverySlotsEnabled, isTrue);
      expect(p.isOpenAt(_noon), isFalse);
      expect(p.closedMessage(_noon), 'Closed — Rain · back Sat 8 AM');
    });

    test('refresh is throttled unless forced', () async {
      final calls = <String>[];
      final p = provider(_storeData(), calls: calls);
      await p.load();
      expect(calls, ['/store']);
      await p.refresh();
      expect(calls.length, 1);
      await p.refresh(force: true);
      expect(calls.length, 2);
      OrderingHours.clock = () => _noon.add(StoreInfoProvider.refreshMinInterval);
      await p.refresh();
      expect(calls.length, 3);
    });
  });

  group('DeliverySlots', () {
    test('parses, groups by day and marks full slots', () {
      final s = DeliverySlots.tryParse(_slotsData())!;
      expect(s.enabled, isTrue);
      expect(s.asapAvailable, isTrue);
      expect(s.slots.length, 3);
      expect(s.byDay.map((e) => e.key), ['Today', 'Tomorrow']);
      expect(s.slots[1].available, isFalse);
      expect(s.availableSlot(s.slots[1].start), isNull);
      expect(s.availableSlot(s.slots[0].start), same(s.slots[0]));
    });

    test('disabled means no slots', () {
      final s = DeliverySlots.tryParse(_slotsData(enabled: false))!;
      expect(s.enabled, isFalse);
      expect(s.slots, isEmpty);
      expect(DeliverySlots.tryParse({'slots': []}), isNull);
    });
  });

  group('OrderProvider slots', () {
    late List<Map<String, Object?>> calls;
    late Object? Function(String method, String url, Object? body) answer;

    OrderProvider orders() => OrderProvider(
          request: (method, url, {body, query}) async {
            calls.add({'method': method, 'url': url, 'body': body});
            final a = answer(method, url, body);
            if (a is Exception) throw a;
            return a;
          },
          idempotencyKeyGenerator: () => 'key',
        );

    CartProvider cart() => CartProvider()
      ..add(ProductModel.fromJson({
        'id': 'p1',
        'category_id': 'c1',
        'name': 'Milk',
        'slug': 'milk',
        'sku': 'SKU-p1',
        'unit': '1 L',
        'selling_price': 540,
        'is_available': true,
      }));

    setUp(() {
      calls = [];
      answer = (method, url, body) {
        if (url == '/orders/slots') return {'success': true, 'data': _slotsData()};
        return {'success': true, 'data': {'order': orderJson()}};
      };
    });

    test('loads slots; ASAP is the default (no slot sent)', () async {
      final o = orders();
      await o.loadSlots();
      expect(o.slotsEnabled, isTrue);
      expect(o.selectedSlot, isNull);
      await o.placeOrder(cart: cart(), addressId: 'a1', deliverySlotStart: o.selectedSlot?.start);
      final body = calls.last['body'] as Map;
      expect(body.containsKey('delivery_slot_start'), isFalse);
    });

    test('a picked slot is sent as delivery_slot_start and cleared after the order', () async {
      final o = orders();
      await o.loadSlots();
      final slot = o.deliverySlots!.slots.first;
      o.selectSlot(slot.start);
      expect(o.selectedSlot, same(slot));
      await o.placeOrder(cart: cart(), addressId: 'a1', deliverySlotStart: o.selectedSlot?.start);
      expect((calls.last['body'] as Map)['delivery_slot_start'], slot.start);
      expect(o.selectedSlotStart, isNull);
    });

    test('a full slot cannot be the selected slot', () async {
      final o = orders();
      await o.loadSlots();
      o.selectSlot(o.deliverySlots!.slots[1].start);
      expect(o.selectedSlot, isNull);
    });

    for (final refusal in [
      ApiException(409, 'That slot is full.', code: 'SLOT_FULL'),
      ApiException(422, 'That slot is no longer offered.', code: 'SLOT_UNAVAILABLE'),
    ]) {
      test('${refusal.code}: the pick is dropped and the slots reload', () async {
        final o = orders();
        await o.loadSlots();
        o.selectSlot(o.deliverySlots!.slots.first.start);
        answer = (method, url, body) {
          if (url == '/orders/slots') return {'success': true, 'data': _slotsData()};
          return refusal;
        };
        await expectLater(
          o.placeOrder(cart: cart(), addressId: 'a1', deliverySlotStart: o.selectedSlot?.start),
          throwsA(isA<ApiException>()),
        );
        expect(o.selectedSlotStart, isNull);
        await Future<void>.delayed(Duration.zero);
        expect(calls.where((c) => c['url'] == '/orders/slots').length, 2);
        expect(placeOrderErrorMessage(refusal), refusal.message);
      });
    }

    test('a slot that disappears on reload is dropped', () async {
      final o = orders();
      await o.loadSlots();
      o.selectSlot(o.deliverySlots!.slots.first.start);
      answer = (method, url, body) => {
            'success': true,
            'data': _slotsData(slots: [_slot(_lk(7, 8), _lk(7, 10), 'Tomorrow', '8–10 AM')]),
          };
      await o.loadSlots();
      expect(o.selectedSlotStart, isNull);
    });
  });

  group('STORE_CLOSED from POST /orders', () {
    test('the server sentence is shown as is', () {
      final e = ApiException(422, 'Blynk is closed now (Rain). We open again at 8:00 AM tomorrow.', code: 'STORE_CLOSED');
      expect(placeOrderErrorMessage(e), 'Blynk is closed now (Rain). We open again at 8:00 AM tomorrow.');
    });

    test('a 5xx or an unrelated code keeps the app copy', () {
      expect(placeOrderErrorMessage(ApiException(500, 'boom', code: 'STORE_CLOSED')), isNot('boom'));
      expect(placeOrderErrorMessage(ApiException(422, 'raw', code: 'PRODUCT_UNAVAILABLE')), isNot('raw'));
    });
  });

  group('order schedule line', () {
    test('scheduled_until is parsed next to scheduled_for', () {
      final o = OrderModel.fromJson({
        ...orderJson(scheduledFor: _iso(_lk(7, 8))),
        'scheduled_until': _iso(_lk(7, 10)),
      });
      expect(o.scheduledFor, _lk(7, 8));
      expect(o.scheduledUntil, _lk(7, 10));
      expect(OrderModel.fromJson(orderJson()).scheduledUntil, isNull);
    });

    test('"Scheduled: Tomorrow 8–10 AM" and its variants, on the Colombo clock', () {
      OrderModel order(DateTime start, DateTime? end) => OrderModel.fromJson({
            ...orderJson(scheduledFor: _iso(start)),
            'scheduled_until': end == null ? null : _iso(end),
          });
      expect(scheduledLine(order(_lk(7, 8), _lk(7, 10))), 'Scheduled: Tomorrow 8–10 AM');
      expect(scheduledLine(order(_lk(6, 11), _lk(6, 13))), 'Scheduled: Today 11 AM–1 PM');
      expect(scheduledLine(order(_lk(7, 8, 30), _lk(7, 9, 30))), 'Scheduled: Tomorrow 8:30–9:30 AM');
      expect(scheduledLine(order(_lk(10, 16), _lk(10, 18))), 'Scheduled: Sat 10 Oct 4–6 PM');
      // An older order without scheduled_until shows just the start.
      expect(scheduledLine(order(_lk(7, 8), null)), 'Scheduled: Tomorrow 8 AM');
      expect(scheduledLine(OrderModel.fromJson(orderJson())), isNull);
    });
  });

  group('widgets', () {
    Future<StoreInfoProvider> store(WidgetTester tester, Map<String, dynamic> data) async {
      final p = StoreInfoProvider(
        request: (_) async => {'success': true, 'data': data},
        readCache: () async => null,
        writeCache: (_) async {},
      );
      await tester.runAsync(p.load);
      return p;
    }

    testWidgets('the closed banner shows the live closure, and nothing while open', (tester) async {
      final closed = await store(tester, _storeData(open: false, kind: 'CLOSED_NOW', reason: 'Rain', nextOpenAt: _lk(10, 8)));
      await tester.pumpWidget(ChangeNotifierProvider<StoreInfoProvider>.value(
        value: closed,
        child: MaterialApp(theme: AppTheme.appTHeme, home: const Scaffold(body: StoreClosedBanner())),
      ));
      expect(find.text('Closed — Rain · back Sat 8 AM'), findsOneWidget);

      final open = await store(tester, _storeData());
      await tester.pumpWidget(ChangeNotifierProvider<StoreInfoProvider>.value(
        value: open,
        child: MaterialApp(theme: AppTheme.appTHeme, home: const Scaffold(body: StoreClosedBanner())),
      ));
      expect(find.byKey(StoreClosedBanner.bannerKey), findsNothing);
    });

    group('checkout slot picker and Place order', () {
      late OrderProvider orders;
      late Map<String, dynamic> slotsData;

      Future<void> pumpCheckout(WidgetTester tester, StoreInfoProvider storeInfo) async {
        tester.view.physicalSize = const Size(600, 1400);
        tester.view.devicePixelRatio = 1.0;
        addTearDown(tester.view.reset);
        orders = OrderProvider(request: (method, url, {body, query}) async {
          if (url == '/orders/slots') return {'success': true, 'data': slotsData};
          throw StateError('not in this test');
        });
        final cart = CartProvider()
          ..add(ProductModel.fromJson({
            'id': 'p1',
            'category_id': 'c1',
            'name': 'Milk',
            'slug': 'milk',
            'sku': 'SKU-p1',
            'unit': '1 L',
            'selling_price': 540,
            'is_available': true,
          }));
        await tester.pumpWidget(MultiProvider(
          providers: [
            ChangeNotifierProvider<AddressProvider>.value(
                value: AddressProvider(request: ({methodType, url, body}) async => {'data': {'addresses': []}})),
            ChangeNotifierProvider<CartProvider>.value(value: cart),
            ChangeNotifierProvider<OrderProvider>.value(value: orders),
            ChangeNotifierProvider<StoreInfoProvider>.value(value: storeInfo),
          ],
          child: MaterialApp(
            theme: AppTheme.appTHeme,
            home: Scaffold(
              body: ListView(children: const [CheckoutSlotPicker()]),
              bottomNavigationBar: const Column(mainAxisSize: MainAxisSize.min, children: [CartScreenPaymentContainer()]),
            ),
          ),
        ));
        await tester.pump();
        await tester.pump();
      }

      bool placeEnabled(WidgetTester tester) => tester
          .widget<BlynkButton>(find.ancestor(of: find.text('Place order'), matching: find.byType(BlynkButton)))
          .onPressed != null;

      testWidgets('slots off: no picker, nothing asked', (tester) async {
        slotsData = _slotsData();
        await pumpCheckout(tester, await store(tester, _storeData()));
        expect(find.text('Delivery time'), findsNothing);
        expect(orders.deliverySlots, isNull);
        expect(placeEnabled(tester), isTrue);
      });

      testWidgets('open: ASAP is offered and picked by default; slots by day, full ones disabled', (tester) async {
        slotsData = _slotsData();
        await pumpCheckout(tester, await store(tester, _storeData(slots: true)));
        expect(find.text('Delivery time'), findsOneWidget);
        expect(find.text(CheckoutSlotPicker.asapLabel), findsOneWidget);
        expect(find.text('Today'), findsOneWidget);
        expect(find.text('Tomorrow'), findsOneWidget);
        expect(find.text('4–6 PM'), findsOneWidget);
        expect(find.text(CheckoutSlotPicker.fullLabel), findsOneWidget);
        expect(orders.selectedSlot, isNull);
        expect(find.descendant(of: find.byKey(CheckoutSlotPicker.asapKey), matching: find.byIcon(BlynkIcons.choiceOn)), findsOneWidget);
        expect(placeEnabled(tester), isTrue);

        // A full slot cannot be picked.
        await tester.tap(find.text('6–8 PM'));
        await tester.pump();
        expect(orders.selectedSlotStart, isNull);

        await tester.tap(find.text('8–10 AM'));
        await tester.pump();
        expect(orders.selectedSlot?.timeLabel, '8–10 AM');

        await tester.tap(find.text(CheckoutSlotPicker.asapLabel));
        await tester.pump();
        expect(orders.selectedSlotStart, isNull);
      });

      testWidgets('closed: no ASAP, a slot must be picked before Place order works', (tester) async {
        slotsData = _slotsData(asap: false);
        await pumpCheckout(
          tester,
          await store(tester, _storeData(open: false, kind: 'CLOSED_NOW', reason: 'Rain', nextOpenAt: _lk(7, 8), slots: true)),
        );
        expect(find.text(CheckoutSlotPicker.asapLabel), findsNothing);
        expect(find.text(CheckoutSlotPicker.closedNote), findsOneWidget);
        expect(find.text('Closed — Rain · back at 8 AM tomorrow'), findsOneWidget);
        expect(find.text(ClosedForOrdersNote.pickSlotHint), findsOneWidget);
        expect(placeEnabled(tester), isFalse);

        await tester.tap(find.text('8–10 AM'));
        await tester.pump();
        expect(placeEnabled(tester), isTrue);
        expect(find.text(ClosedForOrdersNote.slotPickedHint), findsOneWidget);
      });

      testWidgets('closed with slots off: Place order stays off, the banner says when we reopen', (tester) async {
        slotsData = _slotsData(enabled: false);
        await pumpCheckout(
          tester,
          await store(tester, _storeData(open: false, kind: 'OUTSIDE_HOURS', nextOpenAt: _lk(7, 8))),
        );
        expect(find.text('Delivery time'), findsNothing);
        expect(find.text('Closed now — back at 8 AM tomorrow'), findsOneWidget);
        expect(find.text(ClosedForOrdersNote.pickSlotHint), findsNothing);
        expect(placeEnabled(tester), isFalse);
      });
    });
  });
}
