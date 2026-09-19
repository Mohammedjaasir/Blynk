import 'package:flutter_test/flutter_test.dart';
import 'package:ecom/Models/order_model.dart';

import 'fixtures/order_fixtures.dart';

void main() {
  group('Order status', () {
    test('Maps every canonical backend status string - no PACKING introduced', () {
      expect(orderStatusFromString('PLACED'), equals(OrderStatus.placed));
      expect(orderStatusFromString('PACKED'), equals(OrderStatus.packed));
      expect(orderStatusFromString('OUT_FOR_DELIVERY'), equals(OrderStatus.outForDelivery));
      expect(orderStatusFromString('DELIVERED'), equals(OrderStatus.delivered));
      expect(orderStatusFromString('CANCELLED'), equals(OrderStatus.cancelled));
      expect(orderStatusFromString('FAILED'), equals(OrderStatus.failed));
      expect(orderStatusFromString('CUSTOMER_UNAVAILABLE'), equals(OrderStatus.customerUnavailable));
      expect(orderStatusFromString('ITEM_UNAVAILABLE'), equals(OrderStatus.itemUnavailable));
    });
  });

  group('OrderModel', () {
    test('Parses an order response shaped like the orders table + sanitized items', () {
      final json = {
        "id": "o0000001-0000-0000-0000-000000000001",
        "order_number": "BLK-00001",
        "order_status": "PLACED",
        "payment_method": "COD",
        "payment_status": "PENDING",
        "subtotal_amount": "1145.00",
        "delivery_fee": "70.00",
        "total_amount": "1215.00",
        "delivery_recipient_name": "Jane Silva",
        "delivery_recipient_phone": "+94771234567",
        "delivery_address_line1": "12 Galle Road",
        "delivery_city": "Dharga Town",
        "created_at": "2026-09-17T10:00:00.000Z",
        "can_cancel": true,
        "items": [
          {
            "id": "i1",
            "product_id": "b0000001-0000-0000-0000-000000000001",
            "product_name_snapshot": "Kotmale Fresh Milk 1L",
            "unit_snapshot": "1 L",
            "unit_selling_price": "540.00",
            "quantity": 1,
            "subtotal": "540.00",
            "item_status": "PENDING",
            // sanitizeCustomerOrderItem strips these before the customer
            // response is sent - asserting they are absent, not just unused.
          },
        ],
      };

      final order = OrderModel.fromJson(json);

      expect(order.orderNumber, equals("BLK-00001"));
      expect(order.status, equals(OrderStatus.placed));
      expect(order.canCancel, isTrue);
      expect(order.totalAmount, equals(1215.0));
      expect(order.items, hasLength(1));
      expect(order.items.first.productNameSnapshot, equals("Kotmale Fresh Milk 1L"));

      final itemJson = (json['items'] as List).first as Map;
      expect(itemJson.containsKey('estimated_unit_cost'), isFalse);
      expect(itemJson.containsKey('actual_unit_cost'), isFalse);
      expect(itemJson.containsKey('markup_percentage_applied'), isFalse);
    });

    test('canCancel is the backend flag, never derived from status', () {
      expect(OrderModel.fromJson(orderJson(status: 'PLACED', canCancel: true)).canCancel, isTrue);
      expect(OrderModel.fromJson(orderJson(status: 'PACKED', canCancel: false)).canCancel, isFalse);
      expect(OrderModel.fromJson(orderJson(status: 'PLACED')).canCancel, isFalse, reason: 'absent = fail closed');
    });

    test('parses schedule, history and delivery', () {
      final o = OrderModel.fromJson(restagedDeliveredJson());
      expect(o.history.map((h) => h.newStatus), [OrderStatus.placed, OrderStatus.packed, OrderStatus.outForDelivery,
        OrderStatus.failed, OrderStatus.packed, OrderStatus.outForDelivery, OrderStatus.delivered]);
      expect(o.history[4].oldStatus, OrderStatus.failed);
      expect(o.history.first.at, DateTime.utc(2026, 9, 19, 10));
      expect(o.delivery!.assignmentStatus, 'DELIVERED');
      expect(o.showsDelivery, isTrue);
      final s = OrderModel.fromJson(orderJson(scheduledFor: '2026-09-20T02:30:00.000Z'));
      expect(s.isScheduled, isTrue); expect(s.showsScheduleNotice, isTrue);
      expect(OrderModel.fromJson(orderJson(status: 'DELIVERED', scheduledFor: '2026-09-20T02:30:00.000Z')).showsScheduleNotice, isFalse);
    });

    test('a cancelled order never shows its leftover ASSIGNED delivery', () {
      final o = OrderModel.fromJson(orderJson(status: 'CANCELLED', delivery: {'assignment_status': 'ASSIGNED', 'assigned_at': '2026-09-19T10:15:00.000Z', 'picked_up_at': null, 'delivered_at': null}));
      expect(o.showsDelivery, isFalse);
    });

    test('malformed payloads', () {
      expect(OrderModel.tryParse(null), isNull);
      expect(OrderModel.tryParse('x'), isNull);
      expect(OrderModel.tryParse({'order_number': 'N'}), isNull, reason: 'no id');
      final o = OrderModel.tryParse({...orderJson(), 'items': [itemJson('i1', 'Milk', 1, 540), 'junk', null], 'history': ['junk', {'new_status': 'PACKED', 'created_at': 'not-a-date'}]})!;
      expect(o.items, hasLength(1));
      expect(o.history, hasLength(1)); expect(o.history.single.at, isNull);
      expect(OrderModel.tryParse({...orderJson(), 'order_status': 'TELEPORTED'})!.status, OrderStatus.unknown);
    });
  });
}
