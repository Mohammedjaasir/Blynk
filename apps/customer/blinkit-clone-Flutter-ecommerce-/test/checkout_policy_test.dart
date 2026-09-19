import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:ecom/UI/Widgets/Atoms/card_cancellation_policy.dart';

/// The Checkout screen tells the customer the cancellation rule *before*
/// they place the order. This card is used by `lib/Screens/checkout_screen.dart`
/// and is deliberately kept: the order-detail screen has its own policy line
/// inside `OrderCancelSection`, which is a different surface for a different
/// moment. This test exists so the card is not mistaken for dead code again.
void main() {
  testWidgets('the checkout cancellation policy card states the rule', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(body: CancellationPolicyCard()),
      ),
    );

    expect(find.text('Cancellation Policy'), findsOneWidget);
    expect(
      find.text('You can cancel your order until it is out for delivery.'),
      findsOneWidget,
    );
  });
}
