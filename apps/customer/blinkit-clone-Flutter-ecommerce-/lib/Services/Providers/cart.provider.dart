import 'package:flutter/material.dart';

import 'package:ecom/Models/product_model.dart';
import 'package:ecom/Services/Validation/app_validators.dart';

class CartLine {
  final ProductModel product;
  final int quantity;

  const CartLine({required this.product, required this.quantity});

  double get lineTotal => product.sellingPrice * quantity;
}

// Cart is intentionally client-side only - the backend has no dedicated
// cart endpoint (orders are created directly from a list of line items).
// This is display/estimate state; the order-creation response is what's
// authoritative for real totals (see OrderProvider.placeOrder).
class CartProvider extends ChangeNotifier {
  final Map<String, int> _quantities = {}; // productId -> quantity
  final Map<String, ProductModel> _products = {}; // productId -> product

  List<CartLine> get lines => _quantities.entries
      .map((e) => CartLine(product: _products[e.key]!, quantity: e.value))
      .toList();

  int get itemCount => _quantities.values.fold(0, (a, b) => a + b);
  bool get isEmpty => _quantities.isEmpty;

  double get subtotal =>
      lines.fold(0.0, (sum, line) => sum + line.lineTotal);

  int quantityOf(String productId) => _quantities[productId] ?? 0;

  /// Quantities are whole numbers, at least 1, and capped at the backend's
  /// per-item limit (order.schema.ts: quantity max 100) so the cart can't
  /// build an order the API would reject.
  void add(ProductModel product) {
    final current = _quantities[product.id] ?? 0;
    if (current >= AppValidators.quantityMax) return;
    _products[product.id] = product;
    _quantities[product.id] = current + 1;
    notifyListeners();
  }

  void decrement(ProductModel product) {
    final current = _quantities[product.id] ?? 0;
    if (current <= 1) {
      remove(product.id);
      return;
    }
    _quantities[product.id] = current - 1;
    notifyListeners();
  }

  void remove(String productId) {
    _quantities.remove(productId);
    _products.remove(productId);
    notifyListeners();
  }

  void clear() {
    _quantities.clear();
    _products.clear();
    notifyListeners();
  }
}
