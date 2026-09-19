import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:ecom/Infrastructure/LocalStorage/recent_searches_storage.dart';
import 'package:ecom/Models/product_model.dart';
import 'package:ecom/Screens/search_screen.dart';
import 'package:ecom/Services/Exceptions/api_exception.dart';
import 'package:ecom/Services/Providers/cart.provider.dart';
import 'package:ecom/Services/Providers/product.provider.dart';
import 'package:ecom/UI/Widgets/Atoms/app_skeleton.dart';
import 'package:ecom/app_theme.dart';

// Captured verbatim from the running backend (GET /api/v1/catalog/...).
const _realCategories =
    '{"success":true,"data":{"categories":[{"id":"c0000001-0000-0000-0000-000000000001","name":"Dairy & Eggs","slug":"dairy-eggs","description":"Fresh milk, butter, cheese, and farm eggs","image_url":null,"display_order":1},{"id":"c0000001-0000-0000-0000-000000000002","name":"Biscuits & Snacks","slug":"biscuits-snacks","description":"Crackers, cookies, and Sri Lankan tea snacks","image_url":null,"display_order":2}]}}';
const _realMilkSearch =
    '{"success":true,"data":{"products":[{"id":"b0000001-0000-0000-0000-000000000001","category_id":"c0000001-0000-0000-0000-000000000001","category_name":"Dairy & Eggs","name":"Kotmale Fresh Milk 1L","slug":"kotmale-fresh-milk-1l","description":null,"sku":"SKU-DAI-001","barcode":"4792024001011","unit":"1 L","pack_size":"Tetra Pack","image_url":null,"selling_price":540,"is_available":true}],"pagination":{"page":1,"limit":50,"total":1,"total_pages":1}}}';
const _realEmptySearch =
    '{"success":true,"data":{"products":[],"pagination":{"page":1,"limit":20,"total":0,"total_pages":1}}}';

class _FakeCatalog {
  final List<Map<String, dynamic>> searchCalls = [];
  Future<dynamic> Function(Map<String, dynamic> query)? onSearch;
  bool failCategories = false;

  Future<dynamic> call(String url, Map<String, dynamic> query) async {
    if (url == '/catalog/categories') {
      if (failCategories) throw ApiException(503, 'down');
      return jsonDecode(_realCategories);
    }
    if (query.containsKey('search')) {
      searchCalls.add(query);
      if (onSearch != null) return onSearch!(query);
      return query['search'] == 'milk' && query['category_slug'] == null
          ? jsonDecode(_realMilkSearch)
          : jsonDecode(_realEmptySearch);
    }
    return jsonDecode(_realEmptySearch);
  }
}

void main() {
  late _FakeCatalog catalog;
  late ProductProvider products;
  late CartProvider cart;
  RouteSettings? lastRoute;

  setUp(() {
    FlutterSecureStorage.setMockInitialValues({});
    catalog = _FakeCatalog();
    products = ProductProvider(request: catalog.call);
    cart = CartProvider();
  });

  Future<void> pumpSearch(WidgetTester tester) async {
    tester.view.physicalSize = const Size(400, 900);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      MultiProvider(
        providers: [
          ChangeNotifierProvider.value(value: products),
          ChangeNotifierProvider.value(value: cart),
        ],
        child: MaterialApp(
          theme: AppTheme.appTHeme,
          home: const SearchScreen(),
          onGenerateRoute: (settings) {
            lastRoute = settings;
            return MaterialPageRoute(
              builder: (_) => Scaffold(body: Text('route:${settings.name}')),
            );
          },
        ),
      ),
    );
    await tester.pump();
    await tester.pump();
  }

  Future<void> typeQuery(WidgetTester tester, String text) async {
    await tester.enterText(find.byType(TextField), text);
    await tester.pump();
  }

  Future<void> passDebounce(WidgetTester tester) async {
    await tester.pump(const Duration(milliseconds: 400));
    await tester.pump();
    await tester.pump();
  }

  testWidgets('opens on a clean initial state with real categories and no fake recents',
      (tester) async {
    await pumpSearch(tester);

    expect(find.text('Search'), findsOneWidget);
    expect(find.text('RECENT SEARCHES'), findsNothing);
    expect(find.text('BROWSE CATEGORIES'), findsOneWidget);
    expect(find.text('Dairy & Eggs'), findsOneWidget);
    expect(find.byTooltip('Clear search'), findsNothing);
  });

  testWidgets('shows a plain prompt when there are no recents and no categories',
      (tester) async {
    catalog.failCategories = true;
    await pumpSearch(tester);

    expect(find.text('What are you looking for?'), findsOneWidget);
  });

  testWidgets('typing debounces into one real search and renders real results',
      (tester) async {
    await pumpSearch(tester);

    for (final partial in ['m', 'mi', 'mil', 'milk']) {
      await typeQuery(tester, partial);
      await tester.pump(const Duration(milliseconds: 100));
    }
    // Still inside the debounce window: skeletons, no request yet.
    expect(catalog.searchCalls, isEmpty);
    expect(find.byType(ProductCardSkeleton), findsWidgets);

    await passDebounce(tester);

    expect(catalog.searchCalls, hasLength(1));
    expect(catalog.searchCalls.single['search'], 'milk');
    expect(find.text('Kotmale Fresh Milk 1L'), findsOneWidget);
    expect(find.text('Rs. 540'), findsOneWidget);
    expect(find.text('"milk"'), findsOneWidget);
    // Count comes from the backend's pagination.total, not a made-up number.
    expect(find.text('1 product'), findsOneWidget);
  });

  testWidgets('clear button empties the query and returns to the initial state',
      (tester) async {
    await pumpSearch(tester);
    await typeQuery(tester, 'milk');
    await passDebounce(tester);
    expect(find.text('Kotmale Fresh Milk 1L'), findsOneWidget);

    await tester.tap(find.byTooltip('Clear search'));
    await tester.pump();

    expect(find.text('Kotmale Fresh Milk 1L'), findsNothing);
    expect(find.text('BROWSE CATEGORIES'), findsOneWidget);
    expect(tester.widget<TextField>(find.byType(TextField)).controller!.text, isEmpty);
    expect(products.lastQuery, isEmpty);
  });

  testWidgets('no matches shows the friendly empty state with a way out',
      (tester) async {
    await pumpSearch(tester);
    await typeQuery(tester, 'zzqx');
    await passDebounce(tester);

    expect(find.text('Sorry!'), findsOneWidget);
    expect(find.textContaining('We couldn\'t find anything for "zzqx"'), findsOneWidget);

    await tester.tap(find.text('Browse Categories'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));
    expect(find.text('route:/categories'), findsOneWidget);
  });

  testWidgets('keeps showing skeletons while the request is in flight',
      (tester) async {
    final pending = Completer<dynamic>();
    catalog.onSearch = (_) => pending.future;
    await pumpSearch(tester);
    await typeQuery(tester, 'milk');
    await passDebounce(tester);

    expect(products.isSearching, isTrue);
    expect(find.byType(ProductCardSkeleton), findsWidgets);
    expect(find.text('Kotmale Fresh Milk 1L'), findsNothing);

    pending.complete(jsonDecode(_realMilkSearch));
    await tester.pump();
    await tester.pump();
    expect(find.byType(ProductCardSkeleton), findsNothing);
    expect(find.text('Kotmale Fresh Milk 1L'), findsOneWidget);
  });

  testWidgets('a failed search shows a friendly error and Try Again recovers',
      (tester) async {
    catalog.onSearch = (_) async =>
        throw ApiException(500, 'relation "products" does not exist');
    await pumpSearch(tester);
    await typeQuery(tester, 'milk');
    await passDebounce(tester);

    expect(find.text("Couldn't load results"), findsOneWidget);
    // The raw backend message must never reach the screen.
    expect(find.textContaining('relation'), findsNothing);

    catalog.onSearch = (_) async => jsonDecode(_realMilkSearch);
    await tester.tap(find.text('Try Again'));
    await tester.pump();
    await tester.pump();

    expect(find.text('Kotmale Fresh Milk 1L'), findsOneWidget);
  });

  testWidgets('category chip narrows the real search by category_slug',
      (tester) async {
    await pumpSearch(tester);
    await typeQuery(tester, 'milk');
    await passDebounce(tester);

    // The chip row scrolls horizontally; this chip starts past the edge.
    final chip = find.widgetWithText(ChoiceChip, 'Biscuits & Snacks');
    await tester.ensureVisible(chip);
    await tester.pump();
    await tester.tap(chip);
    await tester.pump();
    await tester.pump();

    expect(catalog.searchCalls.last['category_slug'], 'biscuits-snacks');
    expect(find.textContaining('in Biscuits & Snacks'), findsOneWidget);

    // Scrolling to the last chip unbuilt "All" at the start of the lazily
    // built row - scroll back before tapping it.
    await tester.drag(find.byType(ChoiceChip).first, const Offset(600, 0));
    await tester.pump();
    final allChip = find.widgetWithText(ChoiceChip, 'All');
    await tester.tap(allChip);
    await tester.pump();
    await tester.pump();
    expect(catalog.searchCalls.last.containsKey('category_slug'), isFalse);
    expect(find.text('Kotmale Fresh Milk 1L'), findsOneWidget);
  });

  testWidgets('submitting saves a recent search that can be re-run and cleared',
      (tester) async {
    await pumpSearch(tester);
    await typeQuery(tester, 'milk');
    await tester.testTextInput.receiveAction(TextInputAction.search);
    await tester.pump();
    await tester.pump();

    expect(await RecentSearchesStorage.load(), ['milk']);

    // A fresh visit to the screen shows it.
    await tester.pumpWidget(const SizedBox());
    await pumpSearch(tester);
    expect(find.text('RECENT SEARCHES'), findsOneWidget);
    expect(find.text('milk'), findsOneWidget);

    await tester.tap(find.text('milk'));
    await tester.pump();
    await tester.pump();
    expect(find.text('Kotmale Fresh Milk 1L'), findsOneWidget);

    await tester.tap(find.byTooltip('Clear search'));
    await tester.pump();
    await tester.tap(find.text('Clear'));
    await tester.pump();
    await tester.pump();
    expect(find.text('RECENT SEARCHES'), findsNothing);
    expect(await RecentSearchesStorage.load(), isEmpty);
  });

  testWidgets('tapping a result opens that real product', (tester) async {
    await pumpSearch(tester);
    await typeQuery(tester, 'milk');
    await passDebounce(tester);

    await tester.tap(find.text('Kotmale Fresh Milk 1L'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));

    // Product Details is its own route, handed the exact product tapped
    // (its rendering is covered in product_details_screen_test.dart).
    expect(find.text('route:/product'), findsOneWidget);
    final opened = lastRoute!.arguments as ProductModel;
    expect(opened.id, 'b0000001-0000-0000-0000-000000000001');
    expect(opened.name, 'Kotmale Fresh Milk 1L');
    expect(opened.sellingPrice, 540);
  });

  testWidgets('ADD from search goes through the shared CartProvider',
      (tester) async {
    await pumpSearch(tester);
    await typeQuery(tester, 'milk');
    await passDebounce(tester);

    await tester.tap(find.text('ADD'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));

    expect(cart.itemCount, 1);
    expect(cart.lines.single.product.name, 'Kotmale Fresh Milk 1L');
    // The floating cart bar reflects the same state.
    expect(find.text('1 item'), findsOneWidget);
    expect(find.text('View Cart'), findsOneWidget);
    // The card's ADD has become a stepper.
    expect(find.text('ADD'), findsNothing);
    expect(find.bySemanticsLabel('Add one more Kotmale Fresh Milk 1L'), findsOneWidget);
  });
}
