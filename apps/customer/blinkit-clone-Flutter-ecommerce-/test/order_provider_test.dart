import 'dart:async';

import 'package:flutter_test/flutter_test.dart';

import 'package:ecom/Services/Exceptions/api_exception.dart';
import 'package:ecom/Services/Providers/order.provider.dart';

import 'fixtures/order_fixtures.dart';

/// A fake `OrderRequest` in the style of test/home_carousel_test.dart's
/// `_FakeApi`, but keyed by method + url (+ page, when a query is sent) so
/// tests can assert exactly which page was requested.
class _FakeOrdersApi {
  final calls = <String>[];
  final Map<String, Object Function()> routes = {};

  Future<dynamic> call(String method, String url,
      {Object? body, Map<String, dynamic>? query}) async {
    final key = '$method $url${query == null ? '' : '?page=${query['page']}'}';
    calls.add(key);
    final r = routes[key];
    if (r == null) throw ApiException(404, 'Order not found.', code: 'ORDER_NOT_FOUND');
    final v = r();
    if (v is ApiException) throw v;
    return v;
  }
}

Map<String, dynamic> listEnvelope(List<Object?> orders, {int page = 1, int totalPages = 1}) => {
      'success': true,
      'data': {
        'orders': orders,
        'pagination': {'page': page, 'limit': 20, 'total': orders.length, 'total_pages': totalPages},
      },
    };

Map<String, dynamic> orderEnvelope(Map<String, dynamic> o) => {
      'success': true,
      'data': {'order': o},
    };

void main() {
  late _FakeOrdersApi api;
  late OrderProvider provider;

  setUp(() {
    api = _FakeOrdersApi();
    provider = OrderProvider(request: api.call);
  });

  group('loadOrders', () {
    test('parses orders and skips a malformed row', () async {
      api.routes['GET /orders?page=1'] = () => listEnvelope([
            orderJson(id: 'o1', detail: false),
            'junk',
          ]);

      await provider.loadOrders();

      expect(provider.orders.length, 1);
      expect(provider.orders.single.id, 'o1');
      expect(provider.ordersError, isNull);
    });

    test('a 500 sets ordersError and keeps the list empty; a retry clears it', () async {
      api.routes['GET /orders?page=1'] = () => ApiException(500, 'Something broke.');

      await provider.loadOrders();

      expect(provider.orders, isEmpty);
      expect(provider.ordersError, isNotNull);

      api.routes['GET /orders?page=1'] =
          () => listEnvelope([orderJson(id: 'o1', detail: false)]);

      await provider.loadOrders();

      expect(provider.ordersError, isNull);
      expect(provider.orders.length, 1);
    });

    test('always resets to page 1, even after loadMoreOrders advanced the page', () async {
      api.routes['GET /orders?page=1'] = () => listEnvelope(
            [orderJson(id: 'o1', detail: false)],
            page: 1,
            totalPages: 2,
          );
      api.routes['GET /orders?page=2'] = () => listEnvelope(
            [orderJson(id: 'o2', detail: false)],
            page: 2,
            totalPages: 2,
          );

      await provider.loadOrders();
      await provider.loadMoreOrders();
      expect(provider.orders.map((o) => o.id), ['o1', 'o2']);

      // Pull-to-refresh: back to a fresh page 1, not page 3.
      api.routes['GET /orders?page=1'] = () => listEnvelope(
            [orderJson(id: 'o1-fresh', detail: false)],
            page: 1,
            totalPages: 2,
          );
      await provider.loadOrders();

      expect(provider.orders.map((o) => o.id), ['o1-fresh']);
      expect(provider.hasMoreOrders, isTrue);
      expect(api.calls.last, 'GET /orders?page=1');
    });

    test('two overlapping loadOrders: only the latest response is applied', () async {
      final completers = [Completer<dynamic>(), Completer<dynamic>()];
      var callIndex = 0;
      api.routes['GET /orders?page=1'] = () => completers[callIndex++].future;

      final first = provider.loadOrders();
      final second = provider.loadOrders();

      // The second (latest) call's response arrives first...
      completers[1].complete(
        listEnvelope([orderJson(id: 'second', detail: false)], page: 1, totalPages: 3),
      );
      await second;

      expect(provider.orders.map((o) => o.id), ['second']);
      expect(provider.hasMoreOrders, isTrue);
      expect(provider.isLoadingOrders, isFalse);

      // ...then the stale first call resolves late and must not overwrite it.
      completers[0].complete(
        listEnvelope([orderJson(id: 'first-stale', detail: false)], page: 1, totalPages: 1),
      );
      await first;

      expect(provider.orders.map((o) => o.id), ['second']);
      expect(provider.hasMoreOrders, isTrue);
      expect(provider.isLoadingOrders, isFalse);
    });
  });

  group('loadMoreOrders', () {
    test('requests page=2, appends, and hasMoreOrders is false after the last page', () async {
      api.routes['GET /orders?page=1'] = () => listEnvelope(
            [orderJson(id: 'o1', detail: false)],
            page: 1,
            totalPages: 2,
          );
      api.routes['GET /orders?page=2'] = () => listEnvelope(
            [orderJson(id: 'o2', detail: false)],
            page: 2,
            totalPages: 2,
          );

      await provider.loadOrders();
      expect(provider.hasMoreOrders, isTrue);

      await provider.loadMoreOrders();

      expect(api.calls, contains('GET /orders?page=2'));
      expect(provider.orders.map((o) => o.id), ['o1', 'o2']);
      expect(provider.hasMoreOrders, isFalse);
    });

    test('is a no-op when there is no more to load', () async {
      api.routes['GET /orders?page=1'] =
          () => listEnvelope([orderJson(id: 'o1', detail: false)], page: 1, totalPages: 1);
      await provider.loadOrders();
      expect(provider.hasMoreOrders, isFalse);

      api.calls.clear();
      await provider.loadMoreOrders();

      expect(api.calls, isEmpty);
      expect(provider.orders.map((o) => o.id), ['o1']);
    });

    test('is a no-op when the first page has not loaded yet', () async {
      await provider.loadMoreOrders();

      expect(api.calls, isEmpty);
      expect(provider.orders, isEmpty);
    });

    test('is a no-op while a load is already in progress', () async {
      api.routes['GET /orders?page=1'] = () => listEnvelope(
            [orderJson(id: 'o1', detail: false)],
            page: 1,
            totalPages: 3,
          );
      await provider.loadOrders();

      api.routes['GET /orders?page=2'] = () => listEnvelope(
            [orderJson(id: 'o2', detail: false)],
            page: 2,
            totalPages: 3,
          );

      final first = provider.loadMoreOrders();
      final second = provider.loadMoreOrders();
      await Future.wait([first, second]);

      expect(api.calls.where((c) => c == 'GET /orders?page=2').length, 1);
      expect(provider.orders.map((o) => o.id), ['o1', 'o2']);
    });

    test('is a no-op while loadOrders is in flight', () async {
      api.routes['GET /orders?page=1'] = () => listEnvelope(
            [orderJson(id: 'o1', detail: false)],
            page: 1,
            totalPages: 2,
          );
      await provider.loadOrders();

      final refreshCompleter = Completer<dynamic>();
      api.routes['GET /orders?page=1'] = () => refreshCompleter.future;
      final refreshFuture = provider.loadOrders();
      expect(provider.isLoadingOrders, isTrue);

      api.calls.clear();
      await provider.loadMoreOrders();
      expect(api.calls, isEmpty);
      expect(provider.orders.map((o) => o.id), ['o1']);

      refreshCompleter.complete(
        listEnvelope([orderJson(id: 'o1-fresh', detail: false)], page: 1, totalPages: 2),
      );
      await refreshFuture;
    });

    test('a refresh during load-more discards the stale page', () async {
      api.routes['GET /orders?page=1'] = () => listEnvelope(
            [orderJson(id: 'o1', detail: false)],
            page: 1,
            totalPages: 2,
          );
      await provider.loadOrders();

      final page2Completer = Completer<dynamic>();
      api.routes['GET /orders?page=2'] = () => page2Completer.future;
      final loadMoreFuture = provider.loadMoreOrders();
      expect(provider.isLoadingMore, isTrue);

      // Pull-to-refresh happens while the load-more is still in flight.
      api.routes['GET /orders?page=1'] = () => listEnvelope(
            [orderJson(id: 'o1-fresh', detail: false)],
            page: 1,
            totalPages: 2,
          );
      await provider.loadOrders();

      expect(provider.orders.map((o) => o.id), ['o1-fresh']);
      expect(provider.hasMoreOrders, isTrue);

      // The stale page-2 response now arrives.
      page2Completer.complete(
        listEnvelope([orderJson(id: 'o2-stale', detail: false)], page: 2, totalPages: 2),
      );
      await loadMoreFuture;

      expect(provider.orders.map((o) => o.id), ['o1-fresh']);
      expect(provider.hasMoreOrders, isTrue);
      expect(provider.isLoadingMore, isFalse);
      expect(provider.loadMoreError, isNull);

      // A fresh loadMoreOrders() requests page=2 (not 3, and not stuck).
      api.routes['GET /orders?page=2'] = () => listEnvelope(
            [orderJson(id: 'o2', detail: false)],
            page: 2,
            totalPages: 2,
          );
      await provider.loadMoreOrders();

      expect(api.calls.last, 'GET /orders?page=2');
      expect(provider.orders.map((o) => o.id), ['o1-fresh', 'o2']);
    });

    test('a failure keeps the already-loaded orders and reports loadMoreError', () async {
      api.routes['GET /orders?page=1'] = () => listEnvelope(
            [orderJson(id: 'o1', detail: false)],
            page: 1,
            totalPages: 2,
          );
      await provider.loadOrders();

      api.routes['GET /orders?page=2'] = () => ApiException(500, 'Something broke.');
      await provider.loadMoreOrders();

      expect(provider.orders.map((o) => o.id), ['o1']);
      expect(provider.ordersError, isNull);
      expect(provider.loadMoreError, isNotNull);
      expect(provider.hasMoreOrders, isTrue);

      // Cleared on the next attempt.
      api.routes['GET /orders?page=2'] = () => listEnvelope(
            [orderJson(id: 'o2', detail: false)],
            page: 2,
            totalPages: 2,
          );
      await provider.loadMoreOrders();

      expect(provider.loadMoreError, isNull);
      expect(provider.orders.map((o) => o.id), ['o1', 'o2']);
    });
  });

  group('fetchOrder', () {
    test('returns the parsed model', () async {
      api.routes['GET /orders/o1'] = () => orderEnvelope(orderJson(id: 'o1'));

      final order = await provider.fetchOrder('o1');

      expect(order.id, 'o1');
    });

    test('throws ApiException 404 (ORDER_NOT_FOUND) when missing', () async {
      // No route registered for /orders/missing -> the fake throws 404.
      await expectLater(
        provider.fetchOrder('missing'),
        throwsA(isA<ApiException>()
            .having((e) => e.statusCode, 'statusCode', 404)
            .having((e) => e.code, 'code', 'ORDER_NOT_FOUND')),
      );
    });

    test('propagates a timeout as ApiException with code TIMEOUT', () async {
      api.routes['GET /orders/o-timeout'] =
          () => ApiException(408, 'Connection timed out.', code: 'TIMEOUT');

      await expectLater(
        provider.fetchOrder('o-timeout'),
        throwsA(isA<ApiException>().having((e) => e.code, 'code', 'TIMEOUT')),
      );
    });

    test('an envelope without a parseable order throws ApiException 500', () async {
      api.routes['GET /orders/o-bad'] = () => {'success': true, 'data': <String, dynamic>{}};

      await expectLater(
        provider.fetchOrder('o-bad'),
        throwsA(isA<ApiException>().having((e) => e.statusCode, 'statusCode', 500)),
      );
    });
  });

  group('cancelOrder', () {
    Future<void> seedOrder({bool canCancel = true}) async {
      api.routes['GET /orders?page=1'] = () => listEnvelope(
            [orderJson(id: 'o1', detail: false, canCancel: canCancel)],
          );
      await provider.loadOrders();
    }

    test('success replaces the matching list entry and reports ok', () async {
      await seedOrder(canCancel: true);
      api.routes['POST /orders/o1/cancel'] = () => orderEnvelope(
            orderJson(id: 'o1', status: 'CANCELLED', canCancel: false),
          );

      final outcome = await provider.cancelOrder('o1');

      expect(outcome.ok, isTrue);
      expect(outcome.order!.canCancel, isFalse);
      expect(provider.orders.single.canCancel, isFalse);
      expect(provider.ordersError, isNull);
    });

    test('a 400 refusal (ORDER_ALREADY_OUT_FOR_DELIVERY) is a refusal, never touches ordersError', () async {
      await seedOrder();
      api.routes['POST /orders/o1/cancel'] = () => ApiException(
            400,
            'Your order is already on its way, so it can\'t be cancelled.',
            code: 'ORDER_ALREADY_OUT_FOR_DELIVERY',
          );

      final outcome = await provider.cancelOrder('o1');

      expect(outcome.ok, isFalse);
      expect(outcome.isRefusal, isTrue);
      expect(provider.ordersError, isNull);
    });

    test('a timeout is not ok and not a refusal', () async {
      await seedOrder();
      api.routes['POST /orders/o1/cancel'] =
          () => ApiException(408, 'Connection timed out.', code: 'TIMEOUT');

      final outcome = await provider.cancelOrder('o1');

      expect(outcome.ok, isFalse);
      expect(outcome.isRefusal, isFalse);
      expect(provider.ordersError, isNull);
    });

    test('ordersError stays null on every kind of cancel failure', () async {
      await seedOrder();

      for (final route in <Object Function()>[
        () => ApiException(400, 'refused', code: 'ORDER_ALREADY_CANCELLED'),
        () => ApiException(404, 'gone', code: 'ORDER_NOT_FOUND'),
        () => ApiException(408, 'timeout', code: 'TIMEOUT'),
        () => {'success': true, 'data': <String, dynamic>{}}, // no order back
      ]) {
        api.routes['POST /orders/o1/cancel'] = route;
        final outcome = await provider.cancelOrder('o1');
        expect(outcome.ok, isFalse);
        expect(provider.ordersError, isNull);
      }
    });

    test('an envelope without a parseable order is not ok, not a refusal', () async {
      await seedOrder();
      api.routes['POST /orders/o1/cancel'] =
          () => {'success': true, 'data': <String, dynamic>{}};

      final outcome = await provider.cancelOrder('o1');

      expect(outcome.ok, isFalse);
      expect(outcome.error, isNotNull);
      expect(provider.ordersError, isNull);
    });
  });
}
