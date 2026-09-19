/// Payloads shaped exactly like the real backend responses (GET /orders/:id
/// detail shape). Used by order_model_test.dart and later tasks' tests.
Map<String, dynamic> orderJson({
  String id = 'c0000001-0000-0000-0000-000000000001',
  String number = 'BL-20260919-4821',
  String status = 'PLACED',
  bool? canCancel,
  String paymentStatus = 'PENDING',
  String? scheduledFor,
  String? cancellationReason,
  List<Map<String, dynamic>>? items,
  List<List<String?>>? history, // [old, new, iso]
  Map<String, dynamic>? delivery,
  bool detail = true,
  num subtotal = 1885.0, num fee = 70.0, num total = 1955.0,
}) => {
      'id': id, 'order_number': number, 'order_status': status,
      if (canCancel != null) 'can_cancel': canCancel,
      'payment_method': 'COD', 'payment_status': paymentStatus,
      'subtotal_amount': subtotal, 'delivery_fee': fee, 'total_amount': total,
      'scheduled_for': scheduledFor,
      'delivery_recipient_name': 'Jane Silva', 'delivery_recipient_phone': '+94771234567',
      'delivery_address_line1': '12 Galle Road', 'delivery_address_line2': null,
      'delivery_city': 'Dharga Town', 'delivery_instructions': 'Blue gate',
      'cancellation_reason': cancellationReason,
      'cancelled_at': status == 'CANCELLED' ? '2026-09-19T10:20:00.000Z' : null,
      'customer_notes': null,
      'placed_at': '2026-09-19T10:00:00.000Z', 'created_at': '2026-09-19T10:00:00.000Z',
      'items': items ?? [itemJson('i1', 'Kotmale Fresh Milk 1L', 2, 540), itemJson('i2', 'Butter 200g', 1, 805)],
      if (detail) 'payment': {'amount': total, 'payment_status': paymentStatus, 'paid_at': null},
      if (detail) 'history': [
        for (final h in history ?? [[null, 'PLACED', '2026-09-19T10:00:00.000Z']])
          {'id': 'h${h[2]}', 'order_id': id, 'old_status': h[0], 'new_status': h[1], 'created_at': h[2]},
      ],
      if (detail) 'delivery': delivery,
    };

Map<String, dynamic> itemJson(String id, String name, int qty, num price, {String status = 'PENDING'}) => {
      'id': id, 'order_id': 'o', 'product_id': 'p-$id', 'product_name_snapshot': name,
      'sku_snapshot': 'SKU-$id', 'unit_snapshot': '1 pc', 'unit_selling_price': price,
      'quantity': qty, 'subtotal': price * qty, 'item_status': status, 'created_at': '2026-09-19T10:00:00.000Z',
    };

/// FAILED -> PACKED -> OUT_FOR_DELIVERY -> DELIVERED, as the backend records it.
Map<String, dynamic> restagedDeliveredJson() => orderJson(
      status: 'DELIVERED', canCancel: false, paymentStatus: 'PAID',
      history: [
        [null, 'PLACED', '2026-09-19T10:00:00.000Z'],
        ['PLACED', 'PACKED', '2026-09-19T10:10:00.000Z'],
        ['PACKED', 'OUT_FOR_DELIVERY', '2026-09-19T10:20:00.000Z'],
        ['OUT_FOR_DELIVERY', 'FAILED', '2026-09-19T10:40:00.000Z'],
        ['FAILED', 'PACKED', '2026-09-19T11:00:00.000Z'],
        ['PACKED', 'OUT_FOR_DELIVERY', '2026-09-19T11:10:00.000Z'],
        ['OUT_FOR_DELIVERY', 'DELIVERED', '2026-09-19T11:30:00.000Z'],
      ],
      delivery: {'assignment_status': 'DELIVERED', 'assigned_at': '2026-09-19T11:05:00.000Z',
        'picked_up_at': '2026-09-19T11:10:00.000Z', 'delivered_at': '2026-09-19T11:30:00.000Z'},
    );
