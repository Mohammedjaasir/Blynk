// Mirrors the backend's CustomerProductDto exactly (see
// backend/api/src/modules/catalog/catalog.service.ts). purchase_cost and
// markup are intentionally never present in this response - the backend
// strips them before the customer-facing endpoint returns, and this model
// has no fields for them either, so there is nothing here to accidentally
// expose.
import 'package:flutter/material.dart';

import 'image_focal.dart';

class ProductModel {
  final String id;
  final String categoryId;
  final String categoryName;
  final String name;
  final String slug;
  final String? description;
  final String sku;
  final String? barcode;
  final String unit;
  final String? packSize;
  final String? imageUrl;

  /// Where the crop anchors when [imageUrl] is drawn into a fixed shape, as a
  /// percentage of the image's own width and height (backend migration 009).
  ///
  /// Every tile in the app draws the photo with [BoxFit.cover], which crops
  /// whatever does not fit; this is the point the operator chose to keep.
  /// **50/50 is the centre** - what `cover` already did - and is what the app
  /// uses whenever the API omits these fields, so an older backend changes
  /// nothing. See [imageAlignment].
  final int imageFocalX;
  final int imageFocalY;

  final double sellingPrice;
  final bool isAvailable;

  const ProductModel({
    required this.id,
    required this.categoryId,
    required this.categoryName,
    required this.name,
    required this.slug,
    this.description,
    required this.sku,
    this.barcode,
    required this.unit,
    this.packSize,
    this.imageUrl,
    this.imageFocalX = kFocalCentrePercent,
    this.imageFocalY = kFocalCentrePercent,
    required this.sellingPrice,
    required this.isAvailable,
  });

  factory ProductModel.fromJson(Map<String, dynamic> json) {
    return ProductModel(
      id: (json['id'] ?? '').toString(),
      categoryId: (json['category_id'] ?? json['categoryId'] ?? '').toString(),
      categoryName: (json['category_name'] ?? json['categoryName'] ?? '').toString(),
      name: (json['name'] ?? '').toString(),
      slug: (json['slug'] ?? '').toString(),
      description: json['description']?.toString(),
      sku: (json['sku'] ?? '').toString(),
      barcode: json['barcode']?.toString(),
      unit: (json['unit'] ?? '').toString(),
      packSize: (json['pack_size'] ?? json['packSize'])?.toString(),
      imageUrl: (json['image_url'] ?? json['imageUrl'])?.toString(),
      // Absent, null or unparseable all mean the centre: a response from a
      // backend that predates migration 009 must not break the app, and the
      // centre is exactly the crop that pairing already produced.
      imageFocalX: parseFocalPercent(json['image_focal_x'] ?? json['imageFocalX']),
      imageFocalY: parseFocalPercent(json['image_focal_y'] ?? json['imageFocalY']),
      sellingPrice:
          double.tryParse((json['selling_price'] ?? json['sellingPrice'] ?? 0).toString()) ??
              0.0,
      isAvailable: json['is_available'] == true || json['isAvailable'] == true,
    );
  }

  /// The same snake_case shape [ProductModel.fromJson] reads, so a product
  /// written by [toJson] reads back unchanged (the saved cart relies on it).
  Map<String, dynamic> toJson() => {
        'id': id,
        'category_id': categoryId,
        'category_name': categoryName,
        'name': name,
        'slug': slug,
        'description': description,
        'sku': sku,
        'barcode': barcode,
        'unit': unit,
        'pack_size': packSize,
        'image_url': imageUrl,
        'image_focal_x': imageFocalX,
        'image_focal_y': imageFocalY,
        'selling_price': sellingPrice,
        'is_available': isAvailable,
      };

  /// The stored focal point as a Flutter [Alignment], ready to hand to a
  /// `cover` image. Defaults to [Alignment.center] for every product that has
  /// never had one set.
  Alignment get imageAlignment => focalAlignment(imageFocalX, imageFocalY);
}

class ProductPage {
  final List<ProductModel> products;
  final int page;
  final int limit;
  final int total;
  final int totalPages;

  const ProductPage({
    required this.products,
    required this.page,
    required this.limit,
    required this.total,
    required this.totalPages,
  });

  factory ProductPage.fromJson(Map<String, dynamic> json) {
    final rawProducts = (json['products'] as List?) ?? const [];
    final pagination = (json['pagination'] as Map?) ?? const {};
    return ProductPage(
      products: rawProducts
          .map((p) => ProductModel.fromJson(p as Map<String, dynamic>))
          .toList(),
      page: int.tryParse((pagination['page'] ?? 1).toString()) ?? 1,
      limit: int.tryParse((pagination['limit'] ?? 20).toString()) ?? 20,
      total: int.tryParse((pagination['total'] ?? 0).toString()) ?? 0,
      totalPages: int.tryParse((pagination['total_pages'] ?? 1).toString()) ?? 1,
    );
  }
}
