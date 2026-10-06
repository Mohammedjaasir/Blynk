import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:ecom/Infrastructure/HttpMethods/browser_streams.dart';
import 'package:ecom/Models/rider_location_model.dart';
import 'package:ecom/Services/Providers/location.provider.dart';
import 'package:ecom/Services/catalog_live_updates.dart';

/// Live updates on the web build (2026-10-06). Dio's web adapter buffers a
/// whole response, and an SSE response never ends, so neither live stream
/// delivered anything in a browser. The web now uses the browser's own
/// primitives: EventSource for the public catalog stream, and fetch() with a
/// streamed body for the rider location stream (which needs the
/// Authorization header EventSource cannot send). The browser classes
/// themselves only exist in a browser; these tests cover everything around
/// them, and that Android keeps its Dio streams.

const _base = 'https://api.blynk.test/api/v1';

/// A fake fetch(): records each request and hands back a controller the
/// test drives.
class _Fetch {
  final requests = <({String url, Map<String, String> headers})>[];
  final lines = <StreamController<String>>[];

  Stream<String> call(String url, {Map<String, String> headers = const {}}) {
    requests.add((url: url, headers: headers));
    final c = StreamController<String>();
    lines.add(c);
    return c.stream;
  }
}

void main() {
  group('helpers', () {
    test('joinApiUrl joins like Dio does for a relative path', () {
      expect(joinApiUrl(_base, '/catalog/events'), '$_base/catalog/events');
      expect(joinApiUrl('$_base/', '/catalog/events'), '$_base/catalog/events');
      expect(joinApiUrl(_base, 'catalog/events'), '$_base/catalog/events');
    });

    test('sseFrame re-encodes an event in the wire format', () {
      expect(sseFrame('catalog', '{"tables":["products"]}'), 'event: catalog\ndata: {"tables":["products"]}\n\n');
      expect(sseFrame('x', 'a\nb'), 'event: x\ndata: a\ndata: b\n\n');
    });

    test('off the web the browser primitives refuse instead of pretending', () async {
      expect(browserFetchTextStream('$_base/x').toList(), throwsUnsupportedError);
      expect(browserEventSourceTextStream('$_base/x', events: const ['catalog']).toList(), throwsUnsupportedError);
    });
  });

  group('catalog events', () {
    test('on the web they come from an EventSource on the catalog URL', () async {
      String? openedUrl;
      List<String>? openedEvents;
      final line = StreamController<String>();
      final stream = openCatalogEvents(
        web: true,
        baseUrl: _base,
        eventSource: (url, {required events}) {
          openedUrl = url;
          openedEvents = events;
          return line.stream;
        },
      );

      var changes = 0;
      final live = CatalogLiveUpdates(open: () => stream, onChange: () => changes++)..start();
      line.add(sseFrame('catalog', '{"tables":["products"]}'));
      await Future<void>.delayed(Duration.zero);

      expect(openedUrl, '$_base/catalog/events');
      expect(openedEvents, ['catalog']);
      expect(changes, 1);
      live.stop();
    });

    test('off the web the EventSource is never used (Android keeps Dio)', () {
      var used = false;
      final sub = openCatalogEvents(
        web: false,
        baseUrl: _base,
        eventSource: (url, {required events}) {
          used = true;
          return const Stream.empty();
        },
      ).listen((_) {}, onError: (_) {});
      expect(used, isFalse);
      sub.cancel();
    });
  });

  group('rider location on the web', () {
    test('Android (and every non-web build) keeps the Dio opener', () {
      expect(identical(locationStreamOpenerFor(web: false), dioLocationStreamOpener), isTrue);
      expect(identical(locationStreamOpenerFor(web: true), dioLocationStreamOpener), isFalse);
      // The test VM is not the web, so a default provider uses Dio.
      expect(kIsWeb, isFalse);
    });

    test('opens the order stream with the bearer token and passes the text on', () async {
      final fetch = _Fetch();
      final got = <String>[];
      final sub = openWebLocationStream(
        'ord 1',
        baseUrl: _base,
        accessToken: () async => 'tok',
        refreshAccessToken: () async => fail('no refresh needed'),
        fetch: fetch.call,
      ).listen(got.add);
      await Future<void>.delayed(Duration.zero);

      expect(fetch.requests.single.url, '$_base/orders/ord%201/location/stream');
      expect(fetch.requests.single.headers['Authorization'], 'Bearer tok');
      expect(fetch.requests.single.headers['Accept'], 'text/event-stream');

      fetch.lines.single.add('event: location\ndata: {}\n\n');
      await Future<void>.delayed(Duration.zero);
      expect(got, ['event: location\ndata: {}\n\n']);
      await sub.cancel();
    });

    test('a 401 refreshes the token once and reconnects with the new one', () async {
      final fetch = _Fetch();
      var refreshes = 0;
      final errors = <Object>[];
      final sub = openWebLocationStream(
        'o1',
        baseUrl: _base,
        accessToken: () async => 'old',
        refreshAccessToken: () async {
          refreshes++;
          return 'new';
        },
        fetch: fetch.call,
      ).listen((_) {}, onError: errors.add);
      await Future<void>.delayed(Duration.zero);

      fetch.lines.single.addError(const BrowserStreamStatus(401));
      await Future<void>.delayed(Duration.zero);
      await Future<void>.delayed(Duration.zero);

      expect(refreshes, 1);
      expect(fetch.requests.map((r) => r.headers['Authorization']), ['Bearer old', 'Bearer new']);
      expect(errors, isEmpty);

      // A second 401 is a real refusal: no endless refresh loop.
      fetch.lines.last.addError(const BrowserStreamStatus(401));
      await Future<void>.delayed(Duration.zero);
      expect(refreshes, 1);
      expect(errors.single, isA<LocationStreamRefused>().having((e) => e.statusCode, 'status', 401));
      await sub.cancel();
    });

    test('a 401 with no refresh possible is a permanent refusal', () async {
      final fetch = _Fetch();
      final errors = <Object>[];
      openWebLocationStream(
        'o1',
        baseUrl: _base,
        accessToken: () async => null,
        refreshAccessToken: () async => null,
        fetch: fetch.call,
      ).listen((_) {}, onError: errors.add);
      await Future<void>.delayed(Duration.zero);

      expect(fetch.requests.single.headers.containsKey('Authorization'), isFalse);
      fetch.lines.single.addError(const BrowserStreamStatus(401));
      await Future<void>.delayed(Duration.zero);
      await Future<void>.delayed(Duration.zero);

      final refused = errors.single as LocationStreamRefused;
      expect(refused.permanent, isTrue);
    });

    test('other statuses map exactly like the Android opener (404 stops, 503 retries)', () async {
      for (final (status, permanent) in [(404, true), (503, false)]) {
        final fetch = _Fetch();
        final errors = <Object>[];
        openWebLocationStream(
          'o1',
          baseUrl: _base,
          accessToken: () async => 'tok',
          refreshAccessToken: () async => 'x',
          fetch: fetch.call,
        ).listen((_) {}, onError: errors.add);
        await Future<void>.delayed(Duration.zero);
        fetch.lines.single.addError(BrowserStreamStatus(status));
        await Future<void>.delayed(Duration.zero);
        expect((errors.single as LocationStreamRefused).permanent, permanent, reason: '$status');
      }
    });

    test('a network failure passes through so the provider reconnects', () async {
      final fetch = _Fetch();
      final errors = <Object>[];
      var done = false;
      openWebLocationStream(
        'o1',
        baseUrl: _base,
        accessToken: () async => 'tok',
        refreshAccessToken: () async => 'x',
        fetch: fetch.call,
      ).listen((_) {}, onError: errors.add, onDone: () => done = true);
      await Future<void>.delayed(Duration.zero);
      fetch.lines.single.addError(StateError('TypeError: Failed to fetch'));
      await Future<void>.delayed(Duration.zero);
      expect(errors.single, isA<StateError>());
      expect(done, isTrue);
    });

    test('cancelling closes the browser request', () async {
      final fetch = _Fetch();
      var cancelled = false;
      final sub = openWebLocationStream(
        'o1',
        baseUrl: _base,
        accessToken: () async => 'tok',
        refreshAccessToken: () async => 'x',
        fetch: (url, {headers = const {}}) {
          final c = StreamController<String>(onCancel: () => cancelled = true);
          fetch.lines.add(c);
          return c.stream;
        },
      ).listen((_) {});
      await Future<void>.delayed(Duration.zero);
      await sub.cancel();
      expect(cancelled, isTrue);
    });

    test('the provider drives a web stream end to end', () async {
      final fetch = _Fetch();
      final provider = LocationProvider(
        opener: (orderId) => openWebLocationStream(
          orderId,
          baseUrl: _base,
          accessToken: () async => 'tok',
          refreshAccessToken: () async => null,
          fetch: fetch.call,
        ),
        now: () => DateTime.utc(2026, 10, 6, 10, 0, 5),
      );
      provider.watch('o1');
      await Future<void>.delayed(Duration.zero);

      fetch.lines.single.add('event: location\ndata: {"latitude":6.44,"longitude":80.03,"accuracy":8,'
          '"captured_at":"2026-10-06T10:00:00.000Z","received_at":"2026-10-06T10:00:01.000Z"}\n\n');
      await Future<void>.delayed(Duration.zero);

      expect(provider.current, isNotNull);
      expect(provider.current!.latitude, 6.44);
      expect(provider.freshness, LocationFreshness.live);
      provider.dispose();
    });
  });
}
