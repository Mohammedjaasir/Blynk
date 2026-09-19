// Live, end-to-end verification that what the Blynk Ops app writes is what
// the customer app shows. Nothing here is mocked: the admin side calls the
// REAL backend over HTTP exactly as the React admin does (same endpoints,
// same ADMIN role requirement), and the customer side is the real Flutter
// app talking to the same API and the same PostgreSQL behind it.
//
// Flow: admin login -> create product + upload image -> customer catalog
// shows it with its image -> admin edits -> customer sees the edit ->
// admin creates two promotions -> Home carousel shows them in the admin's
// order -> admin reorders -> carousel follows -> admin deactivates ->
// carousel drops it -> admin disables the product -> it leaves the catalog.
//
// Run with the backend up:
//   flutter test integration_test/admin_to_customer_flow_test.dart -d windows
import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:provider/provider.dart';

import 'package:ecom/main.dart' as app;
import 'package:ecom/Services/Providers/product.provider.dart';
import 'package:ecom/UI/Widgets/Organisms/home_screen_carousel.dart';

/// The seeded operations account (see backend dev_seed.ts).
const _adminPhone = '+94775551122';
const _apiBase = 'http://localhost:4000/api/v1';

/// A real 1x1 PNG: the upload endpoint sniffs magic numbers, so this has to
/// be a genuine image rather than arbitrary bytes.
final _pngBytes = Uint8List.fromList(
  base64Decode(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  ),
);

/// Real network I/O inside a widget test has to run through runAsync, or
/// the binding never lets the future complete.
Future<T> _live<T>(WidgetTester tester, Future<T> Function() body) async {
  final result = await tester.runAsync(body);
  return result as T;
}

Future<void> _settle(
  WidgetTester tester, {
  int maxPumps = 30,
  Duration step = const Duration(milliseconds: 250),
}) async {
  for (var i = 0; i < maxPumps; i++) {
    await tester.pump(step);
  }
}

/// Minimal client for the admin API - the same routes the React admin uses.
class _AdminApi {
  _AdminApi()
      : _dio = Dio(BaseOptions(baseUrl: _apiBase, validateStatus: (_) => true));

  final Dio _dio;
  String? _token;

  Options get _authed => Options(headers: {'Authorization': 'Bearer $_token'});

  Future<void> login() async {
    final request =
        await _dio.post('/auth/otp/request', data: {'phone': _adminPhone});
    if (request.statusCode != 200) {
      throw StateError('admin OTP request failed: ${request.statusCode}');
    }
    final devOtp = request.data['data']['dev_otp'] as String?;
    if (devOtp == null) {
      throw StateError('backend did not return dev_otp - is it in dev mode?');
    }

    final verify = await _dio
        .post('/auth/otp/verify', data: {'phone': _adminPhone, 'otp': devOtp});
    if (verify.statusCode != 200) {
      throw StateError('admin OTP verify failed: ${verify.statusCode}');
    }
    final user = verify.data['data']['user'];
    if (user['role'] != 'ADMIN') {
      throw StateError('seeded ops account is not an ADMIN: ${user['role']}');
    }
    _token = verify.data['data']['access_token'] as String;
  }

  Future<Response<dynamic>> send(String method, String path, {Object? data}) {
    return _dio.request(
      path,
      data: data,
      options: Options(method: method, headers: _authed.headers),
    );
  }

  Future<String> firstCategoryId() async {
    final res = await _dio.get('/catalog/categories');
    return res.data['data']['categories'][0]['id'] as String;
  }

  Future<String> uploadImage(String folder) async {
    final form = FormData.fromMap({
      'folder': folder,
      'file': MultipartFile.fromBytes(_pngBytes, filename: 'pixel.png'),
    });
    final res = await _dio.post('/admin/media', data: form, options: _authed);
    if (res.statusCode != 201) {
      throw StateError('image upload failed: ${res.statusCode} ${res.data}');
    }
    return res.data['data']['media']['url'] as String;
  }
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets(
    'live: admin catalog + promotions reach the customer app',
    (tester) async {
      final admin = _AdminApi();
      final suffix =
          DateTime.now().millisecondsSinceEpoch.toString().substring(7);
      final productName = 'E2E Test Tea $suffix';
      final firstPromo = 'E2E First $suffix';
      final secondPromo = 'E2E Second $suffix';
      final promotionIds = <String>[];
      String? productId;

      // ================= 0. The customer app boots =================
      app.main();
      await _settle(tester);
      tester
          .state<NavigatorState>(find.byType(Navigator).first)
          .pushNamedAndRemoveUntil('/home', (_) => false);
      await _settle(tester);

      final products = Provider.of<ProductProvider>(
        tester.element(find.byType(MaterialApp)),
        listen: false,
      );

      // ================= 1. Admin signs in (real OTP) =================
      await _live(tester, admin.login);

      // An unauthenticated caller must not reach the admin API at all.
      final anonymous = await _live(
        tester,
        () => Dio(BaseOptions(baseUrl: _apiBase, validateStatus: (_) => true))
            .post('/admin/promotions', data: {'title': 'should not work'}),
      );
      expect(anonymous.statusCode, 401,
          reason: 'admin routes must reject unauthenticated callers');

      try {
        // ================= 2. Admin creates a product =================
        final categoryId = await _live(tester, admin.firstCategoryId);
        final productImage =
            await _live(tester, () => admin.uploadImage('products'));

        final created = await _live(
          tester,
          () => admin.send('POST', '/admin/products', data: {
            'category_id': categoryId,
            'name': productName,
            'sku': 'E2E-SKU-$suffix',
            'unit': '200 g',
            'pack_size': 'Carton',
            'purchase_cost': 400,
            'custom_markup_percent': 25,
            'image_url': productImage,
            'is_available': true,
            'is_active': true,
          }),
        );
        expect(created.statusCode, 201, reason: 'admin product create');
        productId = created.data['data']['product']['id'] as String;
        // Selling price stays a backend calculation: 400 + 25%.
        expect(created.data['data']['product']['calculated_selling_price'], 500);

        // ================= 3. Admin creates two promotions =================
        final promoImage =
            await _live(tester, () => admin.uploadImage('promotions'));
        for (final promo in [
          {'title': firstPromo, 'order': 1, 'image': promoImage},
          {'title': secondPromo, 'order': 2, 'image': null},
        ]) {
          final res = await _live(
            tester,
            () => admin.send('POST', '/admin/promotions', data: {
              'title': promo['title'],
              'subtitle': 'Created by the live E2E test',
              'image_url': promo['image'],
              'background_type': 'GRADIENT',
              'background_color': '#FFE141',
              'background_color_end': '#FFF8E1',
              'display_order': promo['order'],
              'is_active': true,
            }),
          );
          expect(res.statusCode, 201, reason: 'admin promotion create');
          promotionIds.add(res.data['data']['promotion']['id'] as String);
        }

        // ============ 4. The customer app sees the new product ==========
        await _live(tester, () => products.loadProducts(force: true));
        await _settle(tester, maxPumps: 8);

        final mine =
            products.productsFor('').where((p) => p.id == productId).toList();
        expect(mine, hasLength(1),
            reason: 'an admin-created product must reach the customer API');
        expect(mine.single.name, productName);
        expect(mine.single.sellingPrice, 500);
        expect(mine.single.imageUrl, productImage,
            reason: 'the uploaded image URL must reach the customer app');

        // The customer's own search finds it too.
        await _live(tester, () => products.search(productName));
        await _settle(tester, maxPumps: 8);
        expect(products.searchResults.map((p) => p.id), contains(productId));

        // ================= 5. Admin edits, customer follows =============
        final editedName = '$productName Reserve';
        final update = await _live(
          tester,
          () => admin.send('PATCH', '/admin/products/$productId',
              data: {'name': editedName, 'purchase_cost': 600}),
        );
        expect(update.statusCode, 200);

        await _live(tester, () => products.loadProducts(force: true));
        await _settle(tester, maxPumps: 8);
        final updated =
            products.productsFor('').where((p) => p.id == productId).toList();
        expect(updated, hasLength(1));
        expect(updated.single.name, editedName);
        expect(updated.single.sellingPrice, 750,
            reason: '600 cost + 25% markup, calculated by the backend');

        // ============ 6. Promotions reach the Home carousel =============
        await _live(tester, () => products.loadPromotions(force: true));
        // Short settle: the carousel auto-advances every 6s, so asserting on
        // the first card has to happen before that timer fires.
        await _settle(tester, maxPumps: 6);

        expect(find.byType(HomeScreenCarousel), findsOneWidget);
        final titles = products.promotions.map((p) => p.title).toList();
        expect(titles, contains(firstPromo));
        expect(titles, contains(secondPromo));
        expect(titles.indexOf(firstPromo), lessThan(titles.indexOf(secondPromo)),
            reason: 'promotions arrive in the admin-defined display order');
        // The carousel auto-advances on real time while this test makes real
        // HTTP calls, so which card is on screen at any instant is not
        // deterministic - what matters is that it is rendering the admin's
        // promotions and nothing else.
        expect(
          find.text(firstPromo).evaluate().isNotEmpty ||
              find.text(secondPromo).evaluate().isNotEmpty,
          isTrue,
          reason: 'the carousel renders an admin-created promotion',
        );
        expect(
          products.promotions.firstWhere((p) => p.title == firstPromo).imageUrl,
          isNotNull,
          reason: 'the uploaded promotion visual reaches the customer app',
        );

        // ======= 6b. The admin's background reaches the customer ========
        final withBackground =
            products.promotions.firstWhere((p) => p.title == firstPromo);
        expect(withBackground.backgroundType, 'GRADIENT');
        expect(withBackground.backgroundColor, '#FFE141');
        expect(withBackground.hasGradient, isTrue,
            reason: 'the app can render what the admin chose');

        // Admin switches it to an image background; the customer follows.
        final backgroundImage =
            await _live(tester, () => admin.uploadImage('promotions'));
        final changeBackground = await _live(
          tester,
          () => admin.send('PATCH', '/admin/promotions/${promotionIds[0]}', data: {
            'background_type': 'IMAGE',
            'background_image_url': backgroundImage,
            'background_color': null,
            'background_color_end': null,
          }),
        );
        expect(changeBackground.statusCode, 200);

        await _live(tester, () => products.loadPromotions(force: true));
        await _settle(tester, maxPumps: 6);
        final updatedBackground =
            products.promotions.firstWhere((p) => p.title == firstPromo);
        expect(updatedBackground.backgroundType, 'IMAGE');
        expect(updatedBackground.backgroundImageUrl, backgroundImage);
        expect(updatedBackground.hasBackgroundImage, isTrue);
        // Whichever card is showing, the carousel keeps rendering after the
        // background change rather than blanking out.
        expect(
          find.text(firstPromo).evaluate().isNotEmpty ||
              find.text(secondPromo).evaluate().isNotEmpty,
          isTrue,
          reason: 'the carousel still renders after the background change',
        );

        // A gradient that loses one colour must be refused, so the customer
        // never receives a half-defined background.
        final invalid = await _live(
          tester,
          () => admin.send('PATCH', '/admin/promotions/${promotionIds[1]}', data: {
            'background_type': 'GRADIENT',
            'background_color': '#FFE141',
            'background_color_end': null,
          }),
        );
        expect(invalid.statusCode, 400);

        // ================= 7. Admin reorders =================
        final reorder = await _live(
          tester,
          () => admin.send('PATCH', '/admin/promotions/reorder', data: {
            'items': [
              {'id': promotionIds[0], 'display_order': 2},
              {'id': promotionIds[1], 'display_order': 1},
            ],
          }),
        );
        expect(reorder.statusCode, 200);

        await _live(tester, () => products.loadPromotions(force: true));
        await _settle(tester, maxPumps: 10);
        final reordered = products.promotions.map((p) => p.title).toList();
        expect(reordered.indexOf(secondPromo),
            lessThan(reordered.indexOf(firstPromo)),
            reason: 'the customer carousel follows the admin order');

        // ================= 8. Admin deactivates one =================
        final deactivate = await _live(
          tester,
          () => admin.send('PATCH', '/admin/promotions/${promotionIds[0]}',
              data: {'is_active': false}),
        );
        expect(deactivate.statusCode, 200);

        await _live(tester, () => products.loadPromotions(force: true));
        await _settle(tester, maxPumps: 10);
        expect(products.promotions.map((p) => p.title), isNot(contains(firstPromo)));
        expect(find.text(firstPromo), findsNothing);

        // ========= 9. A disabled product leaves the catalog ============
        final disable = await _live(
          tester,
          () => admin.send('PATCH', '/admin/products/$productId',
              data: {'is_active': false}),
        );
        expect(disable.statusCode, 200);

        await _live(tester, () => products.loadProducts(force: true));
        await _settle(tester, maxPumps: 8);
        expect(products.productsFor('').where((p) => p.id == productId), isEmpty,
            reason: 'a disabled product must disappear from the customer catalog');
      } finally {
        // ============ 10. Leave the store as we found it ===============
        for (final id in promotionIds) {
          await _live(tester, () => admin.send('DELETE', '/admin/promotions/$id'));
        }
        if (productId != null) {
          await _live(
            tester,
            () => admin.send('PATCH', '/admin/products/$productId',
                data: {'is_active': false}),
          );
        }
      }

      // With no active promotions left, Home hides the carousel rather than
      // falling back to built-in campaigns.
      await _live(tester, () => products.loadPromotions(force: true));
      await _settle(tester, maxPumps: 10);
      if (products.promotions.isEmpty) {
        expect(find.byType(PageView), findsNothing,
            reason: 'no active promotions -> no carousel');
      }
    },
    timeout: const Timeout(Duration(minutes: 6)),
  );
}
