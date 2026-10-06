/// Long-lived event streams for the web build.
///
/// On the web, Dio's `ResponseType.stream` goes through dio_web_adapter,
/// which buffers the whole response before handing it over - and a
/// Server-Sent Events response never ends, so nothing ever arrives. These use
/// the browser's own streaming primitives instead:
///
/// - [browserFetchTextStream]: `fetch()` with a streamed body. It can send an
///   `Authorization` header, which the order location stream requires
///   (`requireAuth` reads only the header; the browser `EventSource` cannot
///   set one).
/// - [browserEventSourceTextStream]: the browser `EventSource`, for public
///   streams such as `GET /catalog/events`.
///
/// Both yield SSE text in the wire format (`event: x\ndata: y\n\n`), so the
/// same frame parsers serve Android and the web. Off the web (Android, iOS,
/// tests) they throw [UnsupportedError]: those builds keep using Dio.
library;

import 'browser_streams_stub.dart' if (dart.library.js_interop) 'browser_streams_web.dart' as impl;

/// The server answered with an HTTP error status instead of a stream.
class BrowserStreamStatus implements Exception {
  const BrowserStreamStatus(this.statusCode);
  final int statusCode;

  @override
  String toString() => 'BrowserStreamStatus($statusCode)';
}

/// Opens [url] with `fetch()` and yields the body as UTF-8 text as it
/// arrives. A non-2xx answer is a [BrowserStreamStatus] error. Cancelling
/// the subscription aborts the request.
Stream<String> browserFetchTextStream(String url, {Map<String, String> headers = const {}}) =>
    impl.fetchTextStream(url, headers);

/// Opens [url] with the browser `EventSource` and yields each event named in
/// [events] re-encoded as an SSE frame. Any connection error ends the stream
/// with an error (the caller owns the reconnect backoff). Cancelling the
/// subscription closes the EventSource.
Stream<String> browserEventSourceTextStream(String url, {required List<String> events}) =>
    impl.eventSourceTextStream(url, events);

/// Joins the API base URL and a path the way Dio does for a relative path.
String joinApiUrl(String baseUrl, String path) {
  final base = baseUrl.endsWith('/') ? baseUrl.substring(0, baseUrl.length - 1) : baseUrl;
  final rel = path.startsWith('/') ? path : '/$path';
  return '$base$rel';
}

/// Re-encodes one received event as the SSE text the stream parsers read.
/// Multi-line data keeps one `data:` line per line, as on the wire.
String sseFrame(String event, String data) {
  final lines = data.replaceAll('\r\n', '\n').split('\n');
  return 'event: $event\n${lines.map((l) => 'data: $l').join('\n')}\n\n';
}
