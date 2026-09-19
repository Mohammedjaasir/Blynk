// Live, end-to-end verification of the customer's order lifecycle: what the
// store does to an order is what the customer app says about it, step by
// step, for a normal delivery, for a cancellation (including one the backend
// refuses), and for a failed delivery that is recovered.
//
// Nothing here is mocked. The customer side is the real Flutter app
// (`app.main()`), signed in through the real OTP flow, placing real orders
// and refreshing with a real pull-to-refresh gesture. The store side calls
// the real backend over HTTP with real OTP sign-ins for the seeded ADMIN,
// PACKING_STAFF and RIDER accounts - the same routes the Admin, Inventory and
// Rider apps use. Every store-side call asserts its HTTP status, so a harness
// problem can never be mistaken for an app problem, and every app assertion
// is cross-checked against GET /orders/:id with the customer's own token.
//
// pumpAndSettle() is deliberately avoided (repeating Lottie animations and
// the OTP countdown never let the frame queue drain); bounded pump loops are
// used instead, as in the other live tests here.
//
// Run with the backend up:
//   flutter test integration_test/order_lifecycle_flow_test.dart -d windows
//
// Passing --dart-define=E2E_ARTIFACT_DIR=<dir> makes the run write a manifest
// of everything it created (customer, orders) into <dir>, which the
// out-of-repo cleanup script uses to remove exactly those rows and nothing
// else. Without it the test behaves identically and simply writes no file.
import 'dart:convert';
import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:provider/provider.dart';

import 'package:ecom/main.dart' as app;
import 'package:ecom/Screens/add_edit_address_screen.dart';
import 'package:ecom/Screens/checkout_screen.dart';
import 'package:ecom/Screens/order_summary_screen.dart';
import 'package:ecom/Screens/user_orders_screen.dart';
import 'package:ecom/Services/Providers/address.provider.dart';
import 'package:ecom/Services/Providers/auth.provider.dart';
import 'package:ecom/Services/Providers/cart.provider.dart';
import 'package:ecom/Services/Providers/order.provider.dart';

const _apiBase = 'http://localhost:4000/api/v1';

/// Seeded operations accounts (backend `src/database/seeds/dev_seed.ts`).
const _adminPhone = '+94775551122';
const _staffPhone = '+94774443322';
const _riderPhone = '+94779876543';

/// Where to drop this run's cleanup manifest; empty means "don't".
const _artifactDir = String.fromEnvironment('E2E_ARTIFACT_DIR');

/// Real network I/O inside a widget test has to run through runAsync, or the
/// binding never lets the future complete.
Future<T> _live<T>(WidgetTester tester, Future<T> Function() body) async {
  final result = await tester.runAsync(body);
  return result as T;
}

Future<void> _settle(
  WidgetTester tester, {
  int maxPumps = 24,
  Duration step = const Duration(milliseconds: 250),
}) async {
  for (var i = 0; i < maxPumps; i++) {
    await tester.pump(step);
  }
}

/// Scrolls the target into view first: below the fold in a lazy list the
/// widget isn't merely off-screen, it isn't built yet. See the same helper in
/// live_customer_flow_test.dart for the reasoning.
Future<void> _tap(WidgetTester tester, Finder finder, {Finder? within}) async {
  if (finder.evaluate().isEmpty) {
    final scrollable = within != null
        ? find.descendant(of: within, matching: find.byType(Scrollable)).first
        : find.byType(Scrollable).last;
    if (scrollable.evaluate().isNotEmpty) {
      await tester.dragUntilVisible(
        finder,
        scrollable,
        const Offset(0, -150),
        maxIteration: 30,
      );
    }
  } else {
    await tester.ensureVisible(finder);
  }
  await tester.pump();
  await tester.tap(finder, warnIfMissed: false);
}

/// The outcome of one store-side sign-in. Nothing here throws: a failure is
/// reported back so the test can `expect` on it, because an exception raised
/// inside `runAsync` is reported asynchronously and would let the rest of the
/// test run on with no token.
class _SignIn {
  const _SignIn({required this.ok, required this.how, this.role, this.detail = ''});

  final bool ok;

  /// 'refresh' when an existing session was renewed, 'otp' when a fresh OTP
  /// sign-in was done.
  final String how;
  final String? role;
  final String detail;
}

/// The store side: one Dio, a real sign-in per seeded role, and every
/// response handed back with its status intact so the caller can assert it.
///
/// Signing in prefers renewing a stored session (POST /auth/refresh) over
/// asking for a new OTP, exactly as the Admin, Inventory and Rider apps do -
/// the backend allows only three OTP requests per phone per hour, so
/// re-authenticating from scratch on every run would lock the seeded
/// operations accounts out of their own test. Sessions are kept in
/// [_artifactDir]; without it every run does a full OTP sign-in.
class _Ops {
  _Ops() : _dio = Dio(BaseOptions(baseUrl: _apiBase, validateStatus: (_) => true));

  final Dio _dio;
  final Map<String, String> _tokens = {};
  final Map<String, String> _userIds = {};

  String userId(String phone) => _userIds[phone]!;

  File? _sessionFile(String phone) => _artifactDir.isEmpty
      ? null
      : File('$_artifactDir${Platform.pathSeparator}ops_session_${phone.replaceAll('+', '')}.json');

  String? _storedRefreshToken(String phone) {
    final file = _sessionFile(phone);
    if (file == null || !file.existsSync()) return null;
    try {
      return (jsonDecode(file.readAsStringSync()) as Map)['refresh_token'] as String?;
    } catch (_) {
      return null;
    }
  }

  void _storeRefreshToken(String phone, String token) {
    final file = _sessionFile(phone);
    if (file == null) return;
    file.parent.createSync(recursive: true);
    file.writeAsStringSync(jsonEncode({'phone': phone, 'refresh_token': token}));
  }

  Future<_SignIn> signIn(String phone, String expectedRole) async {
    final stored = _storedRefreshToken(phone);
    if (stored != null) {
      final refreshed = await _dio.post('/auth/refresh', data: {'refresh_token': stored});
      if (refreshed.statusCode == 200) {
        final data = refreshed.data['data'];
        _tokens[phone] = data['access_token'] as String;
        _storeRefreshToken(phone, data['refresh_token'] as String);
        final me = await _dio.get('/auth/me',
            options: Options(headers: {'Authorization': 'Bearer ${_tokens[phone]}'}));
        if (me.statusCode == 200) {
          final user = me.data['data'];
          _userIds[phone] = user['id'] as String;
          return _SignIn(ok: user['role'] == expectedRole, how: 'refresh', role: user['role'] as String);
        }
      }
      _sessionFile(phone)?.deleteSync();
    }

    final request = await _dio.post('/auth/otp/request', data: {'phone': phone});
    if (request.statusCode != 200) {
      return _SignIn(
        ok: false,
        how: 'otp',
        detail: 'OTP request for $phone failed: ${request.statusCode} ${request.data}',
      );
    }
    final devOtp = request.data['data']['dev_otp'] as String?;
    if (devOtp == null) {
      return _SignIn(ok: false, how: 'otp', detail: 'no dev_otp for $phone - is the backend in dev mode?');
    }
    final verify = await _dio.post('/auth/otp/verify', data: {'phone': phone, 'otp': devOtp});
    if (verify.statusCode != 200) {
      return _SignIn(
        ok: false,
        how: 'otp',
        detail: 'OTP verify for $phone failed: ${verify.statusCode} ${verify.data}',
      );
    }
    final user = verify.data['data']['user'];
    _tokens[phone] = verify.data['data']['access_token'] as String;
    _userIds[phone] = user['id'] as String;
    _storeRefreshToken(phone, verify.data['data']['refresh_token'] as String);
    return _SignIn(ok: user['role'] == expectedRole, how: 'otp', role: user['role'] as String);
  }

  Future<Response<dynamic>> send(String method, String path, {required String as, Object? data}) {
    return _dio.request(
      path,
      data: data,
      options: Options(method: method, headers: {'Authorization': 'Bearer ${_tokens[as]}'}),
    );
  }

  /// A call made with the customer's own token, exactly as the app makes it.
  Future<Response<dynamic>> asCustomer(String method, String path, String token, {Object? data}) {
    return _dio.request(
      path,
      data: data,
      options: Options(method: method, headers: {'Authorization': 'Bearer $token'}),
    );
  }

  /// A fresh access token for a phone through the real OTP flow. Used only to
  /// replace the customer's own 15-minute access token if a long run outlives
  /// it - the app's session is left untouched.
  Future<String?> freshAccessToken(String phone) async {
    final request = await _dio.post('/auth/otp/request', data: {'phone': phone});
    if (request.statusCode != 200) return null;
    final devOtp = request.data['data']['dev_otp'] as String?;
    if (devOtp == null) return null;
    final verify = await _dio.post('/auth/otp/verify', data: {'phone': phone, 'otp': devOtp});
    if (verify.statusCode != 200) return null;
    return verify.data['data']['access_token'] as String;
  }
}

/// Everything the order detail screen is saying right now, gathered by
/// walking the whole scrollable - a lazy list only builds what is near the
/// viewport, so "the button isn't there" is only true once the bottom has
/// actually been visited.
class _Detail {
  _Detail({
    required this.header,
    required this.sentence,
    required this.payment,
    required this.timeline,
    required this.texts,
    required this.cancelVisible,
    required this.mapWidgets,
  });

  final String? header;
  final String? sentence;
  final String? payment;
  final List<String> timeline;
  final List<String> texts;
  final bool cancelVisible;
  final List<String> mapWidgets;

  @override
  String toString() =>
      'header=$header sentence=$sentence payment=$payment timeline=$timeline cancel=$cancelVisible';
}

final _detailScreen = find.byType(OrderSummaryScreen);

Finder _inDetail(Finder matching) => find.descendant(of: _detailScreen, matching: matching);

ScrollableState _detailScrollable(WidgetTester tester) {
  final scrollable = find.descendant(of: _detailScreen, matching: find.byType(Scrollable));
  expect(scrollable, findsWidgets, reason: 'the order detail must have its scrollable list');
  return tester.state<ScrollableState>(scrollable.first);
}

/// Reads the detail screen top to bottom. Only jumps the existing scroll
/// position (no refetch), so what it reports is exactly the state the screen
/// was already in.
Future<_Detail> _readDetail(WidgetTester tester) async {
  expect(_detailScreen, findsOneWidget, reason: 'the order detail screen must be on top');

  final texts = <String>[];
  final timeline = <int, String>{};
  final maps = <String>{};
  String? header;
  String? sentence;
  String? payment;
  var cancelVisible = false;

  void capture() {
    for (final text in tester.widgetList<Text>(_inDetail(find.byType(Text)))) {
      final data = text.data;
      if (data != null && !texts.contains(data)) texts.add(data);
    }
    maps.addAll(_mapLikeWidgets(_detailScreen));

    final headerFinder = _inDetail(find.byKey(const Key('order-status-header')));
    if (headerFinder.evaluate().isNotEmpty) {
      final parts =
          tester.widgetList<Text>(find.descendant(of: headerFinder, matching: find.byType(Text))).toList();
      if (parts.length >= 2) {
        header = parts[0].data;
        sentence = parts[1].data;
      }
    }

    final paymentFinder = _inDetail(find.byKey(const Key('order-payment-line')));
    if (paymentFinder.evaluate().isNotEmpty) {
      payment = tester
          .widgetList<Text>(find.descendant(of: paymentFinder, matching: find.byType(Text)))
          .first
          .data;
    }

    if (_inDetail(find.byKey(const Key('cancel-order-button'))).evaluate().isNotEmpty) {
      cancelVisible = true;
    }

    for (var i = 0; i < 24; i++) {
      final row = _inDetail(find.byKey(Key('timeline-row-$i')));
      if (row.evaluate().isEmpty) continue;
      timeline[i] =
          tester.widgetList<Text>(find.descendant(of: row, matching: find.byType(Text))).first.data!;
    }
  }

  final position = _detailScrollable(tester).position;
  position.jumpTo(0);
  await tester.pump();
  capture();

  var guard = 0;
  while (position.pixels < position.maxScrollExtent && guard++ < 40) {
    final next = (position.pixels + 220).clamp(0.0, position.maxScrollExtent);
    position.jumpTo(next);
    await tester.pump();
    capture();
  }

  _detailScrollable(tester).position.jumpTo(0);
  await tester.pump();

  final ordered = timeline.keys.toList()..sort();
  return _Detail(
    header: header,
    sentence: sentence,
    payment: payment,
    timeline: [for (final i in ordered) timeline[i]!],
    texts: texts,
    cancelVisible: cancelVisible,
    mapWidgets: maps.toList(),
  );
}

/// Any map-like widget anywhere under [root]. There is no such dependency in
/// the app today; this is the check that keeps it that way, because a map is
/// live rider location by another name.
final _mapWidgetPattern = RegExp('GoogleMap|MapboxMap|MapLibre|FlutterMap|MapView|WebView');

Set<String> _mapLikeWidgets(Finder root) {
  final found = <String>{};
  void visit(Element element) {
    final name = element.widget.runtimeType.toString();
    if (_mapWidgetPattern.hasMatch(name)) found.add(name);
    element.visitChildren(visit);
  }

  for (final element in root.evaluate()) {
    visit(element);
  }
  return found;
}

/// Taps something on the order detail that lives below the fold. The list is
/// lazy, so the bottom has to be reached before the widget exists at all -
/// and it has to be the detail's own scrollable, not whichever list the
/// still-mounted shell underneath happens to expose.
Future<void> _tapInDetail(WidgetTester tester, Key key) async {
  final position = _detailScrollable(tester).position;
  for (var i = 0; i < 3; i++) {
    position.jumpTo(position.maxScrollExtent);
    await tester.pump();
  }
  final target = _inDetail(find.byKey(key));
  expect(target, findsOneWidget, reason: '$key must be on the order detail to be tapped');
  await tester.ensureVisible(target);
  await tester.pump();
  await tester.tap(target, warnIfMissed: false);
}

/// A real pull-to-refresh: a held, incremental downward drag that arms the
/// RefreshIndicator, then a release. The app has no polling by design, so this
/// gesture is the only thing that refetches the order.
Future<void> _pullToRefresh(WidgetTester tester) async {
  final scrollable = find.descendant(of: _detailScreen, matching: find.byType(Scrollable)).first;
  _detailScrollable(tester).position.jumpTo(0);
  await tester.pump();

  final gesture = await tester.startGesture(tester.getCenter(scrollable));
  for (var i = 0; i < 28; i++) {
    await gesture.moveBy(const Offset(0, 36));
    await tester.pump(const Duration(milliseconds: 16));
  }
  expect(
    find.byType(RefreshProgressIndicator),
    findsWidgets,
    reason: 'the downward drag must have armed the pull-to-refresh indicator',
  );
  await gesture.up();
  await _settle(tester, maxPumps: 20);
}

/// Text that must never reach this screen: who the rider is, how to reach
/// them, where anyone is, or how long anything will take.
void _expectNoRiderOrLocationLeak(_Detail detail, {required String riderName, required String riderPhone}) {
  final forbidden = <String, Pattern>{
    'rider full name': riderName,
    'rider first name': riderName.split(' ').first,
    'rider phone': riderPhone,
    'rider phone (local)': riderPhone.replaceFirst('+94', ''),
    'ETA': RegExp(r'\beta\b', caseSensitive: false),
    'minutes away': RegExp('min away', caseSensitive: false),
    'kilometres': RegExp(r'\bkm\b', caseSensitive: false),
    'hub latitude': '6.4351',
    'hub longitude': '80.0243',
    'a coordinate-precision number': RegExp(r'\d+\.\d{4,}'),
  };

  for (final entry in forbidden.entries) {
    final hits = detail.texts.where((t) => t.contains(entry.value)).toList();
    expect(
      hits,
      isEmpty,
      reason: 'the customer must never see ${entry.key} on the order detail, but found: $hits',
    );
  }
  expect(
    detail.mapWidgets,
    isEmpty,
    reason: 'the order detail must not render a map widget, but found: ${detail.mapWidgets}',
  );
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets(
    'live: normal delivery, cancellation (and a refused one), and failed-delivery recovery',
    (tester) async {
      // One minute of slack absorbs any clock difference between this process
      // and PostgreSQL when the cleanup script bounds its deletes by time.
      final startedAt =
          DateTime.now().toUtc().subtract(const Duration(minutes: 1)).toIso8601String();
      final runSuffix =
          (DateTime.now().millisecondsSinceEpoch % 100000).toString().padLeft(5, '0');
      final testPhone = '71${runSuffix.padLeft(7, '0')}'.substring(0, 9);
      final orderIds = <String>[];
      String customerUserId = '';

      Future<void> writeManifest() async {
        if (_artifactDir.isEmpty) return;
        await _live(tester, () async {
          final dir = Directory(_artifactDir);
          if (!dir.existsSync()) dir.createSync(recursive: true);
          final file = File('$_artifactDir${Platform.pathSeparator}run_$runSuffix.json');
          await file.writeAsString(const JsonEncoder.withIndent('  ').convert({
            'started_at': startedAt,
            'customer_phone': '+94$testPhone',
            'customer_user_id': customerUserId,
            'order_ids': orderIds,
            'ops_phones': [_adminPhone, _staffPhone, _riderPhone],
          }));
        });
      }

      // ============ 0. The real customer app, real OTP sign-in ============
      app.main();
      await _settle(tester, maxPumps: 40);

      expect(find.text('Next'), findsOneWidget);
      await _tap(tester, find.text('Next'));
      await _settle(tester, maxPumps: 10);
      await _tap(tester, find.text('Get Started'));
      await _settle(tester, maxPumps: 10);
      expect(find.text('Log in or Sign up'), findsOneWidget);

      await tester.enterText(find.byType(TextFormField).first, testPhone);
      await tester.pump();
      await _tap(tester, find.text('Continue'));
      await _settle(tester); // real POST /auth/otp/request

      expect(find.text('OTP verification'), findsOneWidget);
      final rootContext = tester.element(find.byType(MaterialApp));
      final auth = Provider.of<AuthProvider>(rootContext, listen: false);
      expect(auth.lastDevOtp, hasLength(6),
          reason: 'the backend must have returned a real dev_otp for this dev-mode call');

      await _tap(tester, find.text('Verify & Continue'));
      await _settle(tester); // real POST /auth/otp/verify

      expect(find.text('OTP verification'), findsNothing,
          reason: 'a successful verify must navigate away from the OTP screen');
      expect(auth.isAuthenticated, isTrue);
      expect(auth.currentUser, isNotNull);
      expect(auth.currentUser!.phone, '+94$testPhone',
          reason: 'the session must be this run\'s own customer, not one restored from a previous run');
      customerUserId = auth.currentUser!.id;
      var customerToken = auth.accessToken!;
      await writeManifest();

      final orders = Provider.of<OrderProvider>(rootContext, listen: false);
      final cart = Provider.of<CartProvider>(rootContext, listen: false);
      final addresses = Provider.of<AddressProvider>(rootContext, listen: false);
      final navigator = tester.state<NavigatorState>(find.byType(Navigator).first);

      // ============ 0b. The store signs in, exactly as its apps do ============
      final ops = _Ops();
      for (final account in [
        [_adminPhone, 'ADMIN'],
        [_staffPhone, 'PACKING_STAFF'],
        [_riderPhone, 'RIDER'],
      ]) {
        final signedIn = await _live(tester, () => ops.signIn(account[0], account[1]));
        expect(signedIn.ok, isTrue,
            reason: 'store-side sign-in as ${account[1]} (${account[0]}) '
                'via ${signedIn.how} failed: ${signedIn.detail}${signedIn.role ?? ''}');
      }

      final ridersResponse =
          await _live(tester, () => ops.send('GET', '/admin/riders', as: _adminPhone));
      expect(ridersResponse.statusCode, 200, reason: 'GET /admin/riders');
      final riderRows = ridersResponse.data['data']['riders'] as List;
      expect(riderRows, isNotEmpty, reason: 'the dev seed must have at least one active rider');
      final riderId = riderRows.first['id'] as String;
      final riderName = riderRows.first['full_name'] as String;
      final riderPhoneNumber = riderRows.first['phone'] as String;
      // A second active rider is used as the replacement in Flow C when the
      // seed has one; with a single rider the same one is reused, which the
      // backend allows because the failed attempt is closed.
      final replacementRiderId = riderRows.length > 1 ? riderRows[1]['id'] as String : riderId;

      // ------------------------------------------------------------ helpers
      /// A call with the customer's own token. An access token lives 15
      /// minutes; a long run can outlive it, so a 401 is answered with one
      /// fresh sign-in rather than being read as an authorization failure.
      Future<Response<dynamic>> customerCall(String method, String path, {Object? data}) {
        return _live(tester, () async {
          var res = await ops.asCustomer(method, path, customerToken, data: data);
          if (res.statusCode == 401) {
            final fresh = await ops.freshAccessToken('+94$testPhone');
            if (fresh != null) {
              customerToken = fresh;
              res = await ops.asCustomer(method, path, customerToken, data: data);
            }
          }
          return res;
        });
      }

      Future<Map<String, dynamic>> apiOrder(String orderId) async {
        final res = await customerCall('GET', '/orders/$orderId');
        expect(res.statusCode, 200, reason: 'GET /orders/$orderId (customer token)');
        return (res.data['data']['order'] as Map).cast<String, dynamic>();
      }

      Future<void> sourceEveryItem(String orderId) async {
        final detail =
            await _live(tester, () => ops.send('GET', '/admin/orders/$orderId', as: _adminPhone));
        expect(detail.statusCode, 200, reason: 'GET /admin/orders/:id');
        final items = detail.data['data']['order']['items'] as List;
        expect(items, isNotEmpty);
        for (final item in items) {
          final sourced = await _live(
            tester,
            () => ops.send(
              'POST',
              '/admin/orders/$orderId/items/${item['id']}/source',
              as: _staffPhone,
              data: {'actual_unit_cost': 450},
            ),
          );
          expect(sourced.statusCode, 200, reason: 'POST source item ${item['id']}');
        }
      }

      Future<void> setStatus(String orderId, String status, {String? notes, String as = _adminPhone}) async {
        final res = await _live(
          tester,
          () => ops.send(
            'PATCH',
            '/admin/orders/$orderId/status',
            as: as,
            data: notes == null ? {'status': status} : {'status': status, 'notes': notes},
          ),
        );
        expect(res.statusCode, 200, reason: 'PATCH /admin/orders/:id/status $status');
      }

      Future<String> assignRider(String orderId, String rider) async {
        final res = await _live(
          tester,
          () => ops.send('POST', '/admin/orders/$orderId/assign-rider',
              as: _adminPhone, data: {'rider_id': rider}),
        );
        expect(res.statusCode, 200, reason: 'POST /admin/orders/:id/assign-rider');
        return res.data['data']['delivery']['id'] as String;
      }

      Future<void> riderStep(String deliveryId, String status, {String? failureReason}) async {
        final res = await _live(
          tester,
          () => ops.send(
            'PATCH',
            '/riders/deliveries/$deliveryId/status',
            as: _riderPhone,
            data: failureReason == null
                ? {'status': status}
                : {'status': status, 'failure_reason': failureReason},
          ),
        );
        expect(res.statusCode, 200, reason: 'PATCH /riders/deliveries/:id/status $status');
      }

      Future<void> collectCod(String deliveryId, num amount) async {
        final res = await _live(
          tester,
          () => ops.send('POST', '/riders/deliveries/$deliveryId/collect-cod',
              as: _riderPhone, data: {'amount': amount}),
        );
        expect(res.statusCode, 200, reason: 'POST /riders/deliveries/:id/collect-cod');
      }

      /// Places an order the way a customer does: cart, checkout, Place Order,
      /// then the confirmation's View order button.
      Future<void> placeOrderThroughTheUi({required bool createAddress}) async {
        navigator.pushNamedAndRemoveUntil('/home', (_) => false);
        await _settle(tester, maxPumps: 20);

        final homeScroll = find
            .byWidgetPredicate((w) => w is Scrollable && w.axisDirection == AxisDirection.down)
            .first;
        for (var i = 0; i < 12 && find.text('ADD').evaluate().isEmpty; i++) {
          await tester.drag(homeScroll, const Offset(0, -220));
          await _settle(tester, maxPumps: 2);
        }
        expect(find.text('ADD'), findsWidgets,
            reason: 'at least one real seeded product must offer an ADD button');

        await _tap(tester, find.text('ADD').first);
        await _settle(tester, maxPumps: 6);
        expect(cart.itemCount, 1, reason: 'tapping ADD must put one real product in the cart');

        await _tap(tester, find.text('View Cart'));
        await _settle(tester, maxPumps: 12);
        expect(find.text('Your Cart'), findsOneWidget);

        await _tap(tester, find.text('Proceed to Checkout'));
        await _settle(tester, maxPumps: 12);
        expect(find.byType(CheckoutScreen), findsOneWidget);
        await _settle(tester, maxPumps: 10); // real GET /me/addresses

        if (createAddress) {
          final addAction = find.ancestor(
            of: find.text('Add'),
            matching: find.byType(GestureDetector),
          );
          expect(addAction, findsOneWidget,
              reason: 'with no address yet the checkout bar should offer Add');
          await _tap(tester, addAction);
          await _settle(tester, maxPumps: 16); // real GET /me/addresses
          expect(find.text('My Addresses'), findsOneWidget);

          await _tap(tester, find.text('Add new address'));
          await _settle(tester, maxPumps: 10);
          expect(find.text('Add Address'), findsOneWidget);

          await _tap(tester, find.text('Other'));
          await _settle(tester, maxPumps: 4);

          final fields = find.byType(TextFormField);
          await tester.enterText(fields.at(0), 'Lifecycle E2E Home');
          await tester.enterText(fields.at(1), 'QA Tester');
          await tester.enterText(fields.at(2), '+94$testPhone');
          await tester.enterText(fields.at(3), 'No. 12, Test Lane');
          await tester.enterText(fields.at(5), 'Dharga Town');
          await tester.pump();

          await _tap(tester, find.byType(Switch), within: find.byType(AddEditAddressScreen));
          await tester.pump();
          await _tap(tester, find.text('Save Address'),
              within: find.byType(AddEditAddressScreen));
          await _settle(tester); // real POST /me/addresses

          expect(find.text('Add Address'), findsNothing,
              reason: 'a successful create should pop the form');
          expect(addresses.defaultAddress, isNotNull);
          navigator.pop(); // back to checkout
          await _settle(tester, maxPumps: 12);
          expect(find.byType(CheckoutScreen), findsOneWidget);
        }

        expect(find.text('Place Order'), findsOneWidget);
        await _tap(tester, find.text('Place Order'));
        await _settle(tester); // real POST /orders

        expect(orders.placeOrderError, isNull,
            reason: 'checkout must have succeeded against the real backend');
        expect(orders.lastPlacedOrder, isNotNull);
        orderIds.add(orders.lastPlacedOrder!.id);
        await writeManifest();

        await _tap(tester, find.byKey(const Key('view-order')));
        await _settle(tester, maxPumps: 16); // real GET /orders/:id
      }

      /// Places an order straight through the API with the customer's own
      /// token - used only to set up the two recovery flows quickly - and
      /// opens it in the app.
      Future<Map<String, dynamic>> placeOrderThroughTheApi(String productId) async {
        final res = await customerCall('POST', '/orders', data: {
          'address_id': addresses.defaultAddress!.id,
          'items': [
            {'product_id': productId, 'quantity': 1}
          ],
        });
        expect(res.statusCode, 201, reason: 'POST /orders (customer token)');
        final order = (res.data['data']['order'] as Map).cast<String, dynamic>();
        orderIds.add(order['id'] as String);
        await writeManifest();
        return order;
      }

      Future<void> openOrder(String orderId) async {
        navigator.pushNamed('/order', arguments: orderId);
        await _settle(tester, maxPumps: 16); // real GET /orders/:id
        expect(_detailScreen, findsOneWidget);
      }

      // ================================================================
      // Flow A - a normal delivery, placed and watched entirely in the app
      // ================================================================
      await placeOrderThroughTheUi(createAddress: true);

      final orderA = orders.lastPlacedOrder!;
      final totalA = orderA.totalAmount;
      final productId = orderA.items.first.productId;
      expect(productId, isNotEmpty, reason: 'the placed order must name the real product ordered');
      expect(find.text(orderA.orderNumber), findsWidgets,
          reason: 'the detail app bar carries the real order number');

      // A1 - placed
      var detail = await _readDetail(tester);
      expect(detail.header, 'Order placed');
      expect(detail.sentence, "We've received your order.");
      expect(detail.cancelVisible, isTrue,
          reason: 'a freshly PLACED order is cancellable, so the button must be offered');
      expect(detail.payment, startsWith('Cash on delivery — pay '));
      expect(detail.timeline, ['Order placed']);
      var api = await apiOrder(orderA.id);
      expect(api['order_status'], 'PLACED');
      expect(api['can_cancel'], isTrue);

      // A2 - sourced and packed by the store
      await sourceEveryItem(orderA.id);
      await setStatus(orderA.id, 'PACKED', as: _staffPhone);
      await _pullToRefresh(tester);
      detail = await _readDetail(tester);
      expect(detail.header, 'Packed');
      expect(detail.sentence, 'Your order is packed.');
      expect(detail.cancelVisible, isTrue, reason: 'PACKED is still cancellable');
      expect(detail.timeline, ['Order placed', 'Packed']);
      api = await apiOrder(orderA.id);
      expect(api['order_status'], 'PACKED');
      expect(api['can_cancel'], isTrue);

      // A3 - a rider is assigned; the order itself is still PACKED
      final deliveryA = await assignRider(orderA.id, riderId);
      await _pullToRefresh(tester);
      detail = await _readDetail(tester);
      expect(detail.header, 'Packed');
      expect(detail.sentence, 'A rider has been assigned.',
          reason: 'only the backend assignment_status may produce this wording');
      expect(detail.cancelVisible, isTrue);
      expect(detail.timeline, ['Order placed', 'Packed']);
      api = await apiOrder(orderA.id);
      expect(api['order_status'], 'PACKED');
      expect(api['delivery']['assignment_status'], 'ASSIGNED');
      expect(api['can_cancel'], isTrue);
      _expectNoRiderOrLocationLeak(detail, riderName: riderName, riderPhone: riderPhoneNumber);

      // A4 - picked up
      await riderStep(deliveryA, 'PICKED_UP');
      await _pullToRefresh(tester);
      detail = await _readDetail(tester);
      expect(detail.header, 'Out for delivery');
      expect(detail.sentence, 'Your order is on its way.');
      expect(detail.cancelVisible, isFalse,
          reason: 'once it is on the road the order can no longer be cancelled');
      expect(detail.timeline, ['Order placed', 'Packed', 'Out for delivery']);
      api = await apiOrder(orderA.id);
      expect(api['order_status'], 'OUT_FOR_DELIVERY');
      expect(api['can_cancel'], isFalse);

      // A5 - arrived
      await riderStep(deliveryA, 'ARRIVED_AT_CUSTOMER');
      await _pullToRefresh(tester);
      detail = await _readDetail(tester);
      expect(detail.header, 'Out for delivery');
      expect(detail.sentence, 'Your rider has arrived.');
      expect(detail.cancelVisible, isFalse);
      expect(detail.payment, startsWith('Cash on delivery — pay '));
      api = await apiOrder(orderA.id);
      expect(api['delivery']['assignment_status'], 'ARRIVED_AT_CUSTOMER');
      _expectNoRiderOrLocationLeak(detail, riderName: riderName, riderPhone: riderPhoneNumber);

      // A6 - cash collected, delivered
      await collectCod(deliveryA, totalA);
      await _pullToRefresh(tester);
      detail = await _readDetail(tester);
      expect(detail.header, 'Delivered');
      expect(detail.sentence, 'Delivered. Thank you!');
      expect(detail.payment, 'Paid in cash');
      expect(detail.cancelVisible, isFalse);
      expect(detail.timeline, ['Order placed', 'Packed', 'Out for delivery', 'Delivered']);
      api = await apiOrder(orderA.id);
      expect(api['order_status'], 'DELIVERED');
      expect(api['payment_status'], 'PAID');
      expect(api['can_cancel'], isFalse);
      _expectNoRiderOrLocationLeak(detail, riderName: riderName, riderPhone: riderPhoneNumber);

      // A7 - the orders list agrees
      navigator.pop();
      await _settle(tester, maxPumps: 8);
      navigator.pushNamed('/orders');
      await _settle(tester, maxPumps: 16); // real GET /orders
      final listScreen = find.byType(OrdersScreen);
      expect(listScreen, findsOneWidget);
      expect(find.descendant(of: listScreen, matching: find.text(orderA.orderNumber)),
          findsOneWidget);
      expect(find.descendant(of: listScreen, matching: find.text('Delivered')), findsOneWidget,
          reason: 'the orders list must show the same status the detail does');
      navigator.pop();
      await _settle(tester, maxPumps: 8);

      // ================================================================
      // Flow B1 - the customer cancels, in the app
      // ================================================================
      await placeOrderThroughTheUi(createAddress: false);
      final orderB1 = orders.lastPlacedOrder!;

      detail = await _readDetail(tester);
      expect(detail.header, 'Order placed');
      expect(detail.cancelVisible, isTrue);
      api = await apiOrder(orderB1.id);
      expect(api['can_cancel'], isTrue);

      await _tapInDetail(tester, const Key('cancel-order-button'));
      await _settle(tester, maxPumps: 8);
      expect(find.byKey(const Key('keep-order')), findsOneWidget,
          reason: 'the confirmation sheet must offer the safe option too');
      await _tap(tester, find.byKey(const Key('confirm-cancel')));
      await _settle(tester); // real POST /orders/:id/cancel + refetch

      detail = await _readDetail(tester);
      expect(detail.header, 'Cancelled');
      expect(detail.sentence, 'This order was cancelled.');
      expect(detail.payment, 'Nothing to pay');
      expect(detail.timeline.last, 'Cancelled');
      expect(detail.cancelVisible, isFalse,
          reason: 'a cancelled order must stop offering the cancel button');
      api = await apiOrder(orderB1.id);
      expect(api['order_status'], 'CANCELLED');
      expect(api['can_cancel'], isFalse);

      navigator.pop();
      await _settle(tester, maxPumps: 8);

      // ================================================================
      // Flow B2 - the backend refuses a cancel the screen still offers
      // ================================================================
      final orderB2 = await placeOrderThroughTheApi(productId);
      final orderB2Id = orderB2['id'] as String;
      await sourceEveryItem(orderB2Id);
      await setStatus(orderB2Id, 'PACKED', as: _staffPhone);
      final deliveryB2 = await assignRider(orderB2Id, riderId);

      await openOrder(orderB2Id);
      detail = await _readDetail(tester);
      expect(detail.header, 'Packed');
      expect(detail.sentence, 'A rider has been assigned.');
      expect(detail.cancelVisible, isTrue,
          reason: 'the screen is showing the truth it was given: PACKED is cancellable');

      // The order leaves the store while the screen keeps its stale copy - no
      // refresh here on purpose.
      await riderStep(deliveryB2, 'PICKED_UP');

      await _tapInDetail(tester, const Key('cancel-order-button'));
      await _settle(tester, maxPumps: 8);
      await _tap(tester, find.byKey(const Key('confirm-cancel')));

      const refusal = "Your order is already on its way, so it can't be cancelled.";
      var sawRefusal = false;
      for (var i = 0; i < 40 && !sawRefusal; i++) {
        await tester.pump(const Duration(milliseconds: 100));
        sawRefusal = find.text(refusal).evaluate().isNotEmpty;
      }
      expect(sawRefusal, isTrue,
          reason: 'a refused cancellation must be said out loud, in the backend\'s own terms');

      await _settle(tester, maxPumps: 20); // the refetch that always follows
      detail = await _readDetail(tester);
      expect(detail.header, 'Out for delivery');
      expect(detail.sentence, 'Your order is on its way.');
      expect(detail.cancelVisible, isFalse,
          reason: 'after the refusal the screen must show the backend truth, not its stale copy');
      api = await apiOrder(orderB2Id);
      expect(api['order_status'], 'OUT_FOR_DELIVERY',
          reason: 'the refused cancel must not have changed anything');
      expect(api['can_cancel'], isFalse);

      // Nothing is left on the road: finish this delivery properly.
      await riderStep(deliveryB2, 'ARRIVED_AT_CUSTOMER');
      await collectCod(deliveryB2, num.parse('${orderB2['total_amount']}'));
      await _pullToRefresh(tester);
      detail = await _readDetail(tester);
      expect(detail.header, 'Delivered');
      expect(detail.payment, 'Paid in cash');
      navigator.pop();
      await _settle(tester, maxPumps: 8);

      // ================================================================
      // Flow C - a failed delivery, re-staged and delivered
      // ================================================================
      final orderC = await placeOrderThroughTheApi(productId);
      final orderCId = orderC['id'] as String;
      final totalC = num.parse('${orderC['total_amount']}');
      await sourceEveryItem(orderCId);
      await setStatus(orderCId, 'PACKED', as: _staffPhone);
      final deliveryC1 = await assignRider(orderCId, riderId);
      await riderStep(deliveryC1, 'PICKED_UP');

      await openOrder(orderCId);
      detail = await _readDetail(tester);
      expect(detail.header, 'Out for delivery');
      expect(detail.sentence, 'Your order is on its way.');

      // C1 - the delivery fails, with a reason written for the store
      const riderReason = 'Bike broke down on Galle Road; returning the bag';
      await riderStep(deliveryC1, 'FAILED', failureReason: riderReason);
      await _pullToRefresh(tester);
      detail = await _readDetail(tester);
      expect(detail.header, 'Delivery failed');
      expect(detail.sentence, "We couldn't complete this delivery.");
      expect(detail.payment, 'Not paid');
      expect(detail.cancelVisible, isFalse);
      expect(detail.timeline,
          ['Order placed', 'Packed', 'Out for delivery', 'Delivery failed']);
      expect(detail.texts.where((t) => t.contains(riderReason)), isEmpty,
          reason: "the rider's internal reason is written for the store, never for the customer");
      expect(detail.texts.where((t) => t.contains('Galle Road')), isEmpty);
      api = await apiOrder(orderCId);
      expect(api['order_status'], 'FAILED');
      expect(api['payment_status'], 'PENDING');
      expect(api['can_cancel'], isFalse);
      expect(jsonEncode(api).contains(riderReason), isFalse,
          reason: 'the customer payload itself must not carry the failure reason');
      _expectNoRiderOrLocationLeak(detail, riderName: riderName, riderPhone: riderPhoneNumber);

      // C2 - the admin re-stages it with a note for the store
      const restageNote = 'Bag back at the store; reassigning tomorrow morning';
      await setStatus(orderCId, 'PACKED', notes: restageNote);
      await _pullToRefresh(tester);
      detail = await _readDetail(tester);
      expect(detail.header, 'Packed');
      expect(detail.sentence, 'Your order is packed.');
      expect(detail.timeline.last, 'Packed again for redelivery',
          reason: 'a PACKED row after a failure reads as a redelivery, not a fresh pack');
      expect(detail.texts.where((t) => t.contains(restageNote)), isEmpty,
          reason: "the admin's internal note must not reach the customer");
      api = await apiOrder(orderCId);
      expect(api['order_status'], 'PACKED');
      expect(jsonEncode(api).contains(restageNote), isFalse);

      // C3 - a replacement rider takes it out again and delivers it
      final deliveryC2 = await assignRider(orderCId, replacementRiderId);
      await _pullToRefresh(tester);
      detail = await _readDetail(tester);
      expect(detail.header, 'Packed');
      expect(detail.sentence, 'A rider has been assigned.');

      await riderStep(deliveryC2, 'PICKED_UP');
      await _pullToRefresh(tester);
      detail = await _readDetail(tester);
      expect(detail.header, 'Out for delivery');
      expect(detail.sentence, 'Your order is on its way.');

      await riderStep(deliveryC2, 'ARRIVED_AT_CUSTOMER');
      await _pullToRefresh(tester);
      detail = await _readDetail(tester);
      expect(detail.sentence, 'Your rider has arrived.');

      await collectCod(deliveryC2, totalC);
      await _pullToRefresh(tester);
      detail = await _readDetail(tester);
      expect(detail.header, 'Delivered');
      expect(detail.sentence, 'Delivered. Thank you!');
      expect(detail.payment, 'Paid in cash');
      expect(detail.cancelVisible, isFalse);
      expect(detail.timeline, [
        'Order placed',
        'Packed',
        'Out for delivery',
        'Delivery failed',
        'Packed again for redelivery',
        'Out for delivery',
        'Delivered',
      ]);
      api = await apiOrder(orderCId);
      expect(api['order_status'], 'DELIVERED');
      expect(api['payment_status'], 'PAID');
      _expectNoRiderOrLocationLeak(detail, riderName: riderName, riderPhone: riderPhoneNumber);

      await writeManifest();
    },
    timeout: const Timeout(Duration(minutes: 30)),
  );
}
