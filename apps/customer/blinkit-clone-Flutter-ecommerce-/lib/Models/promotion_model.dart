import 'package:flutter/material.dart';

/// A Home carousel promotion, exactly as the backend returns it from
/// GET /api/v1/promotions (active promotions, in display order).
///
/// The app owns none of this content: titles, visuals, button labels and
/// ordering are all set by the Admin app and stored in PostgreSQL.
class PromotionModel {
  final String id;
  final String title;
  final String? subtitle;
  final String? imageUrl;

  /// How the card is filled behind the content: 'SOLID', 'GRADIENT' or
  /// 'IMAGE'. Set in the Blynk Ops app - the customer app renders it and
  /// chooses nothing itself.
  final String backgroundType;
  final String? backgroundColor;
  final String? backgroundColorEnd;
  final String? backgroundImageUrl;

  final String? ctaLabel;

  /// 'CATEGORY', 'PRODUCT', 'CATALOG', or null for an informational
  /// promotion with nothing to open.
  final String? ctaDestinationType;

  /// A category slug or a product id, depending on the type above.
  final String? ctaDestinationValue;

  final int displayOrder;

  const PromotionModel({
    required this.id,
    required this.title,
    this.subtitle,
    this.imageUrl,
    this.backgroundType = 'SOLID',
    this.backgroundColor,
    this.backgroundColorEnd,
    this.backgroundImageUrl,
    this.ctaLabel,
    this.ctaDestinationType,
    this.ctaDestinationValue,
    this.displayOrder = 0,
  });

  factory PromotionModel.fromJson(Map<String, dynamic> json) {
    String? text(Object? value) {
      final result = value?.toString().trim();
      return (result == null || result.isEmpty) ? null : result;
    }

    return PromotionModel(
      id: (json['id'] ?? '').toString(),
      title: (json['title'] ?? '').toString(),
      subtitle: text(json['subtitle']),
      imageUrl: text(json['image_url'] ?? json['imageUrl']),
      backgroundType:
          text(json['background_type'] ?? json['backgroundType'])?.toUpperCase() ??
              'SOLID',
      backgroundColor: text(json['background_color'] ?? json['backgroundColor']),
      backgroundColorEnd:
          text(json['background_color_end'] ?? json['backgroundColorEnd']),
      backgroundImageUrl:
          text(json['background_image_url'] ?? json['backgroundImageUrl']),
      ctaLabel: text(json['cta_label'] ?? json['ctaLabel']),
      ctaDestinationType:
          text(json['cta_destination_type'] ?? json['ctaDestinationType'])
              ?.toUpperCase(),
      ctaDestinationValue:
          text(json['cta_destination_value'] ?? json['ctaDestinationValue']),
      displayOrder: int.tryParse(
            (json['display_order'] ?? json['displayOrder'] ?? 0).toString(),
          ) ??
          0,
    );
  }

  /// Parses a stored hex colour (#RGB, #RRGGBB, #RRGGBBAA) into a Color, or
  /// null when the value is missing or malformed - the carousel then falls
  /// back to its neutral surface rather than rendering something broken.
  static Color? parseHexColor(String? value) {
    if (value == null) return null;
    var hex = value.trim().replaceFirst('#', '');
    if (hex.length == 3) {
      hex = hex.split('').map((c) => '$c$c').join();
    }
    if (hex.length == 6) hex = 'FF$hex';
    if (hex.length != 8) return null;
    final parsed = int.tryParse(hex, radix: 16);
    return parsed == null ? null : Color(parsed);
  }

  Color? get backgroundStart => parseHexColor(backgroundColor);
  Color? get backgroundEnd => parseHexColor(backgroundColorEnd);

  /// True when the stored background is actually renderable.
  bool get hasGradient =>
      backgroundType == 'GRADIENT' &&
      backgroundStart != null &&
      backgroundEnd != null;

  bool get hasBackgroundImage =>
      backgroundType == 'IMAGE' && backgroundImageUrl != null;

  /// A promotion only shows a button when the backend gave it a label and a
  /// destination the app can actually open - nothing is invented here.
  bool get hasAction =>
      ctaLabel != null &&
      (ctaDestinationType == 'CATALOG' ||
          (ctaDestinationType == 'CATEGORY' && ctaDestinationValue != null) ||
          (ctaDestinationType == 'PRODUCT' && ctaDestinationValue != null));
}
