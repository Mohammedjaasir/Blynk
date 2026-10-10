import 'package:flutter/foundation.dart';

import 'product_model.dart';

/// One product of "Your usuals" and how many the customer took last time
/// (owner, 2026-10-10).
@immutable
class UsualItem {
  const UsualItem({required this.product, required this.quantity});

  /// Today's product, as `GET /catalog/products/:id` sends it: today's price
  /// and availability, never the old order's.
  final ProductModel product;

  /// The quantity on the customer's last order (at least 1).
  final int quantity;
}

/// "Your usuals" (owner, 2026-10-10): the products of this customer's most
/// recent order that was not cancelled, from `GET /me/usuals`.
@immutable
class UsualsData {
  const UsualsData({
    this.orderId,
    this.orderNumber,
    this.placedAt,
    this.items = const [],
    this.unavailable = const [],
  });

  final String? orderId;
  final String? orderNumber;
  final DateTime? placedAt;

  /// Products still in the shop (some may be out of stock right now).
  final List<UsualItem> items;

  /// Names of products from that order that were deleted or switched off.
  final List<String> unavailable;

  bool get isEmpty => items.isEmpty;

  /// Products that "Add all" would put in the cart.
  List<UsualItem> get available => items.where((i) => i.product.isAvailable).toList();

  /// [raw] is the response's `data`. Null for anything that is not a usuals
  /// answer; a customer with no order yet gets an empty (not null) answer.
  static UsualsData? tryParse(Object? raw) {
    if (raw is! Map) return null;
    final order = raw['order'];
    final rawItems = raw['items'] is List ? raw['items'] as List : const [];
    final items = <UsualItem>[];
    for (final entry in rawItems) {
      if (entry is! Map) continue;
      final product = entry['product'];
      if (product is! Map || product['id'] == null) continue;
      final ProductModel parsed;
      try {
        parsed = ProductModel.fromJson(product.cast<String, dynamic>());
      } catch (_) {
        continue;
      }
      final qty = int.tryParse('${entry['quantity'] ?? 1}') ?? 1;
      items.add(UsualItem(product: parsed, quantity: qty < 1 ? 1 : qty));
    }
    final rawUnavailable = raw['unavailable'] is List ? raw['unavailable'] as List : const [];
    return UsualsData(
      orderId: order is Map ? order['id']?.toString() : null,
      orderNumber: order is Map ? order['order_number']?.toString() : null,
      placedAt: order is Map && order['placed_at'] is String ? DateTime.tryParse(order['placed_at'] as String) : null,
      items: items,
      unavailable: [
        for (final n in rawUnavailable)
          if (n != null && n.toString().trim().isNotEmpty) n.toString().trim(),
      ],
    );
  }
}
