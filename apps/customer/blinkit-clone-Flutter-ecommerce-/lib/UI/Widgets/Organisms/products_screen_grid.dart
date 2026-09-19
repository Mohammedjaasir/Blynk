import 'package:flutter/material.dart';

import '../Atoms/card_product.dart';
import '../../../Models/product_model.dart';
import '../../../app_responsive.dart';

Widget buildProductsGrid(BuildContext context, List<ProductModel> products) {
  // Fixed at 2 columns regardless of viewport made this grid look identical
  // (and increasingly sparse/oversized) from a 375px phone up to a 1920px
  // desktop monitor - scale with the shared breakpoints instead.
  final crossAxisCount = Responsive.of(context).gridColumns;

  if (products.isEmpty) {
    return const Center(
      child: Padding(
        padding: EdgeInsets.all(24.0),
        child: Text('No products in this category yet.'),
      ),
    );
  }

  return GridView.builder(
    padding: const EdgeInsets.all(4.0),
    physics: const BouncingScrollPhysics(),
    gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
      crossAxisCount: crossAxisCount,
      mainAxisSpacing: 8.0,
      crossAxisSpacing: 8.0,
      childAspectRatio: 0.62,
    ),
    itemCount: products.length,
    itemBuilder: (BuildContext context, int index) {
      return ProductCard(product: products[index]);
    },
  );
}
