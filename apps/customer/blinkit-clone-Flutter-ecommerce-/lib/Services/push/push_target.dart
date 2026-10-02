/// Where tapping a push notification takes the customer. The backend sends
/// `{type: 'order', order_id}` for order updates and
/// `{type: 'product', product_id}` for "back in stock"
/// (backend/api/src/modules/notifications/push/push.events.ts).
class PushTarget {
  const PushTarget._(this.route, this.id);

  /// An app route: '/order' or '/product', both taking a bare id argument.
  final String route;
  final String id;

  /// Null for anything the app does not know how to open.
  static PushTarget? fromData(Map<String, dynamic>? data) {
    if (data == null) return null;
    final type = data['type']?.toString();
    String? id(String key) {
      final value = data[key]?.toString().trim();
      return value == null || value.isEmpty ? null : value;
    }

    switch (type) {
      case 'order':
        final orderId = id('order_id');
        return orderId == null ? null : PushTarget._('/order', orderId);
      case 'product':
        final productId = id('product_id');
        return productId == null ? null : PushTarget._('/product', productId);
      default:
        return null;
    }
  }

  @override
  bool operator ==(Object other) => other is PushTarget && other.route == route && other.id == id;

  @override
  int get hashCode => Object.hash(route, id);

  @override
  String toString() => 'PushTarget($route, $id)';
}
