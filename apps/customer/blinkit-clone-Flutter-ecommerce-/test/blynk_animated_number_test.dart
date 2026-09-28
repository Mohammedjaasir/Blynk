import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:ecom/UI/Widgets/Atoms/blynk_animated_number.dart';
import 'package:ecom/design/motion.dart';

/// Seen on the emulator (2026-09-26): the cart total counting from LKR 258 to
/// LKR 516 flickered through "LKR 300.60", "LKR 431.76" - in-between values
/// are rarely whole and compact money shows cents whenever there are any.
Widget _host(double amount) => MaterialApp(
      home: Scaffold(body: Center(child: BlynkAnimatedNumber(amount))),
    );

Iterable<String> _texts(WidgetTester tester) => tester
    .widgetList<Text>(find.byType(Text))
    .map((t) => t.data ?? t.textSpan?.toPlainText() ?? '');

void main() {
  testWidgets('a whole-rupee count never shows cents on the way', (tester) async {
    await tester.pumpWidget(_host(258));
    await tester.pumpAndSettle();
    await tester.pumpWidget(_host(516));
    for (var i = 0; i < 30; i++) {
      await tester.pump(const Duration(milliseconds: 16));
      for (final t in _texts(tester)) {
        expect(RegExp(r'\d\.\d').hasMatch(t), isFalse, reason: 'mid-count text "$t" shows cents');
      }
    }
    await tester.pump(BlynkMotion.entrance);
    expect(_texts(tester).any((t) => t.contains('516')), isTrue);
  });

  testWidgets('an amount with cents still lands on its cents', (tester) async {
    await tester.pumpWidget(_host(100));
    await tester.pumpAndSettle();
    await tester.pumpWidget(_host(150.5));
    await tester.pumpAndSettle();
    expect(_texts(tester).any((t) => t.contains('150.50')), isTrue);
  });
}
