import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:ecom/Models/order_format.dart';
import 'package:ecom/UI/Widgets/Atoms/money_text.dart';
import 'package:ecom/design/tokens.dart';

import 'fixtures/component_host.dart';

void main() {
  group('MoneyText', () {
    const amounts = <double>[0, 50, 605.50, 1250.00, 1250.5];

    for (final amount in amounts) {
      testWidgets('shows exactly formatLkr($amount)', (tester) async {
        await tester.pumpWidget(componentHost(tester, MoneyText(amount)));
        expect(find.text(formatLkr(amount)), findsOneWidget);
      });
    }

    testWidgets('known outputs: whole amounts hide .00, paise are never rounded away', (tester) async {
      Future<void> expectShows(double amount, String text) async {
        await tester.pumpWidget(componentHost(tester, MoneyText(amount)));
        expect(find.text(text), findsOneWidget);
      }

      await expectShows(0, 'LKR 0');
      await expectShows(50, 'LKR 50');
      await expectShows(605.50, 'LKR 605.50');
      await expectShows(1250.00, 'LKR 1,250');
      await expectShows(1250.5, 'LKR 1,250.50');
      await expectShows(1250.05, 'LKR 1,250.05');
    });

    testWidgets('compact: false keeps .00 on whole amounts and changes nothing else', (tester) async {
      await tester.pumpWidget(componentHost(tester, const MoneyText(1250, compact: false)));
      expect(find.text('LKR 1,250.00'), findsOneWidget);
      await tester.pumpWidget(componentHost(tester, const MoneyText(605.5, compact: false)));
      expect(find.text('LKR 605.50'), findsOneWidget);
    });

    testWidgets('uses the price style by default and lets the caller override', (tester) async {
      await tester.pumpWidget(componentHost(tester, const MoneyText(50)));
      var style = tester.widget<Text>(find.text('LKR 50')).style!;
      expect(style.fontWeight, BlynkText.price.fontWeight);
      expect(style.fontSize, BlynkText.price.fontSize);
      expect(style.color, BlynkColors.ink);

      await tester.pumpWidget(componentHost(tester, const MoneyText(50, style: TextStyle(color: BlynkColors.positiveInk))));
      style = tester.widget<Text>(find.text('LKR 50')).style!;
      expect(style.color, BlynkColors.positiveInk);
      expect(style.fontWeight, BlynkText.price.fontWeight);
    });

    testWidgets('semantics: one spoken label, the visual text is excluded', (tester) async {
      final handle = tester.ensureSemantics();
      await tester.pumpWidget(componentHost(tester, const MoneyText(1250.5)));
      final data = tester.getSemantics(find.byType(MoneyText)).getSemanticsData();
      expect(data.label, 'LKR 1,250.50');
      handle.dispose();
    });

    testWidgets('semanticsLabel overrides the spoken text', (tester) async {
      final handle = tester.ensureSemantics();
      await tester.pumpWidget(componentHost(tester, const MoneyText(1250, semanticsLabel: 'Total 1,250 rupees')));
      expect(tester.getSemantics(find.byType(MoneyText)).getSemanticsData().label, 'Total 1,250 rupees');
      handle.dispose();
    });

    testWidgets('grows with the text scale and is never truncated or wrapped (1.0x, 1.3x, 2.0x)', (tester) async {
      final widths = <double>[];
      final heights = <double>[];
      for (final scale in kTextScales) {
        await tester.pumpWidget(componentHost(tester, const MoneyText(1250.5), textScale: scale));
        final paragraph = tester.renderObject<RenderParagraph>(find.text('LKR 1,250.50'));
        expect(paragraph.didExceedMaxLines, isFalse);
        expect(tester.takeException(), isNull);
        final size = tester.getSize(find.text('LKR 1,250.50'));
        widths.add(size.width);
        heights.add(size.height);
      }
      expect(widths[1], greaterThan(widths[0]));
      expect(widths[2], greaterThan(widths[1]));
      expect(widths[2] / widths[0], closeTo(2.0, 0.05), reason: 'the amount must scale with the system font');
      expect(heights[2], greaterThan(heights[0]));
    });

    testWidgets('text contrast guideline', (tester) async {
      final handle = tester.ensureSemantics();
      await tester.pumpWidget(componentHost(tester, const MoneyText(1250.5)));
      await expectLater(tester, meetsGuideline(textContrastGuideline));
      handle.dispose();
    });
  });

  group('formatLkr(alwaysShowCents)', () {
    test('default output is unchanged', () {
      expect(formatLkr(0), 'LKR 0');
      expect(formatLkr(1955), 'LKR 1,955');
      expect(formatLkr(1214.5), 'LKR 1,214.50');
      expect(formatLkr(999.999), 'LKR 1,000');
    });

    test('alwaysShowCents keeps the same digits and adds .00 only to whole amounts', () {
      expect(formatLkr(0, alwaysShowCents: true), 'LKR 0.00');
      expect(formatLkr(1955, alwaysShowCents: true), 'LKR 1,955.00');
      expect(formatLkr(1214.5, alwaysShowCents: true), 'LKR 1,214.50');
      expect(formatLkr(999.999, alwaysShowCents: true), 'LKR 1,000.00');
    });
  });
}
