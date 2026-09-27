import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:ecom/UI/Widgets/Atoms/blynk_animated_number.dart';
import 'package:ecom/UI/Widgets/Atoms/blynk_crossfade.dart';
import 'package:ecom/UI/Widgets/Atoms/blynk_page_transition.dart';
import 'package:ecom/UI/Widgets/Atoms/blynk_press.dart';
import 'package:ecom/design/motion.dart';

Widget _host(Widget child, {bool reduceMotion = false}) => MediaQuery(
      data: MediaQueryData(disableAnimations: reduceMotion),
      child: Directionality(textDirection: TextDirection.ltr, child: Center(child: child)),
    );

double _scaleOf(WidgetTester tester, Finder inner) =>
    tester.widget<AnimatedScale>(find.ancestor(of: inner, matching: find.byType(AnimatedScale))).scale;

void main() {
  group('BlynkPress', () {
    testWidgets('scales down while pressed and back up when released', (tester) async {
      await tester.pumpWidget(_host(const BlynkPress(child: ColoredBox(color: Color(0xFF000000), child: SizedBox(width: 80, height: 80)))));
      final box = find.byType(SizedBox);
      expect(_scaleOf(tester, box), 1.0);

      final gesture = await tester.startGesture(tester.getCenter(box));
      await tester.pump();
      expect(_scaleOf(tester, box), BlynkMotion.pressScale);

      await gesture.up();
      await tester.pump();
      expect(_scaleOf(tester, box), 1.0);
    });

    testWidgets('does not take the tap from the child', (tester) async {
      var taps = 0;
      await tester.pumpWidget(_host(BlynkPress(
        child: GestureDetector(onTap: () => taps++, child: const ColoredBox(color: Color(0xFF000000), child: SizedBox(width: 80, height: 80))),
      )));
      await tester.tap(find.byType(SizedBox));
      expect(taps, 1, reason: 'the wrapper only adds scale; the child still gets its tap');
    });

    testWidgets('disabled: a press it ignores does not look like a press it took', (tester) async {
      await tester.pumpWidget(_host(const BlynkPress(enabled: false, child: ColoredBox(color: Color(0xFF000000), child: SizedBox(width: 80, height: 80)))));
      final gesture = await tester.startGesture(tester.getCenter(find.byType(SizedBox)));
      await tester.pump();
      expect(_scaleOf(tester, find.byType(SizedBox)), 1.0);
      await gesture.up();
    });

    testWidgets('reduced motion: the scale is skipped, the control does not move', (tester) async {
      await tester.pumpWidget(_host(const BlynkPress(child: ColoredBox(color: Color(0xFF000000), child: SizedBox(width: 80, height: 80))), reduceMotion: true));
      final scale = tester.widget<AnimatedScale>(find.byType(AnimatedScale));
      expect(scale.duration, Duration.zero);
    });
  });

  group('BlynkAnimatedNumber', () {
    testWidgets('counts to the new amount rather than jumping', (tester) async {
      await tester.pumpWidget(_host(const BlynkAnimatedNumber(100, compact: true)));
      await tester.pumpAndSettle();
      expect(find.textContaining('100'), findsOneWidget);

      await tester.pumpWidget(_host(const BlynkAnimatedNumber(1000, compact: true)));
      await tester.pump(BlynkMotion.base ~/ 2);
      // Mid-way it is neither the old nor the new number.
      expect(find.textContaining('100'), findsNothing);
      expect(find.textContaining('1,000'), findsNothing);

      await tester.pumpAndSettle();
      expect(find.textContaining('1,000'), findsOneWidget);
    });

    testWidgets('a screen reader hears the final amount, never an in-between one', (tester) async {
      final handle = tester.ensureSemantics();
      await tester.pumpWidget(_host(const BlynkAnimatedNumber(100, compact: true)));
      await tester.pumpAndSettle();
      await tester.pumpWidget(_host(const BlynkAnimatedNumber(1000, compact: true)));
      await tester.pump(BlynkMotion.base ~/ 2);
      expect(find.bySemanticsLabel(RegExp(r'1,000')), findsOneWidget);
      handle.dispose();
    });

    testWidgets('reduced motion: snaps', (tester) async {
      await tester.pumpWidget(_host(const BlynkAnimatedNumber(100, compact: true), reduceMotion: true));
      await tester.pump();
      await tester.pumpWidget(_host(const BlynkAnimatedNumber(1000, compact: true), reduceMotion: true));
      await tester.pump();
      expect(find.textContaining('1,000'), findsOneWidget);
    });
  });

  group('BlynkCrossfade', () {
    testWidgets('the first child appears at once, with no fade', (tester) async {
      await tester.pumpWidget(_host(const BlynkCrossfade(child: Text('a', key: ValueKey('a')))));
      await tester.pump(); // frame 0
      final faded = tester
          .widgetList<FadeTransition>(find.byType(FadeTransition))
          .where((f) => f.opacity.value < 1)
          .toList();
      expect(faded, isEmpty, reason: 'a crossfade only ever animates a change');
      expect(find.text('a'), findsOneWidget);
    });

    testWidgets('a change of key crossfades, and both are present mid-way', (tester) async {
      await tester.pumpWidget(_host(const BlynkCrossfade(child: Text('a', key: ValueKey('a')))));
      await tester.pump();
      await tester.pumpWidget(_host(const BlynkCrossfade(child: Text('b', key: ValueKey('b')))));
      await tester.pump(BlynkMotion.base ~/ 2);
      expect(find.text('a'), findsOneWidget);
      expect(find.text('b'), findsOneWidget);
      await tester.pumpAndSettle();
      expect(find.text('a'), findsNothing);
      expect(find.text('b'), findsOneWidget);
    });

    testWidgets('reduced motion: a change cuts', (tester) async {
      await tester.pumpWidget(_host(const BlynkCrossfade(child: Text('a', key: ValueKey('a'))), reduceMotion: true));
      await tester.pump();
      await tester.pumpWidget(_host(const BlynkCrossfade(child: Text('b', key: ValueKey('b'))), reduceMotion: true));
      await tester.pump();
      expect(find.text('a'), findsNothing);
      expect(find.text('b'), findsOneWidget);
    });
  });

  group('BlynkPageTransitionsBuilder', () {
    testWidgets('the incoming page fades in and rises', (tester) async {
      await tester.pumpWidget(MaterialApp(
        theme: ThemeData(pageTransitionsTheme: blynkPageTransitions),
        home: Builder(
          builder: (context) => TextButton(
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute<void>(builder: (_) => const Scaffold(body: Text('next'))),
            ),
            child: const Text('go'),
          ),
        ),
      ));
      await tester.tap(find.text('go'));
      await tester.pump();
      await tester.pump(BlynkMotion.base ~/ 2);

      final fade = tester.widget<FadeTransition>(
        find.ancestor(of: find.text('next'), matching: find.byType(FadeTransition)).first,
      );
      expect(fade.opacity.value, greaterThan(0));
      expect(fade.opacity.value, lessThan(1));

      await tester.pumpAndSettle();
      expect(find.text('next'), findsOneWidget);
    });

    testWidgets('covers every platform the app ships to', (tester) async {
      for (final p in [TargetPlatform.android, TargetPlatform.iOS, TargetPlatform.windows]) {
        expect(blynkPageTransitions.builders[p], isA<BlynkPageTransitionsBuilder>(), reason: '$p');
      }
    });
  });
}
