import 'package:ecom/Models/order_model.dart';
import 'package:ecom/Models/usuals_model.dart';
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
  var addedUnits = 0;

  // Combo packs (owner, 2026-10-09): a pack still on sale goes back in as a
  // pack, at today's combo price. One that ended or sold out falls back to
  // its products, one by one, like any other item.
  final comboLineIds = <String>{};
  if (order.combos.any((c) => c.comboId != null)) {
    await products.loadCombos(force: true);
    for (final line in order.combos) {
      final combo = line.comboId == null ? null : products.comboById(line.comboId!);
      if (combo == null || !combo.isAvailable || line.quantity < 1) continue;
      final before = cart.comboQuantityOf(combo.id);
      for (var i = 0; i < line.quantity; i++) {
        cart.addCombo(combo);
      }
      final added = cart.comboQuantityOf(combo.id) - before;
      if (added > 0) {
        addedUnits += added;
        comboLineIds.add(line.id);
      }
    }
  }

  for (final item in order.items) {
    if (item.orderComboId != null && comboLineIds.contains(item.orderComboId)) continue;
    if (item.productId.isEmpty) {
      unavailable.add(item.productNameSnapshot);
      continue;
    }
    quantities[item.productId] = (quantities[item.productId] ?? 0) + item.quantity;
    names[item.productId] = item.productNameSnapshot;
  }

  await Future.wait(quantities.keys.map(products.loadProductDetail));

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

/// "Your usuals" > Add all (owner, 2026-10-10): every product of the last
/// order that is on sale now, at its last quantity, added to what is already
/// in the cart (within the per-item limit). `GET /me/usuals` already carries
/// today's product, so nothing is re-read here. Out-of-stock products and
/// the ones the server listed as gone are skipped and named.
ReorderResult addUsualsInto({required UsualsData usuals, required CartProvider cart}) {
  var addedUnits = 0;
  final unavailable = <String>[];
  for (final item in usuals.items) {
    if (!item.product.isAvailable) {
      unavailable.add(item.product.name);
      continue;
    }
    addedUnits += cart.addQuantity(item.product, item.quantity);
  }
  unavailable.addAll(usuals.unavailable);
  return ReorderResult(addedUnits: addedUnits, unavailable: unavailable, offline: false);
}

/// The snackbar after Add all: "Added 5 items. Not available now: X, Y."
String usualsAddedMessage(ReorderResult result) {
  final units = result.addedUnits;
  final missing = result.unavailable;
  final added = units == 1 ? 'Added 1 item.' : 'Added $units items.';
  if (units == 0) {
    return missing.isEmpty
        ? 'These are already in your cart.'
        : 'Nothing was added. Not available now: ${missing.join(', ')}.';
  }
  return missing.isEmpty ? added : '$added Not available now: ${missing.join(', ')}.';
}
