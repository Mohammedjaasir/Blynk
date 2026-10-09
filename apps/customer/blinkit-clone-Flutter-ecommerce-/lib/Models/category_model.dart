import 'package:flutter/widgets.dart';

import 'image_focal.dart';

class CategoryModel {
  final String id;
  final String name;
  final String slug;
  final String? description;
  final String? imageUrl;
  final int displayOrder;

  /// Migration 010: the point of [imageUrl] that must stay visible when the
  /// tile crops it, set by the operator in Blynk Ops. 50/50 is the centre.
  final int imageFocalX;
  final int imageFocalY;

  /// Migration 026: the category this one sits inside ("Bread" in
  /// "Bakery"), or null for a top-level category. One level only.
  final String? parentId;

  bool get isTopLevel => parentId == null;

  /// Category offer (owner, 2026-10-09): "10% off everything here". The
  /// customer API sends it only while the offer runs (a sub-category carries
  /// the larger of its own and its parent's); null otherwise, and on a
  /// backend that predates category offers. Product prices already include
  /// it (`offer_price`), so this is only ever the banner's wording.
  final double? offerPercent;

  /// When the category offer ends, or null for no end date.
  final DateTime? offerEndsAt;

  /// Whether the category offer is running at [now]: a percentage between 0
  /// and 100 and an end date (if any) not yet passed.
  bool isOfferActiveAt(DateTime now) {
    final percent = offerPercent;
    if (percent == null || percent <= 0 || percent >= 100) return false;
    final ends = offerEndsAt;
    return ends == null || now.isBefore(ends);
  }

  bool get isOfferActive => isOfferActiveAt(DateTime.now());

  /// "10%" or "12.5%" - whole numbers without decimals.
  String get offerPercentLabel {
    final text = (offerPercent ?? 0).toStringAsFixed(2).replaceFirst(RegExp(r'\.?0+$'), '');
    return '$text%';
  }

  /// The categories in [all] that are not inside another one, in order. A
  /// sub-category whose parent is not in [all] (switched off) counts as top
  /// level, so it stays reachable.
  static List<CategoryModel> topLevelOf(List<CategoryModel> all) {
    final ids = {for (final c in all) c.id};
    return [
      for (final c in all)
        if (c.isTopLevel || !ids.contains(c.parentId)) c,
    ];
  }

  /// Where a `cover` crop of [imageUrl] anchors.
  Alignment get imageAlignment => focalAlignment(imageFocalX, imageFocalY);

  const CategoryModel({
    required this.id,
    required this.name,
    required this.slug,
    this.description,
    this.imageUrl,
    this.displayOrder = 0,
    this.imageFocalX = kFocalCentrePercent,
    this.imageFocalY = kFocalCentrePercent,
    this.parentId,
    this.offerPercent,
    this.offerEndsAt,
  });

  factory CategoryModel.fromJson(Map<String, dynamic> json) {
    return CategoryModel(
      id: (json['id'] ?? '').toString(),
      name: (json['name'] ?? '').toString(),
      slug: (json['slug'] ?? '').toString(),
      description: json['description']?.toString(),
      imageUrl: (json['image_url'] ?? json['imageUrl'])?.toString(),
      displayOrder:
          int.tryParse((json['display_order'] ?? json['displayOrder'] ?? 0).toString()) ?? 0,
      imageFocalX: parseFocalPercent(json['image_focal_x'] ?? json['imageFocalX']),
      imageFocalY: parseFocalPercent(json['image_focal_y'] ?? json['imageFocalY']),
      parentId: _parentIdFrom(json['parent_id'] ?? json['parentId']),
      offerPercent: _percentFrom(json['offer_percent'] ?? json['offerPercent']),
      offerEndsAt: _dateFrom(json['offer_ends_at'] ?? json['offerEndsAt']),
    );
  }

  static double? _percentFrom(Object? raw) {
    final double? value = switch (raw) {
      num n => n.toDouble(),
      String s => double.tryParse(s.trim()),
      _ => null,
    };
    if (value == null || !value.isFinite || value <= 0 || value >= 100) return null;
    return value;
  }

  static DateTime? _dateFrom(Object? raw) => raw is String ? DateTime.tryParse(raw.trim()) : null;

  static String? _parentIdFrom(Object? raw) {
    final value = raw?.toString() ?? '';
    return value.isEmpty ? null : value;
  }
}
