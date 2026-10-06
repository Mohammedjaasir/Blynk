import 'dart:async';
import 'dart:convert';
import 'dart:js_interop';

import 'package:web/web.dart' as web;

import 'browser_streams.dart';

/// fetch() with a streamed body: chunks are decoded as UTF-8 (a stateful
/// decoder, so a character split across chunks is reassembled) and passed on
/// as they arrive.
Stream<String> fetchTextStream(String url, Map<String, String> headers) {
  final abort = web.AbortController();
  var cancelled = false;
  web.ReadableStreamDefaultReader? reader;
  late final StreamController<String> controller;

  Future<void> run() async {
    final bytes = StreamController<List<int>>();
    final decodedDone = Completer<void>();
    utf8.decoder.bind(bytes.stream).listen(
          controller.add,
          onError: controller.addError,
          onDone: decodedDone.complete,
        );
    try {
      final h = web.Headers();
      headers.forEach((name, value) => h.append(name, value));
      final response = await web.window
          .fetch(
            url.toJS,
            web.RequestInit(method: 'GET', headers: h, cache: 'no-store', signal: abort.signal),
          )
          .toDart;
      if (cancelled) return;
      if (!response.ok) throw BrowserStreamStatus(response.status);
      final body = response.body;
      if (body == null) return;
      final r = body.getReader() as web.ReadableStreamDefaultReader;
      reader = r;
      while (!cancelled) {
        final result = await r.read().toDart;
        if (result.done) break;
        final value = result.value;
        if (value == null) continue;
        bytes.add((value as JSUint8Array).toDart);
      }
    } catch (e) {
      if (!cancelled) controller.addError(e);
    } finally {
      await bytes.close();
      await decodedDone.future;
      if (!controller.isClosed) unawaited(controller.close());
    }
  }

  controller = StreamController<String>(
    onListen: () => unawaited(run()),
    onCancel: () {
      cancelled = true;
      try {
        reader?.cancel();
      } catch (_) {}
      abort.abort();
    },
  );
  return controller.stream;
}

/// The browser EventSource. Only the named [events] are passed on; an error
/// closes the EventSource (so the browser does not retry behind the
/// caller's back) and ends the stream.
Stream<String> eventSourceTextStream(String url, List<String> events) {
  web.EventSource? source;
  late final StreamController<String> controller;

  void close() {
    source?.close();
    source = null;
  }

  controller = StreamController<String>(
    onListen: () {
      try {
        final es = web.EventSource(url);
        source = es;
        for (final name in events) {
          es.addEventListener(
            name,
            ((web.MessageEvent e) {
              final data = e.data;
              controller.add(sseFrame(name, data.isA<JSString>() ? (data as JSString).toDart : ''));
            }).toJS,
          );
        }
        es.onerror = ((web.Event _) {
          close();
          if (!controller.isClosed) {
            controller.addError(StateError('EventSource connection failed'));
            controller.close();
          }
        }).toJS;
      } catch (e) {
        close();
        controller.addError(e);
        controller.close();
      }
    },
    onCancel: close,
  );
  return controller.stream;
}
