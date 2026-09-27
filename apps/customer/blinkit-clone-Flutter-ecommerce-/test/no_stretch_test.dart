import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:ecom/UI/Widgets/Atoms/image_well.dart';
import 'package:ecom/design/scroll_behavior.dart';

/// 2026-09-26, seen on the emulator: scrolling a list past its end bent the
/// product photos and stretched the text under them - Android 12+'s stretch
/// overscroll. And a tall bottle photo was cropped to a strip of its label.
void main() {
  Widget list(ScrollBehavior? behavior) => MaterialApp(
        theme: ThemeData(platform: TargetPlatform.android, useMaterial3: true),
        scrollBehavior: behavior,
        home: Scaffold(
          body: ListView(
            children: [for (var i = 0; i < 30; i++) SizedBox(height: 60, child: Text('Row $i'))],
          ),
        ),
      );

  Future<bool> stretchedDuringOverscroll(WidgetTester tester) async {
    final gesture = await tester.startGesture(tester.getCenter(find.byType(ListView)));
    for (var i = 0; i < 10; i++) {
      await gesture.moveBy(const Offset(0, 40));
      await tester.pump(const Duration(milliseconds: 16));
    }
    // The stretch is drawn by this indicator wrapping the list; while it is
    // in the tree mid-overscroll, the content is being scaled.
    final hasStretch = find.byType(StretchingOverscrollIndicator).evaluate().isNotEmpty;
    await gesture.up();
    await tester.pumpAndSettle();
    return hasStretch;
  }

  testWidgets('the Material default does stretch (the bug, reproduced)', (tester) async {
    await tester.pumpWidget(list(null));
    expect(await stretchedDuringOverscroll(tester), isTrue);
  });

  testWidgets('BlynkScrollBehavior never stretches content', (tester) async {
    await tester.pumpWidget(list(const BlynkScrollBehavior()));
    expect(await stretchedDuringOverscroll(tester), isFalse);
    expect(find.byType(StretchingOverscrollIndicator), findsNothing);
    expect(find.byType(GlowingOverscrollIndicator), findsNothing);
  });

  group('photo fit', () {
    const cardBox = Size(100, 85);
    test('a photo near the box shape fills it', () {
      expect(BlynkImageContent.fitFor(const Size(400, 400), cardBox), BoxFit.cover);
      expect(BlynkImageContent.fitFor(const Size(640, 480), cardBox), BoxFit.cover);
    });
    test('a tall bottle shot (151 x 400) is shown whole, not cropped to its label', () {
      expect(BlynkImageContent.fitFor(const Size(151, 400), cardBox), BoxFit.contain);
    });
    test('a very wide banner-like shot is shown whole', () {
      expect(BlynkImageContent.fitFor(const Size(1200, 400), cardBox), BoxFit.contain);
    });
    test('unknown size (still loading) keeps cover, so nothing jumps', () {
      expect(BlynkImageContent.fitFor(null, cardBox), BoxFit.cover);
    });
  });
}
