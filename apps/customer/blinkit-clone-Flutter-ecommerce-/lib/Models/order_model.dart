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

/// Null, empty or unparseable (or non-finite) input is null - never 0, so a
/// missing coordinate can't be mistaken for the point (0, 0).
double? _optionalDouble(Object? v) {
  if (v == null) return null;
  final d = double.tryParse(v.toString().trim());
  return d != null && d.isFinite ? d : null;
}

/// The proof-of-delivery code as text. The backend sends a string ("4821"),
/// but a number is accepted too (left-padded to four digits, since 0821 as
/// a JSON number arrives as 821); null, empty or whitespace-only is null.
String? _optionalCode(Object? v) {
  if (v == null) return null;
  if (v is num) {
    if (!v.isFinite || v < 0 || v != v.truncate()) return null;
    return v.toInt().toString().padLeft(4, '0');
  }
  final s = v.toString().trim();
  return s.isEmpty ? null : s;
}

String? _optionalText(Object? v) {
  final s = v?.toString().trim();
  return s == null || s.isEmpty ? null : s;
}

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

/// The rider's first name and phone, for "Call rider" (owner, 2026-10-10).
/// The backend sends `rider_contact` on the customer's OWN order detail only
/// while it is out for delivery (on the road or at the door); null before
/// pickup, after delivery, and in the order list.
class RiderContact {
  const RiderContact({required this.firstName, required this.phone});

  /// Null when the rider has no name on file; the UI says "Your rider".
  final String? firstName;
  final String phone;

  static RiderContact? tryParse(Object? json) {
    if (json is! Map) return null;
    final phone = _optionalText(json['phone']);
    if (phone == null) return null;
    return RiderContact(firstName: _optionalText(json['first_name']), phone: phone);
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

  /// The combo pack line this item belongs to (owner, 2026-10-09), or null
  /// for a loose item. A combo's items are ordinary items - quantity is per
  /// pack x packs, the price its share of the combo price.
  final String? orderComboId;

  const OrderItemModel({
    required this.id,
    required this.productId,
    required this.productNameSnapshot,
    required this.unitSnapshot,
    required this.unitSellingPrice,
    required this.quantity,
    required this.subtotal,
    required this.itemStatus,
    this.orderComboId,
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
      orderComboId: _optionalText(json['order_combo_id'] ?? json['orderComboId']),
    );
  }
}

/// One combo pack line of an order (owner, 2026-10-09), as the backend
/// snapshotted it: `combos[]` on every order response. Its products are the
/// order's items whose [OrderItemModel.orderComboId] is this [id].
class OrderComboModel {
  final String id;
  final String? comboId;
  final String name;
  final double unitPrice;
  final int quantity;
  final double subtotal;

  /// One pack's products at their own prices when it was ordered.
  final double itemsRegularTotal;

  const OrderComboModel({
    required this.id,
    this.comboId,
    required this.name,
    required this.unitPrice,
    required this.quantity,
    required this.subtotal,
    this.itemsRegularTotal = 0,
  });

  static OrderComboModel? tryParse(Object? json) {
    if (json is! Map) return null;
    final id = (json['id'] ?? '').toString();
    if (id.isEmpty) return null;
    double money(Object? v) => double.tryParse((v ?? 0).toString()) ?? 0.0;
    return OrderComboModel(
      id: id,
      comboId: _optionalText(json['combo_id'] ?? json['comboId']),
      name: (json['name'] ?? '').toString(),
      unitPrice: money(json['unit_price'] ?? json['unitPrice']),
      quantity: int.tryParse((json['quantity'] ?? 0).toString()) ?? 0,
      subtotal: money(json['subtotal']),
      itemsRegularTotal: money(json['items_regular_total'] ?? json['itemsRegularTotal']),
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

  /// Coupon discount (backend migration 018), 0 when none:
  /// totalAmount = subtotalAmount + deliveryFee - discountAmount.
  final double discountAmount;

  /// The coupon code the order used, as the backend snapshotted it.
  final String? couponCode;

  /// The birthday gift this order got (owner, 2026-10-09), 0 when none. When
  /// it is above 0 it IS the [discountAmount] and there is no [couponCode]:
  /// the gift and a coupon never stack.
  final double birthdayDiscountAmount;

  /// The discount was the birthday gift, not a coupon.
  bool get hasBirthdayGift => birthdayDiscountAmount > 0;
  final double totalAmount;
  final String deliveryRecipientName;
  final String deliveryRecipientPhone;

  /// The address's additional phone, snapshotted at order time (migration 024).
  final String? deliveryAlternatePhone;
  final String deliveryAddressLine1;
  final String? deliveryAddressLine2;
  final String deliveryCity;
  final double? deliveryLatitude;
  final double? deliveryLongitude;
  final String? deliveryInstructions;
  final String? cancellationReason;
  final String? customerNotes;
  final bool canCancel;
  final DateTime? scheduledFor;
  final DateTime? placedAt;
  final DateTime? cancelledAt;
  final List<OrderItemModel> items;

  /// Combo pack lines (owner, 2026-10-09); empty for an order without any
  /// and on a backend that predates combos.
  final List<OrderComboModel> combos;
  final List<OrderStatusEvent> history;
  final OrderDeliveryInfo? delivery;

  /// `delivery_code`: the code the customer reads to the rider at the door.
  /// The backend sends it only while OUT_FOR_DELIVERY; null otherwise
  /// (including in the order list, where it is absent).
  final String? deliveryCode;

  /// `rider_contact` (owner, 2026-10-10): see [RiderContact].
  final RiderContact? riderContact;

  const OrderModel({
    required this.id,
    required this.orderNumber,
    required this.status,
    required this.rawStatus,
    required this.paymentMethod,
    required this.paymentStatus,
    required this.subtotalAmount,
    required this.deliveryFee,
    this.discountAmount = 0,
    this.couponCode,
    this.birthdayDiscountAmount = 0,
    required this.totalAmount,
    required this.deliveryRecipientName,
    required this.deliveryRecipientPhone,
    this.deliveryAlternatePhone,
    required this.deliveryAddressLine1,
    this.deliveryAddressLine2,
    required this.deliveryCity,
    this.deliveryLatitude,
    this.deliveryLongitude,
    this.deliveryInstructions,
    this.cancellationReason,
    this.customerNotes,
    this.canCancel = false,
    this.scheduledFor,
    this.placedAt,
    this.cancelledAt,
    this.items = const [],
    this.combos = const [],
    this.history = const [],
    this.delivery,
    this.deliveryCode,
    this.riderContact,
  });

  // Pre-dispatch: the states an order sits in before a rider is on the way.
  static const _preDispatch = {OrderStatus.placed, OrderStatus.itemUnavailable, OrderStatus.packed};
  // States where a (possibly re-staged) delivery block is meaningful to show.
  static const _withDelivery = {OrderStatus.packed, OrderStatus.outForDelivery, OrderStatus.delivered};

  bool get isScheduled => scheduledFor != null;
  bool get showsScheduleNotice => isScheduled && _preDispatch.contains(status);
  bool get showsDelivery => delivery != null && _withDelivery.contains(status);

  /// Items that are not part of a combo pack (all of them when there are no
  /// combos, or when an item points at a combo line the order did not send).
  List<OrderItemModel> get looseItems {
    final ids = {for (final c in combos) c.id};
    return items.where((i) => i.orderComboId == null || !ids.contains(i.orderComboId)).toList();
  }

  /// The items of combo line [comboLineId].
  List<OrderItemModel> itemsOfCombo(String comboLineId) =>
      items.where((i) => i.orderComboId == comboLineId).toList();

  /// What the order list names: each combo pack by its name, then each loose
  /// item - a pack's products are not listed one by one.
  List<String> get lineNames => [
        for (final c in combos) c.name,
        for (final i in looseItems) i.productNameSnapshot,
      ];

  factory OrderModel.fromJson(Map<String, dynamic> json) {
    final rawItems = (json['items'] as List?) ?? const [];
    final rawCombos = json['combos'] is List ? json['combos'] as List : const [];
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
      discountAmount:
          double.tryParse((json['discount_amount'] ?? json['discountAmount'] ?? 0).toString()) ?? 0.0,
      couponCode: _optionalText(json['coupon_code'] ?? json['couponCode']),
      birthdayDiscountAmount: double.tryParse(
              (json['birthday_discount_amount'] ?? json['birthdayDiscountAmount'] ?? 0).toString()) ??
          0.0,
      totalAmount:
          double.tryParse((json['total_amount'] ?? json['totalAmount'] ?? 0).toString()) ?? 0.0,
      deliveryRecipientName:
          (json['delivery_recipient_name'] ?? json['deliveryRecipientName'] ?? '').toString(),
      deliveryRecipientPhone:
          (json['delivery_recipient_phone'] ?? json['deliveryRecipientPhone'] ?? '').toString(),
      deliveryAlternatePhone:
          _optionalText(json['delivery_alternate_phone'] ?? json['deliveryAlternatePhone']),
      deliveryAddressLine1:
          (json['delivery_address_line1'] ?? json['deliveryAddressLine1'] ?? '').toString(),
      deliveryAddressLine2:
          (json['delivery_address_line2'] ?? json['deliveryAddressLine2'])?.toString(),
      deliveryCity: (json['delivery_city'] ?? json['deliveryCity'] ?? '').toString(),
      deliveryLatitude: _optionalDouble(json['delivery_latitude'] ?? json['deliveryLatitude']),
      deliveryLongitude: _optionalDouble(json['delivery_longitude'] ?? json['deliveryLongitude']),
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
      combos: rawCombos.map(OrderComboModel.tryParse).whereType<OrderComboModel>().toList(),
      history: rawHistory.map(OrderStatusEvent.tryParse).whereType<OrderStatusEvent>().toList(),
      delivery: OrderDeliveryInfo.tryParse(json['delivery']),
      deliveryCode: _optionalCode(json['delivery_code'] ?? json['deliveryCode']),
      riderContact: RiderContact.tryParse(json['rider_contact']),
    );
  }

  static OrderModel? tryParse(Object? json) {
    if (json is! Map) return null;
    final map = json.cast<String, dynamic>();
    if ((map['id'] ?? '').toString().isEmpty) return null;
    return OrderModel.fromJson(map);
  }
}
