// Combo packs (owner, 2026-10-09): a fixed bundle of products sold at one
// price below what the products cost on their own ("Bread + Eggs x2 + Milk
// for LKR 900"). Mirrors the backend's ComboPublic exactly (GET /combos):
// only live combos are served, and a sold-out one comes with
// `is_available: false`. The server charges the combo price itself at
// POST /orders; nothing here is trusted as the final amount.
import 'package:flutter/widgets.dart';

import 'image_focal.dart';

/// One product inside a combo, for ONE pack.
@immutable
class ComboItem {
  const ComboItem({
    required this.productId,
    required this.name,
    this.slug = '',
    this.unit = '',
    this.packSize,
    this.imageUrl,
    this.imageFocalX = kFocalCentrePercent,
    this.imageFocalY = kFocalCentrePercent,
    required this.quantity,
    required this.sellingPrice,
    required this.unitPrice,
    this.isAvailable = true,
  });

  final String productId;
  final String name;
  final String slug;
  final String unit;
  final String? packSize;
  final String? imageUrl;
  final int imageFocalX;
  final int imageFocalY;

  /// Units of this product in one pack.
  final int quantity;

  /// The product's regular price.
  final double sellingPrice;

  /// What the product costs today on its own (offers included) - what
  /// [ComboModel.itemsTotal] is summed from.
  final double unitPrice;
  final bool isAvailable;

  Alignment get imageAlignment => focalAlignment(imageFocalX, imageFocalY);

  /// "Eggs ×2", or just "Bread" for one.
  String get label => quantity > 1 ? '$name ×$quantity' : name;

  static ComboItem? tryParse(Object? raw) {
    if (raw is! Map) return null;
    final productId = (raw['product_id'] ?? raw['productId'] ?? '').toString();
    final name = (raw['name'] ?? '').toString().trim();
    final quantity = int.tryParse((raw['quantity'] ?? '').toString()) ?? 0;
    if (productId.isEmpty || name.isEmpty || quantity < 1) return null;
    final selling = parseComboMoney(raw['selling_price'] ?? raw['sellingPrice']) ?? 0;
    return ComboItem(
      productId: productId,
      name: name,
      slug: (raw['slug'] ?? '').toString(),
      unit: (raw['unit'] ?? '').toString(),
      packSize: _optionalText(raw['pack_size'] ?? raw['packSize']),
      imageUrl: _optionalText(raw['image_url'] ?? raw['imageUrl']),
      imageFocalX: parseFocalPercent(raw['image_focal_x'] ?? raw['imageFocalX']),
      imageFocalY: parseFocalPercent(raw['image_focal_y'] ?? raw['imageFocalY']),
      quantity: quantity,
      sellingPrice: selling,
      unitPrice: parseComboMoney(raw['unit_price'] ?? raw['unitPrice']) ?? selling,
      isAvailable: raw['is_available'] != false && raw['isAvailable'] != false,
    );
  }

  /// The same snake_case shape [tryParse] reads (the saved cart relies on it).
  Map<String, dynamic> toJson() => {
    'product_id': productId,
    'name': name,
    'slug': slug,
    'unit': unit,
    'pack_size': packSize,
    'image_url': imageUrl,
    'image_focal_x': imageFocalX,
    'image_focal_y': imageFocalY,
    'quantity': quantity,
    'selling_price': sellingPrice,
    'unit_price': unitPrice,
    'is_available': isAvailable,
  };
}

/// A combo pack as the customer sees it.
@immutable
class ComboModel {
  const ComboModel({
    required this.id,
    required this.name,
    this.description,
    this.imageUrl,
    required this.price,
    this.endsAt,
    required this.itemsTotal,
    required this.saving,
    this.isAvailable = true,
    this.items = const [],
  });

  final String id;
  final String name;
  final String? description;
  final String? imageUrl;

  /// What one pack costs - what the server charges per pack.
  final double price;

  /// When the combo stops being sold, or null for no end date.
  final DateTime? endsAt;

  /// One pack's products at their own prices today (the struck price).
  final double itemsTotal;

  /// [itemsTotal] minus [price] for one pack, never below 0.
  final double saving;

  /// False while any product in it is sold out - the card shows Sold out.
  final bool isAvailable;
  final List<ComboItem> items;

  /// Whether the pack really costs less than its products - the only time a
  /// struck items total and a "Save" tag are drawn. Both numbers come from
  /// the backend (`items_total`, `saving`); nothing is assumed here.
  bool get hasSaving => saving > 0 && itemsTotal > price;

  /// "Bread, Eggs ×2, Milk".
  String get itemsSummary => items.map((i) => i.label).join(', ');

  /// Whether the combo is still on sale at [now] (its end date not passed).
  bool isLiveAt(DateTime now) {
    final ends = endsAt;
    return ends == null || now.isBefore(ends);
  }

  /// Null for anything that is not a usable combo (no id, no name, no
  /// positive price, no items).
  static ComboModel? tryParse(Object? raw) {
    if (raw is! Map) return null;
    final id = (raw['id'] ?? '').toString();
    final name = (raw['name'] ?? '').toString().trim();
    final price = parseComboMoney(raw['price']);
    if (id.isEmpty || name.isEmpty || price == null || price <= 0) return null;
    final rawItems = raw['items'];
    final items = [
      if (rawItems is List)
        for (final i in rawItems) ComboItem.tryParse(i),
    ].whereType<ComboItem>().toList();
    if (items.isEmpty) return null;
    final summed = items.fold<double>(0, (sum, i) => sum + i.unitPrice * i.quantity);
    final itemsTotal = parseComboMoney(raw['items_total'] ?? raw['itemsTotal']) ?? summed;
    final sentSaving = parseComboMoney(raw['saving']);
    final saving = sentSaving ?? (itemsTotal - price);
    final endsRaw = raw['ends_at'] ?? raw['endsAt'];
    return ComboModel(
      id: id,
      name: name,
      description: _optionalText(raw['description']),
      imageUrl: _optionalText(raw['image_url'] ?? raw['imageUrl']),
      price: price,
      endsAt: endsRaw is String ? DateTime.tryParse(endsRaw.trim()) : null,
      itemsTotal: itemsTotal,
      saving: saving < 0 ? 0 : saving,
      isAvailable: raw['is_available'] != false && raw['isAvailable'] != false,
      items: items,
    );
  }

  /// The same snake_case shape [tryParse] reads, so a combo written by this
  /// reads back unchanged (the saved cart's snapshot relies on it).
  Map<String, dynamic> toJson() => {
    'id': id,
    'name': name,
    'description': description,
    'image_url': imageUrl,
    'price': price,
    'ends_at': endsAt?.toIso8601String(),
    'items_total': itemsTotal,
    'saving': saving,
    'is_available': isAvailable,
    'items': [for (final i in items) i.toJson()],
  };
}

/// A number or a numeric string (a Postgres numeric can arrive as one);
/// null for anything else or a non-finite value.
double? parseComboMoney(Object? raw) {
  final double? value = switch (raw) {
    num n => n.toDouble(),
    String s => double.tryParse(s.trim()),
    _ => null,
  };
  return value != null && value.isFinite ? value : null;
}

String? _optionalText(Object? v) {
  final s = v?.toString().trim();
  return s == null || s.isEmpty ? null : s;
}
