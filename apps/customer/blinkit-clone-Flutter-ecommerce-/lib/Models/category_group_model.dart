import 'category_model.dart';

/// One heading on Home's shop front (`GET /catalog/home-groups`): a named
/// group such as "Grocery & Kitchen" and the categories under it, both in the
/// order the backend sends them.
///
/// The backend only returns active groups that hold at least one active
/// category. A final group with a null [id] (named "More") collects the
/// categories that belong to no group; it is present only when there are any.
class CategoryGroupModel {
  final String? id;
  final String name;
  final int sortOrder;
  final List<CategoryModel> categories;

  const CategoryGroupModel({
    required this.id,
    required this.name,
    this.sortOrder = 0,
    this.categories = const [],
  });

  /// True for the backend's catch-all group of ungrouped categories.
  bool get isUngrouped => id == null;

  /// A stable identity for keys, also for the id-less "More" group.
  String get key => id ?? 'ungrouped';

  factory CategoryGroupModel.fromJson(Map<String, dynamic> json) {
    final rawId = json['id'];
    final rawCategories = json['categories'];
    return CategoryGroupModel(
      id: rawId == null || rawId.toString().isEmpty ? null : rawId.toString(),
      name: (json['name'] ?? '').toString(),
      sortOrder:
          int.tryParse((json['sort_order'] ?? json['sortOrder'] ?? 0).toString()) ?? 0,
      categories: [
        if (rawCategories is List)
          for (final c in rawCategories)
            if (c is Map) CategoryModel.fromJson(c.cast<String, dynamic>()),
      ],
    );
  }
}
