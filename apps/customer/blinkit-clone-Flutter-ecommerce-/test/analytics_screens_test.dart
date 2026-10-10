import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:ecom/Screens/product_details_screen.dart';
import 'package:ecom/Screens/products_screen.dart';
import 'package:ecom/Screens/search_screen.dart';
import 'package:ecom/Services/Providers/auth.provider.dart';
import 'package:ecom/Services/Providers/cart.provider.dart';
import 'package:ecom/Services/Providers/product.provider.dart';
import 'package:ecom/Services/analytics/analytics.dart';
import 'package:ecom/UI/Widgets/Organisms/home_screen_carousel.dart';
import 'package:ecom/app_theme.dart';

/// The shop's screens send the right GTM events (owner, 2026-10-10). The
/// dataLayer is replaced by a recorder; off the web it is a no-op anyway.

const _milkId = 'b0000001-0000-0000-0000-000000000001';
const _milk =
    '{"id":"$_milkId","category_id":"c0000001-0000-0000-0000-000000000001","category_name":"Dairy & Eggs","name":"Kotmale Fresh Milk 1L","slug":"kotmale-fresh-milk-1l","description":null,"sku":"SKU-DAI-001","barcode":"4792024001011","unit":"1 L","pack_size":"Tetra Pack","image_url":null,"selling_price":540,"is_available":true}';
const _eggs =
    '{"id":"b0000001-0000-0000-0000-000000000003","category_id":"c0000001-0000-0000-0000-000000000001","category_name":"Dairy & Eggs","name":"Farm Fresh Brown Eggs (10 Pack)","slug":"farm-fresh-brown-eggs-10-pack","description":null,"sku":"SKU-EGG-003","barcode":"4792024001035","unit":"10 pcs","pack_size":"Pulp Tray","image_url":null,"selling_price":605,"is_available":true}';
const _categories =
    '{"success":true,"data":{"categories":[{"id":"c0000001-0000-0000-0000-000000000001","name":"Dairy & Eggs","slug":"dairy-eggs","description":null,"image_url":null,"display_order":1}]}}';
const _promotion =
    '{"success":true,"data":{"promotions":[{"id":"p1","title":"Everyday Essentials","subtitle":"Milk, eggs and daily staples","image_url":null,"background_type":"SOLID","background_color":"#FFE141","background_color_end":null,"background_image_url":null,"cta_label":"Explore","cta_destination_type":"CATEGORY","cta_destination_value":"dairy-eggs","display_order":1}]}}';

Future<dynamic> _catalog(String url, Map<String, dynamic> query) async {
  if (url == '/catalog/products/$_milkId') return jsonDecode('{"success":true,"data":{"product":$_milk}}');
  if (url == '/catalog/categories') return jsonDecode(_categories);
  if (url == '/promotions') return jsonDecode(_promotion);
  if (url.startsWith('/catalog/products')) {
    return jsonDecode('{"success":true,"data":{"products":[$_milk,$_eggs],"pagination":{"page":1,"limit":100,"total":2,"total_pages":1}}}');
  }
  return jsonDecode('{"success":true,"data":{}}');
}

void main() {
  late List<Map<String, Object?>> pushed;
  late ProductProvider products;

  List<Map<String, Object?>> events(String name) => pushed.where((p) => p['event'] == name).toList();

  setUp(() {
    FlutterSecureStorage.setMockInitialValues({});
    pushed = [];
    Analytics.instance.debugUseSink(pushed.add);
    products = ProductProvider(request: _catalog);
  });
  tearDown(() => Analytics.instance.debugUseSink(null));

  Future<void> pump(WidgetTester tester, Widget home) async {
    tester.view.physicalSize = const Size(400, 900);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(MultiProvider(
      providers: [
        ChangeNotifierProvider.value(value: products),
        ChangeNotifierProvider(create: (_) => CartProvider()),
        ChangeNotifierProvider<AuthProvider>(create: (_) => AuthProvider()),
      ],
      child: MaterialApp(
        theme: AppTheme.appTHeme,
        home: home,
        onGenerateRoute: (s) => MaterialPageRoute(settings: s, builder: (_) => Scaffold(body: Text('route:${s.name}'))),
      ),
    ));
    for (var i = 0; i < 8; i++) {
      await tester.pump(const Duration(milliseconds: 120));
    }
  }

  testWidgets('product page: one view_item with id, name, category and price, however often it rebuilds', (tester) async {
    await pump(tester, const ProductDetailsScreen(productId: _milkId));
    final views = events('view_item');
    expect(views, hasLength(1));
    final item = ((views.single['ecommerce'] as Map)['items'] as List).single as Map;
    expect(item['item_id'], _milkId);
    expect(item['item_name'], 'Kotmale Fresh Milk 1L');
    expect(item['item_category'], 'Dairy & Eggs');
    expect(item['price'], 540.0);
    expect((views.single['ecommerce'] as Map)['currency'], 'LKR');
  });

  testWidgets('category listing: one view_item_list named after the category', (tester) async {
    await pump(tester, const ProductsScreen(categorySlug: 'dairy-eggs'));
    final lists = events('view_item_list');
    expect(lists, hasLength(1));
    final e = lists.single['ecommerce'] as Map;
    expect(e['item_list_id'], 'category_dairy-eggs');
    expect(e['item_list_name'], 'Dairy & Eggs');
    expect((e['items'] as List).length, 2);
  });

  testWidgets('search: a submitted term is one search event; pauses in typing are not', (tester) async {
    await pump(tester, const SearchScreen());
    await tester.enterText(find.byType(TextField), 'mi');
    await tester.pump(const Duration(milliseconds: 400));
    await tester.enterText(find.byType(TextField), 'milk');
    await tester.pump(const Duration(milliseconds: 400));
    expect(events('search'), isEmpty);
    await tester.testTextInput.receiveAction(TextInputAction.search);
    await tester.pump();
    await tester.pump();
    expect(events('search').map((e) => e['search_term']), ['milk']);
    // Leaving the screen with the same term does not count it again.
    await tester.pumpWidget(const SizedBox());
    expect(events('search'), hasLength(1));
  });

  testWidgets('Home carousel: tapping a promotion sends select_promotion', (tester) async {
    await pump(tester, const Scaffold(body: CustomScrollView(slivers: [HomeScreenCarousel()])));
    await tester.tap(find.text('Explore'));
    await tester.pump();
    final e = events('select_promotion').single['ecommerce'] as Map;
    expect(e['promotion_id'], 'p1');
    expect(e['promotion_name'], 'Everyday Essentials');
  });
}
