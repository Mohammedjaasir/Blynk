import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';

import 'package:ecom/Infrastructure/HttpMethods/browser_streams.dart';
import 'package:ecom/Infrastructure/HttpMethods/requesting_methods.dart';
import 'package:ecom/Infrastructure/HttpMethods/token_storage.dart';
import 'package:ecom/Models/rider_location_model.dart';

/// Yields raw SSE text chunks for one order's location stream. Injectable so
/// tests never open a real network connection (same idea as OrderProvider's
/// injectable OrderRequest).
typedef LocationStreamOpener = Stream<String> Function(String orderId);

/// Delay before reconnect attempt number [attempt] (0-based).
typedef ReconnectDelay = Duration Function(int attempt);

/// Exponential backoff: 1 s, 2 s, 4 s ... capped at 30 s.
Duration defaultReconnectDelay(int attempt) {
  final seconds = attempt >= 5 ? 30 : (1 << attempt);
  return Duration(seconds: seconds > 30 ? 30 : seconds);
}

/// The server answered the connect request with an HTTP error status instead
/// of opening the stream. Lets the provider tell a deliberate refusal
/// (401/403/404/... - retrying can only hammer the server) from a network
/// failure or a 5xx (retry with backoff).
class LocationStreamRefused implements Exception {
  const LocationStreamRefused(this.statusCode);
  final int statusCode;

  /// A client error the server meant: not authenticated (401, after the
  /// ApiService interceptor already tried a token refresh), forbidden (403),
  /// not your order / no such order (404), conflict (409), bad id (400)...
  /// 408 (timeout) and 429 (rate limited) are transient and retried.
  bool get permanent => statusCode >= 400 && statusCode < 500 && statusCode != 408 && statusCode != 429;

  @override
  String toString() => 'LocationStreamRefused($statusCode)';
}

/// The server sends `: heartbeat` every 15 s. ApiService's default
/// receiveTimeout is also 15 s, which would race the heartbeat and kill a
/// healthy stream, so this request overrides it with a value comfortably
/// above the heartbeat interval.
const Duration _sseReceiveTimeout = Duration(seconds: 45);

/// Opens `GET /orders/:id/location/stream` on [dio] (production: the shared
/// ApiService.dio, so the base URL, the auth header and the 401 -> refresh ->
/// retry interceptor all apply, and every reconnect re-reads the current
/// access token) and yields UTF-8 decoded text chunks.
///
/// Cancelling the returned subscription cancels the request's CancelToken,
/// which closes the HTTP connection instead of leaking it until the next
/// heartbeat.
@visibleForTesting
Stream<String> openLocationStream(Dio dio, String orderId) {
  final cancelToken = CancelToken();
  StreamSubscription<String>? bodySub;
  late final StreamController<String> controller;

  Future<void> connect() async {
    try {
      final response = await dio.get<ResponseBody>(
        '/orders/${Uri.encodeComponent(orderId)}/location/stream',
        cancelToken: cancelToken,
        options: Options(
          responseType: ResponseType.stream,
          receiveTimeout: _sseReceiveTimeout,
          headers: const {'Accept': 'text/event-stream'},
        ),
      );
      if (cancelToken.isCancelled) return; // cancelled while connecting
      // A stateful UTF-8 decoder: multi-byte characters split across network
      // chunks are reassembled, never corrupted.
      bodySub = utf8.decoder.bind(response.data!.stream).listen(
        controller.add,
        onError: controller.addError,
        onDone: () {
          cancelToken.cancel(); // release the socket
          controller.close();
        },
      );
    } catch (e) {
      final cancelledByListener = cancelToken.isCancelled;
      cancelToken.cancel(); // release an unread error body / half-open socket
      if (cancelledByListener) return; // nobody is listening any more
      var error = e;
      if (e is DioException) {
        final status = e.response?.statusCode;
        if (e.type == DioExceptionType.badResponse && status != null) {
          error = LocationStreamRefused(status);
        }
      }
      controller.addError(error);
      await controller.close();
    }
  }

  // The controller (not an async* body) drives the request so that cancelling
  // the subscription aborts the HTTP request at once, even while Dio is still
  // connecting - an async* generator would only notice at its next yield.
  controller = StreamController<String>(
    onListen: () => unawaited(connect()),
    onPause: () => bodySub?.pause(),
    onResume: () => bodySub?.resume(),
    onCancel: () {
      cancelToken.cancel();
      return bodySub?.cancel();
    },
  );
  return controller.stream;
}

final Random _random = Random();

const double _maxJitter = 0.2;

/// Fraction added to a backoff delay, uniformly in [-0.2, +0.2], so clients
/// that were all cut off together (a deploy) do not reconnect in lockstep.
double _randomJitter() => (_random.nextDouble() * 2 - 1) * _maxJitter;

/// Android/iOS: the Dio stream above on the shared ApiService.dio.
Stream<String> dioLocationStreamOpener(String orderId) => openLocationStream(ApiService.dio, orderId);

/// Opens a URL as a streamed text body with the given headers; a non-2xx
/// answer errors with [BrowserStreamStatus].
typedef FetchTextStream = Stream<String> Function(String url, {Map<String, String> headers});

/// The web build's location stream (2026-10-06).
///
/// On the web, Dio's stream response is buffered whole by dio_web_adapter and
/// an SSE response never ends, so the Dio opener never delivered a point. The
/// backend authenticates `GET /orders/:id/location/stream` from the
/// `Authorization` header only (requireAuth), which rules out the browser
/// EventSource - it cannot send headers - and there is no REST endpoint that
/// returns the rider's position to poll instead (the location columns reach
/// customers through this stream alone, delivery.columns.ts). So the web
/// opens the same stream with the browser's fetch(), which streams the body
/// and can send the header.
///
/// The access token is read for every connect (every reconnect re-reads it);
/// a 401 refreshes it once through ApiService's shared refresh and retries,
/// like the Dio interceptor does on Android. Any other HTTP error becomes a
/// [LocationStreamRefused], exactly as on Android, so the provider's
/// stop-or-retry rules are the same on both.
@visibleForTesting
Stream<String> openWebLocationStream(
  String orderId, {
  required String baseUrl,
  required Future<String?> Function() accessToken,
  required Future<String?> Function() refreshAccessToken,
  required FetchTextStream fetch,
}) {
  final url = joinApiUrl(baseUrl, '/orders/${Uri.encodeComponent(orderId)}/location/stream');
  StreamSubscription<String>? sub;
  var cancelled = false;
  late final StreamController<String> controller;

  void finish(Object? error) {
    sub = null;
    if (cancelled || controller.isClosed) return;
    if (error != null) controller.addError(error);
    controller.close();
  }

  void open(String? token, {required bool mayRefresh}) {
    if (cancelled) return;
    sub = fetch(url, headers: {
      'Accept': 'text/event-stream',
      if (token != null && token.isNotEmpty) 'Authorization': 'Bearer $token',
    }).listen(
      controller.add,
      onError: (Object e) async {
        if (e is BrowserStreamStatus) {
          if (e.statusCode == 401 && mayRefresh && !cancelled) {
            String? fresh;
            try {
              fresh = await refreshAccessToken();
            } catch (_) {}
            if (cancelled) return;
            if (fresh != null && fresh.isNotEmpty) {
              open(fresh, mayRefresh: false);
              return;
            }
          }
          finish(LocationStreamRefused(e.statusCode));
          return;
        }
        finish(e);
      },
      onDone: () => finish(null),
      cancelOnError: true,
    );
  }

  controller = StreamController<String>(
    onListen: () => unawaited(() async {
      String? token;
      try {
        token = await accessToken();
      } catch (_) {}
      open(token, mayRefresh: true);
    }()),
    onCancel: () {
      cancelled = true;
      final s = sub;
      sub = null;
      return s?.cancel();
    },
  );
  return controller.stream;
}

Stream<String> _webStreamOpener(String orderId) => openWebLocationStream(
      orderId,
      baseUrl: ApiService.dio.options.baseUrl,
      accessToken: TokenStorage.getAccessToken,
      refreshAccessToken: ApiService.refreshAccessToken,
      fetch: browserFetchTextStream,
    );

/// The production opener for this platform: fetch() on the web, Dio
/// everywhere else (Android behaviour is unchanged).
LocationStreamOpener locationStreamOpenerFor({required bool web}) =>
    web ? _webStreamOpener : dioLocationStreamOpener;

/// Frames without a terminator are dropped beyond this size so a misbehaving
/// peer can never grow the buffer without bound.
const int _maxBufferChars = 64 * 1024;

/// The customer's live view of their own order's rider location.
///
/// Mirrors OrderProvider's ChangeNotifier + injectable-dependency convention
/// and its generation-counter discipline: every [watch]/[stopWatching] bumps
/// [_generation], and any late chunk, error, done or timer belonging to an
/// earlier watch is discarded. No state is ever carried across watches.
class LocationProvider extends ChangeNotifier {
  LocationProvider({
    LocationStreamOpener? opener,
    DateTime Function()? now,
    Duration freshnessInterval = const Duration(seconds: 5),
    ReconnectDelay reconnectDelay = defaultReconnectDelay,
    double Function()? jitter,
    Duration minHealthyDuration = const Duration(seconds: 30),
  })  : _opener = opener ?? locationStreamOpenerFor(web: kIsWeb),
        _now = now ?? (() => DateTime.now().toUtc()),
        _freshnessInterval = freshnessInterval,
        _reconnectDelay = reconnectDelay,
        _jitter = jitter ?? _randomJitter,
        _minHealthy = minHealthyDuration;

  final LocationStreamOpener _opener;
  final DateTime Function() _now;
  final Duration _freshnessInterval;
  final ReconnectDelay _reconnectDelay;
  final double Function() _jitter;
  final Duration _minHealthy;

  RiderLocationPoint? _current;
  bool _closed = false;
  bool _unavailable = false;
  bool _disposed = false;

  StreamSubscription<String>? _sub;
  Timer? _ageTimer;
  Timer? _reconnectTimer;
  Timer? _healthyTimer;
  bool _healthyArmed = false;
  int _generation = 0;
  int _attempt = 0;
  String _buffer = '';
  String? _orderId;

  RiderLocationPoint? get current => _current;

  /// Null until a point arrives (and again after a close). Aged against the
  /// injected clock, so the periodic tick below is enough to move
  /// LIVE -> STALE -> OFFLINE with no new events.
  LocationFreshness? get freshness {
    final point = _current;
    return point == null ? null : classifyFreshness(point.capturedAt, now: _now());
  }

  /// The provider's clock. Exposed so a caption ("last seen 45 seconds ago")
  /// is aged against the same instant [freshness] was classified with.
  DateTime get now => _now();

  /// True once the server sent `event: closed` - the authoritative end.
  /// Never set by a dropped connection.
  bool get closed => _closed;

  /// True when the server refused the stream at connect (or on a reconnect)
  /// with a permanent client error, so the provider gave up. Distinct from
  /// [closed]: the UI can say "unavailable" without claiming a server close.
  bool get unavailable => _unavailable;

  /// Starts watching [orderId]'s rider location, superseding any earlier
  /// watch and clearing all state from it.
  void watch(String orderId) {
    if (_disposed) return;
    final gen = ++_generation;
    _stopAll();
    _current = null;
    _closed = false;
    _unavailable = false;
    _buffer = '';
    _attempt = 0;
    _orderId = orderId;
    _startAgeTimer();
    _notify();
    // A listener may have re-entered watch()/stopWatching()/dispose(): this
    // watch has been superseded, so it must not open a (second) connection.
    if (gen != _generation) return;
    _connect(gen);
  }

  /// Closes the stream and resets all state.
  void stopWatching() {
    if (_disposed) return;
    _generation++;
    _stopAll();
    _current = null;
    _closed = false;
    _unavailable = false;
    _buffer = '';
    _orderId = null;
    _notify();
  }

  @override
  void dispose() {
    _disposed = true;
    _generation++;
    _stopAll();
    super.dispose();
  }

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  void _stopAll() {
    final sub = _sub;
    _sub = null;
    if (sub != null) {
      sub.cancel().catchError((Object _) {});
    }
    _ageTimer?.cancel();
    _ageTimer = null;
    _reconnectTimer?.cancel();
    _reconnectTimer = null;
    _healthyTimer?.cancel();
    _healthyTimer = null;
  }

  /// Pure re-render tick: re-evaluates freshness from data already received.
  /// Not a network call.
  void _startAgeTimer() {
    _ageTimer = Timer.periodic(_freshnessInterval, (_) {
      if (_disposed) return;
      if (_current != null) _notify();
    });
  }

  void _connect(int gen) {
    final orderId = _orderId;
    if (orderId == null || gen != _generation) return;
    _buffer = '';
    _healthyArmed = false;
    final Stream<String> stream;
    try {
      stream = _opener(orderId);
    } catch (e) {
      _onEnded(gen, e);
      return;
    }
    _sub = stream.listen(
      (chunk) => _onChunk(gen, chunk),
      onError: (Object e) => _onEnded(gen, e),
      onDone: () => _onEnded(gen, null),
      cancelOnError: true,
    );
  }

  /// The connection ended without a server `closed` event (network loss,
  /// timeout, 5xx, server restart, or a refusal at connect).
  void _onEnded(int gen, Object? error) {
    if (_disposed || gen != _generation || _closed || _unavailable) return;
    _sub = null;
    _healthyTimer?.cancel(); // dropped before proving itself healthy
    _healthyTimer = null;

    if (error is LocationStreamRefused && error.permanent) {
      // The server deliberately said no (not authenticated / not your order /
      // not trackable): stop rather than hammer it. The last point is
      // dropped too - it belongs to a stream we may no longer see.
      _unavailable = true;
      _current = null;
      _stopAll();
      _notify();
      return;
    }

    // Keep the last point: it ages to STALE/OFFLINE via the age timer. A
    // dropped connection is never presented as `closed`.
    _reconnectTimer?.cancel();
    final base = _reconnectDelay(_attempt++);
    final j = _jitter().clamp(-_maxJitter, _maxJitter);
    final delay = Duration(microseconds: (base.inMicroseconds * (1 + j)).round());
    _reconnectTimer = Timer(delay, () {
      _reconnectTimer = null;
      if (_disposed || gen != _generation) return;
      _connect(gen);
    });
  }

  void _onChunk(int gen, String chunk) {
    if (_disposed || gen != _generation || _closed || _unavailable) return;

    // Normalising the whole pending buffer (not just the new chunk) also
    // handles a "\r\n" split between two chunks.
    var buf = (_buffer + chunk).replaceAll('\r\n', '\n');
    int idx;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      final frame = buf.substring(0, idx);
      buf = buf.substring(idx + 2);
      _armHealthyTimer(gen);
      final endsConnection = _applyFrame(frame);
      // A listener may have re-entered watch()/stopWatching(), or the frame
      // was a terminal `closed`: this stream's remaining data no longer applies.
      if (gen != _generation || _closed) return;
      if (endsConnection) {
        // A non-terminal `closed` (server_shutdown / unknown reason): the
        // server is ending this response. Treat it exactly like a drop.
        _sub?.cancel().catchError((Object _) {});
        _onEnded(gen, null);
        return;
      }
    }
    _buffer = buf.length > _maxBufferChars ? '' : buf;
  }

  /// After the first frame of a connection, the connection only counts as
  /// healthy (backoff reset) once it has then stayed up for [_minHealthy].
  /// Duplicate snapshots, heartbeats and ignored points do not reset it.
  void _armHealthyTimer(int gen) {
    if (_healthyArmed) return;
    _healthyArmed = true;
    _healthyTimer?.cancel();
    _healthyTimer = Timer(_minHealthy, () {
      _healthyTimer = null;
      if (_disposed || gen != _generation) return;
      _attempt = 0;
    });
  }

  /// Returns true when the frame ends this connection without being the
  /// authoritative close (see `closed` handling below).
  bool _applyFrame(String frame) {
    String? event;
    final dataLines = <String>[];

    for (final line in frame.split('\n')) {
      if (line.isEmpty) continue;
      if (line.startsWith(':')) continue; // heartbeat / comment
      final colon = line.indexOf(':');
      final field = colon < 0 ? line : line.substring(0, colon);
      var value = colon < 0 ? '' : line.substring(colon + 1);
      if (value.startsWith(' ')) value = value.substring(1);
      if (field == 'event') {
        event = value.trim();
      } else if (field == 'data') {
        dataLines.add(value);
      }
    }

    if (event == 'location') {
      final point = _parsePoint(dataLines.join('\n'));
      if (point == null) return false;
      final cur = _current;
      // Defense in depth: duplicates and out-of-order events never move the
      // marker backwards (or re-notify).
      if (cur != null && !point.capturedAt.isAfter(cur.capturedAt)) return false;
      _current = point;
      _notify();
    } else if (event == 'closed') {
      if (_isTerminalClose(dataLines.join('\n'))) {
        _closed = true;
        _current = null;
        _stopAll();
        _notify();
        return false;
      }
      // server_shutdown (a deploy/restart) or an unknown/absent reason is not
      // an authoritative end: keep the last point and reconnect.
      return true;
    }
    return false;
  }

  /// `not_trackable` and `delivery_closed` are the server's authoritative
  /// ends. Anything else (server_shutdown, a reason this client does not
  /// know, missing or malformed data) is not terminal.
  bool _isTerminalClose(String data) {
    try {
      final decoded = jsonDecode(data);
      if (decoded is! Map) return false;
      final reason = decoded['reason'];
      return reason == 'not_trackable' || reason == 'delivery_closed';
    } catch (_) {
      return false;
    }
  }

  RiderLocationPoint? _parsePoint(String data) {
    if (data.trim().isEmpty) return null;
    try {
      final decoded = jsonDecode(data);
      if (decoded is! Map) return null;
      return RiderLocationPoint.tryParse(decoded);
    } catch (_) {
      return null; // malformed frames are ignored, never thrown
    }
  }
}
