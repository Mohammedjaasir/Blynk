import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';

import 'package:ecom/Infrastructure/LocalStorage/cart_storage.dart';
import 'package:ecom/Models/product_model.dart';
import 'package:ecom/Services/Validation/app_validators.dart';

class CartLine {
  final ProductModel product;
  final int quantity;

  const CartLine({required this.product, required this.quantity});

  /// At the product's offer price while its offer runs (owner, 2026-10-09),
  /// else its regular price. A saved cart keeps the offer's end date, so a
  /// line restored after the offer ended goes back to the regular price.
  double get lineTotal => product.effectivePrice * quantity;
}

/// The saved-cart format version. A stored cart with any other version is
/// ignored (and removed) rather than guessed at.
const int kSavedCartVersion = 1;

/// More lines than any real cart has: a stored value beyond it is treated as
/// corrupt instead of being loaded.
const int kSavedCartMaxLines = 200;

/// The cart as a string for [CartStorage]: each line's quantity and the
/// product snapshot needed to draw it before the catalog has loaded.
String encodeSavedCart(List<CartLine> lines) => jsonEncode({
      'v': kSavedCartVersion,
      'lines': [
        for (final l in lines) {'product': l.product.toJson(), 'quantity': l.quantity},
      ],
    });

/// Reads what [encodeSavedCart] wrote. Returns null when [raw] is not a
/// saved cart this version understands (bad JSON, another version, the
/// wrong shape); a single unreadable line is skipped and the rest kept.
/// Quantities are kept within 1..[AppValidators.quantityMax].
List<CartLine>? decodeSavedCart(String? raw) {
  if (raw == null || raw.isEmpty) return const [];
  try {
    final decoded = jsonDecode(raw);
    if (decoded is! Map || decoded['v'] != kSavedCartVersion) return null;
    final rawLines = decoded['lines'];
    if (rawLines is! List || rawLines.length > kSavedCartMaxLines) return null;
    final lines = <CartLine>[];
    final seen = <String>{};
    for (final entry in rawLines) {
      if (entry is! Map) continue;
      final rawProduct = entry['product'];
      final rawQuantity = entry['quantity'];
      if (rawProduct is! Map || rawQuantity is! num) continue;
      final ProductModel product;
      try {
        product = ProductModel.fromJson(rawProduct.cast<String, dynamic>());
      } catch (_) {
        continue;
      }
      if (product.id.isEmpty || product.name.isEmpty || !product.sellingPrice.isFinite) continue;
      if (!rawQuantity.isFinite) continue;
      final quantity = rawQuantity.toInt();
      if (quantity < 1) continue;
      if (!seen.add(product.id)) continue;
      lines.add(CartLine(product: product, quantity: quantity.clamp(1, AppValidators.quantityMax)));
    }
    return lines;
  } catch (_) {
    return null;
  }
}

// Cart is client-side - the backend has no dedicated cart endpoint (orders
// are created directly from a list of line items). This is display/estimate
// state; the order-creation response is what's authoritative for real totals
// (see OrderProvider.placeOrder), and the server re-prices every line then.
//
// With a [CartStorage] (production: main.dart) the cart is remembered across
// app restarts and web reloads: every change is written, [restore] reads it
// back at launch, and a successful order or a logout clears it. Without one
// (tests) the cart lives in memory only.
class CartProvider extends ChangeNotifier {
  CartProvider({CartStorage? storage}) : _storage = storage;

  final CartStorage? _storage;

  final Map<String, int> _quantities = {}; // productId -> quantity
  final Map<String, ProductModel> _products = {}; // productId -> product

  Future<void>? _restoring;
  Future<void> _writes = Future<void>.value();

  // Bumped by clear(): a restore that finishes after the cart was cleared
  // (a logout or an order placed during launch) must not bring it back.
  int _clearGeneration = 0;

  List<CartLine> get lines => _quantities.entries
      .map((e) => CartLine(product: _products[e.key]!, quantity: e.value))
      .toList();

  int get itemCount => _quantities.values.fold(0, (a, b) => a + b);
  bool get isEmpty => _quantities.isEmpty;

  double get subtotal =>
      lines.fold(0.0, (sum, line) => sum + line.lineTotal);

  int quantityOf(String productId) => _quantities[productId] ?? 0;

  /// Loads the saved cart once. Lines the customer already added since
  /// launch win over the saved ones for the same product. A saved value that
  /// can't be read is removed, so it can't fail again on every launch.
  Future<void> restore() => _restoring ??= _restore();

  Future<void> _restore() async {
    final storage = _storage;
    if (storage == null) return;
    final generation = _clearGeneration;
    String? raw;
    try {
      raw = await storage.read();
    } catch (_) {
      return;
    }
    if (generation != _clearGeneration) return;
    final saved = decodeSavedCart(raw);
    if (saved == null) {
      _enqueueWrite(storage.clear);
      return;
    }
    var added = false;
    for (final line in saved) {
      if (_quantities.containsKey(line.product.id)) continue;
      _products[line.product.id] = line.product;
      _quantities[line.product.id] = line.quantity;
      added = true;
    }
    if (added) notifyListeners();
    // Lines added during launch are saved alongside the restored ones.
    if (_quantities.isNotEmpty) _persist();
  }

  /// Completes once every write queued so far has finished. For tests.
  @visibleForTesting
  Future<void> get pendingWrites => _writes;

  void _enqueueWrite(Future<void> Function() write) {
    _writes = _writes.then((_) => write()).catchError((Object _) {});
  }

  /// Writes the cart as it is right now. The value is taken synchronously
  /// and writes run one after another, so the last change always wins.
  void _persist() {
    final storage = _storage;
    if (storage == null) return;
    if (_quantities.isEmpty) {
      _enqueueWrite(storage.clear);
    } else {
      final snapshot = encodeSavedCart(lines);
      _enqueueWrite(() => storage.write(snapshot));
    }
  }

  void _changed() {
    notifyListeners();
    _persist();
  }

  /// Quantities are whole numbers, at least 1, and capped at the backend's
  /// per-item limit (order.schema.ts: quantity max 100) so the cart can't
  /// build an order the API would reject.
  void add(ProductModel product) {
    final current = _quantities[product.id] ?? 0;
    if (current >= AppValidators.quantityMax) return;
    _products[product.id] = product;
    _quantities[product.id] = current + 1;
    _changed();
  }

  /// Adds [quantity] units at once ("Order again"), within the per-item cap.
  /// Returns how many units were actually added.
  int addQuantity(ProductModel product, int quantity) {
    if (quantity <= 0) return 0;
    final current = _quantities[product.id] ?? 0;
    final next = (current + quantity).clamp(0, AppValidators.quantityMax);
    final added = next - current;
    _products[product.id] = product;
    if (added > 0) _quantities[product.id] = next;
    _changed();
    return added;
  }

  void decrement(ProductModel product) {
    final current = _quantities[product.id] ?? 0;
    if (current <= 1) {
      remove(product.id);
      return;
    }
    _quantities[product.id] = current - 1;
    _changed();
  }

  void remove(String productId) {
    _quantities.remove(productId);
    _products.remove(productId);
    _changed();
  }

  void clear() {
    _clearGeneration++;
    _quantities.clear();
    _products.clear();
    _changed();
  }
}
