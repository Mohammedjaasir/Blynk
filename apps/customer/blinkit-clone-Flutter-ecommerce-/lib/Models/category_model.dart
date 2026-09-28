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
    );
  }
}
