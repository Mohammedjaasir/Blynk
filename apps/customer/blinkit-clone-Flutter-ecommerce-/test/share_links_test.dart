import 'package:ecom/Screens/session_gate.dart';
import 'package:ecom/Services/share_links.dart';
import 'package:ecom/route_generator.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('shared product links', () {
    test('reads the product id from a /p/<id> route', () {
      expect(ShareLinks.productIdFromRoute('/p/abc-123'), 'abc-123');
      expect(ShareLinks.productIdFromRoute('/p/abc-123/'), 'abc-123');
      expect(ShareLinks.productIdFromRoute('/p/abc?utm=x'), 'abc');
    });

    test('ignores every other route', () {
      for (final r in [null, '/', '/home', '/p/', '/p', '/p/a/b', '/p/<script>', '/product']) {
        expect(ShareLinks.productIdFromRoute(r), isNull, reason: '$r');
      }
    });

    test('builds the link only from an https site address', () {
      expect(ShareLinks.productUrl('abc', baseUrl: 'https://blynk.example.com'), 'https://blynk.example.com/p/abc');
      expect(ShareLinks.productUrl('abc', baseUrl: 'https://blynk.example.com/'), 'https://blynk.example.com/p/abc');
      expect(ShareLinks.productUrl('abc', baseUrl: ''), isNull);
      expect(ShareLinks.productUrl('abc', baseUrl: 'http://blynk.example.com'), isNull);
    });

    test('shares the name alone when no site address is set', () {
      expect(ShareLinks.productShareText('Tea', 'abc', baseUrl: ''), 'Tea on Blynk');
      expect(ShareLinks.productShareText('Tea', 'abc', baseUrl: 'https://s.lk'), 'Tea on Blynk\nhttps://s.lk/p/abc');
    });
  });

  group('opening a shared link', () {
    test('a launch from a link starts at the gate, carrying the product', () {
      final routes = AppRouter.generateInitialRoutes('/p/abc');
      expect(routes, hasLength(1));
      expect(routes.single.settings.name, '/');
      final gate = (routes.single as MaterialPageRoute).builder(_FakeContext()) as SessionGate;
      expect(gate.pendingProductId, 'abc');
    });

    test('an ordinary launch starts at the gate with nothing pending', () {
      final gate = (AppRouter.generateInitialRoutes('/').single as MaterialPageRoute).builder(_FakeContext()) as SessionGate;
      expect(gate.pendingProductId, isNull);
    });
  });
}

class _FakeContext extends Fake implements BuildContext {}
