import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:ecom/Screens/Auth/login_screen.dart';
import 'package:ecom/Services/Providers/auth.provider.dart';
import 'package:ecom/app_theme.dart';

Finder _group(String label) =>
    find.byWidgetPredicate((w) => w is Semantics && w.properties.label == label);

Future<void> _pumpLogin(WidgetTester tester) async {
  FlutterSecureStorage.setMockInitialValues({});
  tester.view.physicalSize = const Size(400, 800);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    ChangeNotifierProvider<AuthProvider>(
      create: (_) => AuthProvider(),
      child: MaterialApp(theme: AppTheme.theme, home: const LoginScreen()),
    ),
  );
  await tester.pump();
}

void main() {
  group('onboarding page dots are an indicator, not seven-dp buttons', () {
    testWidgets('one labelled group "Page 1 of 2"; the dots themselves expose nothing', (tester) async {
      final handle = tester.ensureSemantics();
      await _pumpLogin(tester);

      expect(find.bySemanticsLabel(RegExp(r'^Page \d+ of \d+$')), findsOneWidget);
      expect(find.bySemanticsLabel('Page 1 of 2'), findsOneWidget);
      final group = _group('Page 1 of 2');
      expect(group, findsOneWidget);
      // ExcludeSemantics inside the group: the dot containers add no nodes.
      final semantics = tester.widget<Semantics>(group);
      expect(semantics.excludeSemantics, isTrue);
      for (final control in [GestureDetector, InkWell, InkResponse]) {
        expect(find.descendant(of: group, matching: find.byType(control)), findsNothing, reason: '$control');
      }
      handle.dispose();
    });

    testWidgets('tapping a dot does not turn the page; Next and swipe still do, and the label follows', (tester) async {
      final handle = tester.ensureSemantics();
      await _pumpLogin(tester);

      final dots = find.descendant(of: _group('Page 1 of 2'), matching: find.byType(Container));
      expect(dots, findsNWidgets(2));
      final second = tester.getCenter(dots.at(1));
      await tester.tapAt(second);
      for (var i = 0; i < 8; i++) {
        await tester.pump(const Duration(milliseconds: 60));
      }
      expect(find.text('Your groceries,'), findsOneWidget);
      expect(find.bySemanticsLabel('Page 1 of 2'), findsOneWidget);

      await tester.tap(find.text('Next'));
      for (var i = 0; i < 10; i++) {
        await tester.pump(const Duration(milliseconds: 60));
      }
      expect(find.text('Order in a few taps,'), findsOneWidget);
      expect(find.bySemanticsLabel('Page 2 of 2'), findsOneWidget);
      expect(find.bySemanticsLabel('Page 1 of 2'), findsNothing);
      handle.dispose();
    });

    testWidgets('swiping the hero also changes the page label', (tester) async {
      final handle = tester.ensureSemantics();
      await _pumpLogin(tester);
      await tester.drag(find.byType(PageView), const Offset(-350, 0));
      for (var i = 0; i < 10; i++) {
        await tester.pump(const Duration(milliseconds: 60));
      }
      expect(find.bySemanticsLabel('Page 2 of 2'), findsOneWidget);
      handle.dispose();
    });
  });
}
