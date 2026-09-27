import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:ecom/Models/category_model.dart';
import 'package:ecom/Models/image_focal.dart';

/// Migration 010 (2026-09-26): a category image carries the operator's focal
/// point, like a product photo, and the tile anchors its crop there.
void main() {
  test('reads the focal point the API sends', () {
    final c = CategoryModel.fromJson(const {
      'id': 'c1', 'name': 'Dairy & Eggs', 'slug': 'dairy-eggs',
      'image_url': 'http://x/c.webp', 'image_focal_x': 30, 'image_focal_y': 10,
    });
    expect(c.imageFocalX, 30);
    expect(c.imageFocalY, 10);
    expect(c.imageAlignment, focalAlignment(30, 10));
  });

  test('an API from before 010 (no focal fields) crops from the centre', () {
    final c = CategoryModel.fromJson(const {'id': 'c1', 'name': 'Dairy', 'slug': 'dairy'});
    expect(c.imageAlignment, Alignment.center);
  });
}
