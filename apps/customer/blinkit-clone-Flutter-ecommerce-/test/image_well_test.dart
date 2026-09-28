import 'dart:async';
import 'dart:io';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:ecom/Models/product_model.dart';
import 'package:ecom/UI/Widgets/Atoms/image_well.dart';
import 'package:ecom/design/tokens.dart';

import 'fixtures/component_host.dart';

/// 40 of the 41 products in the live catalogue have no image, so the no-image
/// fallback is the app's DEFAULT appearance, not an edge case. The first group
/// is the one that matters: the well must occupy exactly the same geometry
/// with and without a photo, so uploading images later moves nothing on any
/// screen.

String _url(String tag) => 'https://images.blynk.test/$tag.png';

/// Pumps [widget] and waits, in the real async zone, until the network image
/// has actually decoded — polling rather than sleeping a fixed time, so the
/// test cannot pass or fail on machine speed.
Future<void> _pumpUntilLoaded(WidgetTester tester, Widget widget) async {
  await tester.runAsync(() async {
    await tester.pumpWidget(widget);
    for (var i = 0; i < 100; i++) {
      await Future<void>.delayed(const Duration(milliseconds: 10));
      await tester.pump();
      final raw = tester.widgetList<RawImage>(find.byType(RawImage));
      if (raw.isNotEmpty && raw.first.image != null) return;
    }
  });
  await tester.pumpAndSettle();
}

ProductModel _product({String? imageUrl, String category = 'Dairy & Eggs'}) => ProductModel(
      id: 'p1',
      categoryId: 'c1',
      categoryName: category,
      name: 'Kotmale Fresh Milk',
      slug: 'kotmale-fresh-milk',
      sku: 'SKU-1',
      unit: '1 L',
      imageUrl: imageUrl,
      sellingPrice: 605.5,
      isAvailable: true,
    );

// ---------------------------------------------------------------------------
// A real decodable PNG served over a fake HttpClient, so the "with an image"
// branch really renders a loaded photo. flutter_test's own client 400s every
// request, which would make both sides of the comparison the fallback and the
// test vacuous - the failure mode this repo keeps finding in its guards.
// ---------------------------------------------------------------------------

Future<Uint8List> _greenPng(int side) async {
  final recorder = ui.PictureRecorder();
  Canvas(recorder).drawRect(
    Rect.fromLTWH(0, 0, side.toDouble(), side.toDouble()),
    Paint()..color = const Color(0xFF00AA55),
  );
  final image = await recorder.endRecording().toImage(side, side);
  final data = await image.toByteData(format: ui.ImageByteFormat.png);
  return data!.buffer.asUint8List();
}

class _FakeHttpClient implements HttpClient {
  _FakeHttpClient(this.bytes, this.statusCode);

  final Uint8List bytes;
  final int statusCode;

  @override
  bool autoUncompress = true;

  @override
  Future<HttpClientRequest> getUrl(Uri url) async => _FakeRequest(url, bytes, statusCode);

  @override
  Future<HttpClientRequest> openUrl(String method, Uri url) async =>
      _FakeRequest(url, bytes, statusCode);

  @override
  dynamic noSuchMethod(Invocation invocation) => null;
}

class _FakeRequest implements HttpClientRequest {
  _FakeRequest(this.uri, this.bytes, this.statusCode);

  @override
  final Uri uri;

  final Uint8List bytes;
  final int statusCode;

  @override
  final HttpHeaders headers = _FakeHeaders();

  @override
  Future<HttpClientResponse> close() async => _FakeResponse(bytes, statusCode);

  @override
  dynamic noSuchMethod(Invocation invocation) => null;
}

class _FakeHeaders implements HttpHeaders {
  @override
  dynamic noSuchMethod(Invocation invocation) => null;
}

class _FakeResponse extends Stream<List<int>> implements HttpClientResponse {
  _FakeResponse(this.bytes, this.statusCode);

  final Uint8List bytes;

  @override
  final int statusCode;

  @override
  int get contentLength => bytes.length;

  @override
  HttpClientResponseCompressionState get compressionState =>
      HttpClientResponseCompressionState.notCompressed;

  @override
  HttpHeaders get headers => _FakeHeaders();

  @override
  StreamSubscription<List<int>> listen(
    void Function(List<int> event)? onData, {
    Function? onError,
    void Function()? onDone,
    bool? cancelOnError,
  }) =>
      Stream<List<int>>.value(bytes).listen(
        onData,
        onError: onError,
        onDone: onDone,
        cancelOnError: cancelOnError,
      );

  @override
  dynamic noSuchMethod(Invocation invocation) => null;
}

Widget _wellInABox(Widget child, {double side = 160}) =>
    Center(child: SizedBox(width: side, height: side, child: child));

Finder _discOf() =>
    find.descendant(of: find.byType(BlynkImageWell), matching: find.byType(DecoratedBox)).last;

void main() {
  late Uint8List png;

  setUpAll(() async {
    TestWidgetsFlutterBinding.ensureInitialized();
    png = await _greenPng(64);
  });

  tearDown(() {
    imageCache.clear();
    imageCache.clearLiveImages();
  });

  /// Serves [png] with [status] to `Image.network` for the duration of [body].
  ///
  /// Deliberately NOT an `HttpOverrides`: `NetworkImage` caches ONE static
  /// `HttpClient` per isolate, built from whatever overrides happened to be
  /// installed the first time any test in the file loaded an image — so a
  /// per-test `HttpOverrides` is silently ignored by every test but the first,
  /// and the 404 case below "passed" while actually serving a 200. The debug
  /// hook is consulted on every request instead.
  ///
  /// It has to be unset again *inside* the test body, because `testWidgets`
  /// asserts every painting debug hook is clear before a test may finish.
  Future<void> serving(Future<void> Function() body, {int status = HttpStatus.ok}) async {
    debugNetworkImageHttpClientProvider = () => _FakeHttpClient(png, status);
    try {
      await body();
    } finally {
      debugNetworkImageHttpClientProvider = null;
    }
  }

  group('ZERO LAYOUT SHIFT - the fallback occupies identical geometry', () {
    for (final side in <double>[72, 160, 320]) {
      testWidgets('$side dp: the well is the same box with and without a photo, and the photo fills it',
          (tester) async {
        // One URL per test: a cached or still-in-flight load from a
        // neighbouring test must not be able to decide this one's outcome.
        final url = _url('shift-$side');

        await tester.pumpWidget(componentHost(
          tester,
          _wellInABox(const BlynkImageWell(), side: side),
        ));
        final withoutWell = tester.getRect(find.byType(BlynkImageWell));
        final withoutContent = tester.getRect(find.byType(BlynkImageContent));

        await serving(() async {
          await _pumpUntilLoaded(
            tester,
            componentHost(tester, _wellInABox(BlynkImageWell(imageUrl: url), side: side)),
          );

          // The photo really loaded. Without this the test compares two
          // fallbacks and proves nothing.
          expect(find.byType(RawImage), findsOneWidget);
          expect(tester.widget<RawImage>(find.byType(RawImage)).image, isNotNull);

          // The well itself is the same box either way: nothing AROUND it
          // moves when a photo arrives, which is the shift this guards.
          expect(tester.getRect(find.byType(BlynkImageWell)), withoutWell);
          // 2026-09-26: a photo fills its well edge to edge - the tinted
          // inset that framed it read as a grey border and was removed. So
          // the picture's box is the well's box, while the fallback keeps
          // its inset medallion.
          expect(tester.getRect(find.byType(BlynkImageContent)), withoutWell);
          expect(withoutContent, withoutWell.deflate(BlynkWell.inset));
        });
      });
    }

    testWidgets('the box is already right while the photo is still loading', (tester) async {
      await tester.pumpWidget(componentHost(tester, _wellInABox(const BlynkImageWell())));
      final settled = tester.getRect(find.byType(BlynkImageWell));

      await serving(() async {
        await tester.pumpWidget(
          componentHost(tester, _wellInABox(BlynkImageWell(imageUrl: _url('loading')))),
        );
        // One frame only: nothing has been decoded yet, and nothing has moved.
        expect(tester.getRect(find.byType(BlynkImageWell)), settled);
        // ...and the branded fallback is what holds the box meanwhile - never
        // a blank hole and never a spinner a photo would later displace.
        expect(find.byIcon(BlynkIcons.product), findsOneWidget);

        // Unmount before the in-flight load can settle into the next test.
        await tester.pumpWidget(const SizedBox.shrink());
      });
    });

    testWidgets('a load failure falls back without throwing and without resizing',
        (tester) async {
      final missing = _url('missing');

      await tester.pumpWidget(componentHost(tester, _wellInABox(const BlynkImageWell())));
      final settled = tester.getRect(find.byType(BlynkImageWell));

      await serving(status: HttpStatus.notFound, () async {
        await tester.runAsync(() async {
          await tester.pumpWidget(
            componentHost(tester, _wellInABox(BlynkImageWell(imageUrl: missing))),
          );
          await Future<void>.delayed(const Duration(milliseconds: 120));
        });
        await tester.pumpAndSettle();

        expect(tester.takeException(), isNull);
        expect(tester.getRect(find.byType(BlynkImageWell)), settled);
        expect(find.byIcon(BlynkIcons.product), findsOneWidget);
      });
    });
  });

  group('the fallback is deliberate and Blynk-branded', () {
    testWidgets('well tint, the card radius and NO border', (tester) async {
      await tester.pumpWidget(componentHost(tester, _wellInABox(const BlynkImageWell())));
      final decoration = tester
          .widget<DecoratedBox>(
            find
                .descendant(of: find.byType(BlynkImageWell), matching: find.byType(DecoratedBox))
                .first,
          )
          .decoration as BoxDecoration;

      expect(decoration.color, BlynkWell.tint);
      expect(decoration.color, BlynkCardProduct.imageWell);
      expect(decoration.borderRadius, BlynkWell.radius);
      expect(decoration.border, isNull, reason: 'plan 4.1: the well has no border');
    });

    testWidgets('a medallion and a low-emphasis glyph, both from tokens', (tester) async {
      await tester.pumpWidget(componentHost(tester, _wellInABox(const BlynkImageWell())));
      final disc = tester.widget<DecoratedBox>(_discOf()).decoration as BoxDecoration;
      expect(disc.color, BlynkWell.fallbackDisc);
      expect(disc.shape, BoxShape.circle);

      final icon = tester.widget<Icon>(find.byType(Icon));
      expect(icon.color, BlynkWell.fallbackGlyph);
      expect(icon.color, isNot(BlynkColors.ink),
          reason: 'the fallback must never compete with the product name');
    });

    testWidgets('never a broken-image glyph and never "image unavailable" text', (tester) async {
      await tester.pumpWidget(componentHost(tester, _wellInABox(const BlynkImageWell())));
      for (final banned in <IconData>[
        Icons.broken_image,
        Icons.broken_image_outlined,
        Icons.image_not_supported,
        Icons.image_not_supported_outlined,
        Icons.hide_image,
        Icons.hide_image_outlined,
      ]) {
        expect(find.byIcon(banned), findsNothing);
      }
      expect(
        find.descendant(of: find.byType(BlynkImageWell), matching: find.byType(Text)),
        findsNothing,
        reason: 'the fallback says nothing at all - no "image unavailable"',
      );
    });

    testWidgets('the medallion scales with the box, so one composition fits every surface',
        (tester) async {
      await tester
          .pumpWidget(componentHost(tester, _wellInABox(const BlynkImageWell(), side: 72)));
      final small = tester.getSize(_discOf()).width;
      await tester
          .pumpWidget(componentHost(tester, _wellInABox(const BlynkImageWell(), side: 240)));
      final large = tester.getSize(_discOf()).width;

      expect(large, greaterThan(small));
      expect(small, greaterThanOrEqualTo(BlynkWell.fallbackDiscMin));
      expect(large, lessThanOrEqualTo(BlynkWell.fallbackDiscMax));
    });
  });

  group("the glyph comes from the product's real category", () {
    test('known categories map to their own glyph; anything else is the neutral one', () {
      expect(fallbackGlyphFor('Dairy & Eggs'), BlynkIcons.groupDairy);
      expect(fallbackGlyphFor('Bakery'), BlynkIcons.groupBakery);
      expect(fallbackGlyphFor('Fruits & Vegetables'), BlynkIcons.groupProduce);
      expect(fallbackGlyphFor('Beverages'), BlynkIcons.groupDrinks);
      expect(fallbackGlyphFor('Baby Care'), BlynkIcons.groupBaby);
      // Nothing is guessed: an unknown or empty category is not invented.
      expect(fallbackGlyphFor('Something New'), BlynkIcons.product);
      expect(fallbackGlyphFor(''), BlynkIcons.product);
    });

    testWidgets('ProductImageWell renders it and speaks the product name', (tester) async {
      final handle = tester.ensureSemantics();
      await tester.pumpWidget(componentHost(
        tester,
        _wellInABox(ProductImageWell(product: _product(category: 'Bakery'))),
      ));
      expect(find.byIcon(BlynkIcons.groupBakery), findsOneWidget);
      expect(find.bySemanticsLabel('Kotmale Fresh Milk'), findsOneWidget);
      handle.dispose();
    });

    testWidgets('semantic: false leaves no image node for the card to duplicate', (tester) async {
      final handle = tester.ensureSemantics();
      await tester.pumpWidget(componentHost(
        tester,
        _wellInABox(ProductImageWell(product: _product(), semantic: false)),
      ));
      expect(find.bySemanticsLabel('Kotmale Fresh Milk'), findsNothing);
      handle.dispose();
    });
  });
}
