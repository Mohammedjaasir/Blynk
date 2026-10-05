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
      expect(order.deliveryAlternatePhone, isNull);
      expect(
        OrderModel.fromJson({...json, 'delivery_alternate_phone': '+94712345678'}).deliveryAlternatePhone,
        '+94712345678',
      );
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

  group('OrderModel delivery destination coordinate', () {
    test('parses the delivery destination coordinate (already returned by the backend, plan §8)', () {
      final o = OrderModel.fromJson({...orderJson(), 'delivery_latitude': '6.4382', 'delivery_longitude': '80.0274'});
      expect(o.deliveryLatitude, 6.4382);
      expect(o.deliveryLongitude, 80.0274);
    });

    test('a missing destination coordinate parses as null, not zero', () {
      final o = OrderModel.fromJson(orderJson());
      expect(o.deliveryLatitude, isNull);
      expect(o.deliveryLongitude, isNull);
    });

    test('parses numeric (non-string) coordinates', () {
      final o = OrderModel.fromJson({...orderJson(), 'delivery_latitude': 6.4382, 'delivery_longitude': 80});
      expect(o.deliveryLatitude, 6.4382);
      expect(o.deliveryLongitude, 80.0);
    });

    test('an explicit null, empty string or garbage parses as null, never 0', () {
      for (final bad in <Object?>[null, '', '   ', 'abc', '6.4.3', <String>[], <String, dynamic>{}]) {
        final o = OrderModel.fromJson({...orderJson(), 'delivery_latitude': bad, 'delivery_longitude': bad});
        expect(o.deliveryLatitude, isNull, reason: 'lat from $bad');
        expect(o.deliveryLongitude, isNull, reason: 'lng from $bad');
      }
    });

    test('NaN and Infinity are not coordinates', () {
      for (final bad in <Object?>['NaN', 'Infinity', '-Infinity', double.nan, double.infinity]) {
        final o = OrderModel.fromJson({...orderJson(), 'delivery_latitude': bad, 'delivery_longitude': bad});
        expect(o.deliveryLatitude, isNull, reason: 'lat from $bad');
        expect(o.deliveryLongitude, isNull, reason: 'lng from $bad');
      }
    });

    test('a coordinate of exactly 0 parses as 0.0, not null', () {
      for (final zero in <Object>[0, 0.0, '0', '0.0', '0.000000']) {
        final o = OrderModel.fromJson({...orderJson(), 'delivery_latitude': zero, 'delivery_longitude': zero});
        expect(o.deliveryLatitude, 0.0, reason: 'lat from $zero');
        expect(o.deliveryLongitude, 0.0, reason: 'lng from $zero');
      }
    });

    test('negative coordinates parse', () {
      final o = OrderModel.fromJson({...orderJson(), 'delivery_latitude': '-33.8688', 'delivery_longitude': '-151.2093'});
      expect(o.deliveryLatitude, -33.8688);
      expect(o.deliveryLongitude, -151.2093);
    });

    test('camelCase keys are handled', () {
      final o = OrderModel.fromJson({...orderJson(), 'deliveryLatitude': '6.4382', 'deliveryLongitude': 80.0274});
      expect(o.deliveryLatitude, 6.4382);
      expect(o.deliveryLongitude, 80.0274);
    });

    test('snake_case wins over camelCase; an explicit-null snake_case falls back to camelCase', () {
      final both = OrderModel.fromJson({
        ...orderJson(), 'delivery_latitude': '1.5', 'deliveryLatitude': '2.5',
        'delivery_longitude': '3.5', 'deliveryLongitude': '4.5',
      });
      expect(both.deliveryLatitude, 1.5);
      expect(both.deliveryLongitude, 3.5);
      final fallback = OrderModel.fromJson({
        ...orderJson(), 'delivery_latitude': null, 'deliveryLatitude': '2.5',
      });
      expect(fallback.deliveryLatitude, 2.5);
    });

    test('the coordinate is independent per axis', () {
      final o = OrderModel.fromJson({...orderJson(), 'delivery_latitude': '6.4382'});
      expect(o.deliveryLatitude, 6.4382);
      expect(o.deliveryLongitude, isNull);
    });
  });

  group('OrderModel delivery_code (proof of delivery)', () {
    OrderModel parse(Object? code, {bool present = true}) => OrderModel.fromJson({
          ...orderJson(status: 'OUT_FOR_DELIVERY'),
          if (present) 'delivery_code': code,
        });

    test('a 4-digit string is kept verbatim', () {
      expect(parse('4821').deliveryCode, '4821');
      expect(parse('0821').deliveryCode, '0821');
      expect(parse(' 4821 ').deliveryCode, '4821');
    });

    test('a number is accepted and keeps four digits', () {
      expect(parse(4821).deliveryCode, '4821');
      expect(parse(821).deliveryCode, '0821');
    });

    test('null, empty and absent are null', () {
      expect(parse(null).deliveryCode, isNull);
      expect(parse('').deliveryCode, isNull);
      expect(parse('   ').deliveryCode, isNull);
      expect(parse(null, present: false).deliveryCode, isNull);
    });

    test('a list-shaped order without the field parses', () {
      final o = OrderModel.tryParse(orderJson(detail: false));
      expect(o, isNotNull);
      expect(o!.deliveryCode, isNull);
    });
  });
}
