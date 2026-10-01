import 'package:ecom/Models/order_model.dart';
import 'package:ecom/Services/Providers/cart.provider.dart';
import 'package:ecom/Services/Providers/product.provider.dart';

/// What "Order again" did (2026-09-30).
class ReorderResult {
  const ReorderResult({required this.addedUnits, required this.unavailable, required this.offline});

  /// Units put in the cart, e.g. 2 milk + 1 butter = 3.
  final int addedUnits;

  /// Names of products that are gone or out of stock right now.
  final List<String> unavailable;

  /// Nothing could be checked because the connection failed.
  final bool offline;
}

/// Puts a past order's products back in the cart at the same quantities.
///
/// Every product is re-read from the catalog first (GET /catalog/products/:id),
/// so the cart gets today's price and availability, never the price the old
/// order was placed at. Products that were deleted, deactivated or are out of
/// stock are skipped and named. Quantities add to whatever is already in the
/// cart, within the cart's per-item limit.
Future<ReorderResult> reorderInto({
  required OrderModel order,
  required ProductProvider products,
  required CartProvider cart,
}) async {
  final quantities = <String, int>{};
  final names = <String, String>{};
  final unavailable = <String>[];

  for (final item in order.items) {
    if (item.productId.isEmpty) {
      unavailable.add(item.productNameSnapshot);
      continue;
    }
    quantities[item.productId] = (quantities[item.productId] ?? 0) + item.quantity;
    names[item.productId] = item.productNameSnapshot;
  }

  await Future.wait(quantities.keys.map(products.loadProductDetail));

  var addedUnits = 0;
  var networkFailures = 0;
  for (final entry in quantities.entries) {
    final failure = products.productDetailFailure(entry.key);
    if (failure == ProductDetailFailure.network) {
      networkFailures++;
      unavailable.add(names[entry.key]!);
      continue;
    }
    final product = products.productDetail(entry.key);
    if (failure == ProductDetailFailure.notFound || product == null || !product.isAvailable) {
      unavailable.add(names[entry.key]!);
      continue;
    }
    addedUnits += cart.addQuantity(product, entry.value);
  }

  return ReorderResult(
    addedUnits: addedUnits,
    unavailable: unavailable,
    offline: quantities.isNotEmpty && networkFailures == quantities.length,
  );
}

/// Orders that are over: these offer "Order again".
bool canReorder(OrderModel order) {
  if (order.items.isEmpty) return false;
  switch (order.status) {
    case OrderStatus.delivered:
    case OrderStatus.cancelled:
    case OrderStatus.failed:
    case OrderStatus.customerUnavailable:
      return true;
    default:
      return false;
  }
}
