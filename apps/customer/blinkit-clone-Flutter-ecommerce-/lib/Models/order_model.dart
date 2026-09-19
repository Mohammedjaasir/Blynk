// Canonical customer-visible lifecycle - do not add PACKING or any other
// intermediate status here; this must match the backend's order_status_enum.
enum OrderStatus {
  placed,
  packed,
  outForDelivery,
  delivered,
  cancelled,
  failed,
  customerUnavailable,
  itemUnavailable,
  unknown,
}

OrderStatus orderStatusFromString(String? raw) {
  switch (raw) {
    case 'PLACED':
      return OrderStatus.placed;
    case 'PACKED':
      return OrderStatus.packed;
    case 'OUT_FOR_DELIVERY':
      return OrderStatus.outForDelivery;
    case 'DELIVERED':
      return OrderStatus.delivered;
    case 'CANCELLED':
      return OrderStatus.cancelled;
    case 'FAILED':
      return OrderStatus.failed;
    case 'CUSTOMER_UNAVAILABLE':
      return OrderStatus.customerUnavailable;
    case 'ITEM_UNAVAILABLE':
      return OrderStatus.itemUnavailable;
    default:
      return OrderStatus.unknown;
  }
}

DateTime? _date(Object? v) => v == null ? null : DateTime.tryParse(v.toString());

/// One row of `history[]`: a status transition as the backend recorded it.
/// Includes re-stage transitions (e.g. FAILED -> PACKED) verbatim - nothing
/// here is inferred or reordered by the client.
class OrderStatusEvent {
  const OrderStatusEvent({required this.oldStatus, required this.newStatus, required this.at});
  final OrderStatus? oldStatus;
  final OrderStatus newStatus;
  final DateTime? at;

  static OrderStatusEvent? tryParse(Object? json) {
    if (json is! Map || json['new_status'] == null) return null;
    return OrderStatusEvent(
      oldStatus: json['old_status'] == null ? null : orderStatusFromString(json['old_status'].toString()),
      newStatus: orderStatusFromString(json['new_status'].toString()),
      at: _date(json['created_at']),
    );
  }
}

/// The customer-safe delivery block (`sanitizeCustomerDelivery`): no rider
/// identity, phone, vehicle, location or cash ledger.
class OrderDeliveryInfo {
  const OrderDeliveryInfo({required this.assignmentStatus, this.assignedAt, this.pickedUpAt, this.deliveredAt});
  final String assignmentStatus;
  final DateTime? assignedAt, pickedUpAt, deliveredAt;

  static OrderDeliveryInfo? tryParse(Object? json) {
    if (json is! Map || json['assignment_status'] == null) return null;
    return OrderDeliveryInfo(
      assignmentStatus: json['assignment_status'].toString(),
      assignedAt: _date(json['assigned_at']),
      pickedUpAt: _date(json['picked_up_at']),
      deliveredAt: _date(json['delivered_at']),
    );
  }
}

class OrderItemModel {
  final String id;
  final String productId;
  final String productNameSnapshot;
  final String unitSnapshot;
  final double unitSellingPrice;
  final int quantity;
  final double subtotal;
  final String itemStatus;

  const OrderItemModel({
    required this.id,
    required this.productId,
    required this.productNameSnapshot,
    required this.unitSnapshot,
    required this.unitSellingPrice,
    required this.quantity,
    required this.subtotal,
    required this.itemStatus,
  });

  static OrderItemModel? tryParse(Object? json) {
    if (json is! Map) return null;
    final id = (json['id'] ?? '').toString();
    if (id.isEmpty) return null;
    return OrderItemModel(
      id: id,
      productId: (json['product_id'] ?? json['productId'] ?? '').toString(),
      productNameSnapshot:
          (json['product_name_snapshot'] ?? json['productNameSnapshot'] ?? '').toString(),
      unitSnapshot: (json['unit_snapshot'] ?? json['unitSnapshot'] ?? '').toString(),
      unitSellingPrice:
          double.tryParse((json['unit_selling_price'] ?? json['unitSellingPrice'] ?? 0).toString()) ??
              0.0,
      quantity: int.tryParse((json['quantity'] ?? 0).toString()) ?? 0,
      subtotal: double.tryParse((json['subtotal'] ?? 0).toString()) ?? 0.0,
      itemStatus: (json['item_status'] ?? json['itemStatus'] ?? '').toString(),
    );
  }
}

class OrderModel {
  final String id;
  final String orderNumber;
  final OrderStatus status;
  final String rawStatus;
  final String paymentMethod;
  final String paymentStatus;
  final double subtotalAmount;
  final double deliveryFee;
  final double totalAmount;
  final String deliveryRecipientName;
  final String deliveryRecipientPhone;
  final String deliveryAddressLine1;
  final String? deliveryAddressLine2;
  final String deliveryCity;
  final String? deliveryInstructions;
  final String? cancellationReason;
  final String? customerNotes;
  final bool canCancel;
  final DateTime? scheduledFor;
  final DateTime? placedAt;
  final DateTime? cancelledAt;
  final List<OrderItemModel> items;
  final List<OrderStatusEvent> history;
  final OrderDeliveryInfo? delivery;

  const OrderModel({
    required this.id,
    required this.orderNumber,
    required this.status,
    required this.rawStatus,
    required this.paymentMethod,
    required this.paymentStatus,
    required this.subtotalAmount,
    required this.deliveryFee,
    required this.totalAmount,
    required this.deliveryRecipientName,
    required this.deliveryRecipientPhone,
    required this.deliveryAddressLine1,
    this.deliveryAddressLine2,
    required this.deliveryCity,
    this.deliveryInstructions,
    this.cancellationReason,
    this.customerNotes,
    this.canCancel = false,
    this.scheduledFor,
    this.placedAt,
    this.cancelledAt,
    this.items = const [],
    this.history = const [],
    this.delivery,
  });

  // Pre-dispatch: the states an order sits in before a rider is on the way.
  static const _preDispatch = {OrderStatus.placed, OrderStatus.itemUnavailable, OrderStatus.packed};
  // States where a (possibly re-staged) delivery block is meaningful to show.
  static const _withDelivery = {OrderStatus.packed, OrderStatus.outForDelivery, OrderStatus.delivered};

  bool get isScheduled => scheduledFor != null;
  bool get showsScheduleNotice => isScheduled && _preDispatch.contains(status);
  bool get showsDelivery => delivery != null && _withDelivery.contains(status);

  factory OrderModel.fromJson(Map<String, dynamic> json) {
    final rawItems = (json['items'] as List?) ?? const [];
    final rawHistory = (json['history'] as List?) ?? const [];
    return OrderModel(
      id: (json['id'] ?? '').toString(),
      orderNumber: (json['order_number'] ?? json['orderNumber'] ?? '').toString(),
      status: orderStatusFromString((json['order_status'] ?? json['orderStatus'])?.toString()),
      rawStatus: (json['order_status'] ?? json['orderStatus'] ?? '').toString(),
      paymentMethod: (json['payment_method'] ?? json['paymentMethod'] ?? 'COD').toString(),
      paymentStatus: (json['payment_status'] ?? json['paymentStatus'] ?? '').toString(),
      subtotalAmount:
          double.tryParse((json['subtotal_amount'] ?? json['subtotalAmount'] ?? 0).toString()) ??
              0.0,
      deliveryFee:
          double.tryParse((json['delivery_fee'] ?? json['deliveryFee'] ?? 0).toString()) ?? 0.0,
      totalAmount:
          double.tryParse((json['total_amount'] ?? json['totalAmount'] ?? 0).toString()) ?? 0.0,
      deliveryRecipientName:
          (json['delivery_recipient_name'] ?? json['deliveryRecipientName'] ?? '').toString(),
      deliveryRecipientPhone:
          (json['delivery_recipient_phone'] ?? json['deliveryRecipientPhone'] ?? '').toString(),
      deliveryAddressLine1:
          (json['delivery_address_line1'] ?? json['deliveryAddressLine1'] ?? '').toString(),
      deliveryAddressLine2:
          (json['delivery_address_line2'] ?? json['deliveryAddressLine2'])?.toString(),
      deliveryCity: (json['delivery_city'] ?? json['deliveryCity'] ?? '').toString(),
      deliveryInstructions:
          (json['delivery_instructions'] ?? json['deliveryInstructions'])?.toString(),
      cancellationReason:
          (json['cancellation_reason'] ?? json['cancellationReason'])?.toString(),
      customerNotes: (json['customer_notes'] ?? json['customerNotes'])?.toString(),
      canCancel: json['can_cancel'] == true,
      scheduledFor: _date(json['scheduled_for'] ?? json['scheduledFor']),
      placedAt: _date(json['placed_at'] ?? json['placedAt'] ?? json['created_at'] ?? json['createdAt']),
      cancelledAt: _date(json['cancelled_at'] ?? json['cancelledAt']),
      items: rawItems.map(OrderItemModel.tryParse).whereType<OrderItemModel>().toList(),
      history: rawHistory.map(OrderStatusEvent.tryParse).whereType<OrderStatusEvent>().toList(),
      delivery: OrderDeliveryInfo.tryParse(json['delivery']),
    );
  }

  static OrderModel? tryParse(Object? json) {
    if (json is! Map) return null;
    final map = json.cast<String, dynamic>();
    if ((map['id'] ?? '').toString().isEmpty) return null;
    return OrderModel.fromJson(map);
  }
}
