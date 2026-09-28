import 'dart:async';

// fake_async is flutter_test's own (already locked) dependency, as in
// location_provider_test.dart.
// ignore: depend_on_referenced_packages
import 'package:fake_async/fake_async.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:ecom/Services/catalog_live_updates.dart';

/// 2026-09-26: an Ops change took up to a refresh interval to reach an open
/// app. The backend now pushes `event: catalog`; this is the listener.
void main() {
  test('each catalog event fires once; heartbeats and comments do not', () {
    final line = StreamController<String>();
    var changes = 0;
    final live = CatalogLiveUpdates(open: () => line.stream, onChange: () => changes++)..start();

    fakeAsync((async) {
      line.add('retry: 3000\n: connected\n\n');
      line.add(': heartbeat\n\n');
      async.flushMicrotasks();
      expect(changes, 0);

      line.add('event: catalog\ndata: {"tables":["products"]}\n\n');
      async.flushMicrotasks();
      expect(changes, 1);
    });
    live.stop();
  });

  test('a frame split across network chunks is reassembled', () {
    final line = StreamController<String>();
    var changes = 0;
    final live = CatalogLiveUpdates(open: () => line.stream, onChange: () => changes++)..start();
    fakeAsync((async) {
      line.add('event: cata');
      line.add('log\r\ndata: {}\r');
      async.flushMicrotasks();
      expect(changes, 0);
      line.add('\n\r\n');
      async.flushMicrotasks();
      expect(changes, 1);
    });
    live.stop();
  });

  test('a dropped line reconnects with backoff, and stop() ends it', () {
    fakeAsync((async) {
      var opens = 0;
      final lines = <StreamController<String>>[];
      final live = CatalogLiveUpdates(
        open: () {
          opens++;
          final c = StreamController<String>();
          lines.add(c);
          return c.stream;
        },
        onChange: () {},
      )..start();
      expect(opens, 1);

      lines.last.close(); // server restarted
      async.flushMicrotasks();
      async.elapse(const Duration(milliseconds: 999));
      expect(opens, 1, reason: 'waits before reconnecting');
      async.elapse(const Duration(milliseconds: 1));
      expect(opens, 2);

      live.stop();
      lines.last.close();
      async.elapse(const Duration(minutes: 5));
      expect(opens, 2, reason: 'stopped means stopped');
    });
  });
}
