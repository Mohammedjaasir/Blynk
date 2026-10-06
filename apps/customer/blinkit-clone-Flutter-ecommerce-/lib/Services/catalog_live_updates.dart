import 'dart:async';
import 'dart:convert';
import 'dart:io' show Platform;

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';

import '../Infrastructure/HttpMethods/browser_streams.dart';
import '../Infrastructure/HttpMethods/requesting_methods.dart';

/// Live catalog updates (2026-09-26).
///
/// The backend pushes a Server-Sent Event on `GET /catalog/events` the moment
/// anything a customer sees changes - a product, a category, a promotion,
/// whichever tool made the change (Postgres NOTIFY, migration 011). This
/// listens for it and calls [onChange], so a price or photo updated in Blynk
/// Ops appears on an open app within about a second instead of on the next
/// periodic refresh.
///
/// - Only `event: catalog` frames count; heartbeats and comments are ignored.
/// - A dropped line reconnects with capped exponential backoff; a frame
///   received resets it.
/// - The periodic refresh stays as the safety net: if the stream cannot be
///   held open (a proxy, a flaky network), nothing is lost, only slower.
class CatalogLiveUpdates {
  CatalogLiveUpdates({required this.open, required this.onChange});

  /// Opens the event stream as UTF-8 text chunks.
  final Stream<String> Function() open;

  /// Called once per catalog change event.
  final VoidCallback onChange;

  static const Duration _minBackoff = Duration(seconds: 1);
  static const Duration _maxBackoff = Duration(seconds: 30);

  StreamSubscription<String>? _sub;
  Timer? _retry;
  Duration _backoff = _minBackoff;
  String _buffer = '';
  bool _running = false;

  bool get isRunning => _running;

  void start() {
    if (_running) return;
    _running = true;
    _connect();
  }

  void stop() {
    _running = false;
    _retry?.cancel();
    _retry = null;
    _sub?.cancel();
    _sub = null;
    _buffer = '';
  }

  void _connect() {
    if (!_running) return;
    _sub = open().listen(
      _onChunk,
      onError: (_) => _reconnect(),
      onDone: _reconnect,
      cancelOnError: true,
    );
  }

  void _reconnect() {
    _sub = null;
    _buffer = '';
    if (!_running) return;
    _retry?.cancel();
    _retry = Timer(_backoff, _connect);
    final next = _backoff * 2;
    _backoff = next > _maxBackoff ? _maxBackoff : next;
  }

  void _onChunk(String chunk) {
    _backoff = _minBackoff;
    _buffer += chunk.replaceAll('\r\n', '\n');
    // Never let a peer that sends no frame terminator grow this unbounded.
    if (_buffer.length > 64 * 1024) _buffer = '';
    var end = _buffer.indexOf('\n\n');
    while (end >= 0) {
      final frame = _buffer.substring(0, end);
      _buffer = _buffer.substring(end + 2);
      if (frame.split('\n').any((line) => line.trim() == 'event: catalog')) {
        onChange();
      }
      end = _buffer.indexOf('\n\n');
    }
  }
}

/// Opens [url] with the browser EventSource and yields the named events as
/// SSE frames.
typedef EventSourceTextStream = Stream<String> Function(String url, {required List<String> events});

/// The real opener: `GET /catalog/events`.
///
/// - Android/iOS: a stream response on the shared Dio (base URL and all).
///   The receive timeout sits well above the server's 25 s heartbeat.
/// - Web ([web], default [kIsWeb]): the browser EventSource. Dio's web
///   adapter buffers the whole response, and this one never ends, so a Dio
///   stream delivered nothing there. The endpoint is public, so the header
///   EventSource can't send is not needed.
Stream<String> openCatalogEvents({
  bool web = kIsWeb,
  EventSourceTextStream eventSource = browserEventSourceTextStream,
  String? baseUrl,
}) {
  if (web) {
    return eventSource(
      joinApiUrl(baseUrl ?? ApiService.dio.options.baseUrl, '/catalog/events'),
      events: const ['catalog'],
    );
  }
  return _openDioCatalogEvents();
}

Stream<String> _openDioCatalogEvents() {
  final cancelToken = CancelToken();
  StreamSubscription<String>? body;
  late final StreamController<String> controller;

  Future<void> connect() async {
    try {
      final response = await ApiService.dio.get<ResponseBody>(
        '/catalog/events',
        cancelToken: cancelToken,
        options: Options(
          responseType: ResponseType.stream,
          receiveTimeout: const Duration(seconds: 60),
          headers: const {'Accept': 'text/event-stream'},
        ),
      );
      if (cancelToken.isCancelled) return;
      body = utf8.decoder.bind(response.data!.stream).listen(
        controller.add,
        onError: controller.addError,
        onDone: () {
          cancelToken.cancel();
          controller.close();
        },
      );
    } catch (e) {
      final cancelled = cancelToken.isCancelled;
      cancelToken.cancel();
      if (cancelled) return;
      controller.addError(e);
      await controller.close();
    }
  }

  controller = StreamController<String>(
    onListen: () => unawaited(connect()),
    onCancel: () {
      cancelToken.cancel();
      return body?.cancel();
    },
  );
  return controller.stream;
}

/// Widget tests have no backend: the shell does not open a live stream
/// there unless a test injects one.
bool get catalogLiveUpdatesSupported =>
    kIsWeb || !Platform.environment.containsKey('FLUTTER_TEST');
