import 'dart:ui' show SemanticsAction;

import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:ecom/Screens/profile_screen.dart';
import 'package:ecom/Services/Providers/auth.provider.dart';
import 'package:ecom/design/tokens.dart';

import 'fixtures/component_host.dart';
import 'fixtures/session_fakes.dart';

Future<void> _pump(WidgetTester tester, {AuthProvider? auth, double textScale = 1}) async {
  await tester.pumpWidget(
    ChangeNotifierProvider<AuthProvider>.value(
      value: auth ?? AuthProvider(),
      child: componentHost(tester, const ProfileScreen(), textScale: textScale, center: false),
    ),
  );
  await tester.pumpAndSettle();
}

/// W7 added "My appointments" to the account rows (the appointment list is
/// the customer's own and had no entry point outside the dental clinics
/// screen). It is signed-in only, so the guest rows are unchanged.
/// "Send feedback" (migration 013) is shown to guests too; tapping it as a
/// guest goes to log in (feedback_screen_test.dart).
const _signedInRows = [
  'Your orders',
  'Address book',
  'My appointments',
  'Send feedback',
  'Share the app',
  'About us',
  'Log out',
];

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  FlutterSecureStorage.setMockInitialValues({});

  testWidgets('a guest sees "My Account" and no fake Wallet/Support/Payments tiles', (tester) async {
    await _pump(tester);

    expect(find.text('My Account'), findsOneWidget);
    for (final fake in ['Wallet', 'Support', 'Payments']) {
      expect(find.text(fake), findsNothing);
    }
    expect(find.byType(Image), findsNothing);
  });

  testWidgets('a guest sees the five account-free rows and no Log out', (tester) async {
    await _pump(tester);

    for (final row in ['Your orders', 'Address book', 'Send feedback', 'Share the app', 'About us']) {
      expect(find.text(row), findsOneWidget, reason: row);
    }
    expect(find.text('Log out'), findsNothing);
  });

  testWidgets('a signed-in user sees exactly the seven real rows, in sentence case', (tester) async {
    await _pump(tester, auth: SignedInAuth());

    for (final row in _signedInRows) {
      expect(find.text(row), findsOneWidget, reason: row);
    }
    expect(find.text('Log in'), findsNothing);
    expect(find.text('YOUR INFORMATION'), findsNothing);
    expect(find.text('OTHERS'), findsNothing);
  });

  testWidgets('rows have no inert IconButton: the chevron is a plain non-interactive Icon', (tester) async {
    await _pump(tester, auth: SignedInAuth());

    expect(find.byType(IconButton), findsNothing);
    final chevrons = find.byIcon(BlynkIcons.chevron);
    expect(chevrons, findsNWidgets(_signedInRows.length));
    // The chevron is not a button, and the only tap targets around the
    // chevrons are the rows themselves (one InkWell per row).
    expect(find.ancestor(of: chevrons, matching: find.byType(IconButton)), findsNothing);
    expect(
      find.ancestor(of: chevrons, matching: find.byType(InkWell)),
      findsNWidgets(_signedInRows.length),
    );
  });

  testWidgets('Your orders and Address book use different icons', (tester) async {
    await _pump(tester);

    expect(BlynkIcons.orders, isNot(BlynkIcons.addressBook));
    expect(find.byIcon(BlynkIcons.orders), findsOneWidget);
    expect(find.byIcon(BlynkIcons.addressBook), findsOneWidget);
  });

  testWidgets('each row is one 48 dp+ target with button semantics', (tester) async {
    await _pump(tester, auth: SignedInAuth());

    for (final row in _signedInRows) {
      final size = tester.getSize(
        find.ancestor(of: find.text(row), matching: find.byType(InkWell)).first,
      );
      expect(size.height, greaterThanOrEqualTo(48), reason: row);

      final data = tester.getSemantics(find.bySemanticsLabel(row)).getSemanticsData();
      expect(data.flagsCollection.isButton, isTrue, reason: row);
      expect(data.hasAction(SemanticsAction.tap), isTrue, reason: row);
    }
  });

  testWidgets('tapping a row runs its callback once (the whole row is the target)', (tester) async {
    final pushed = <String>[];
    final pushedArguments = <Object?>[];
    tester.view.physicalSize = const Size(400, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      ChangeNotifierProvider<AuthProvider>.value(
        value: AuthProvider(),
        child: MaterialApp(
          home: const ProfileScreen(),
          onGenerateRoute: (settings) {
            pushed.add(settings.name ?? '');
            pushedArguments.add(settings.arguments);
            return MaterialPageRoute(builder: (_) => const SizedBox());
          },
        ),
      ),
    );

    // Tap the chevron end of the row, away from the label. "Your orders" is
    // the Orders tab, not a pushed screen: with no shell underneath, a shell
    // is started on that tab (index 1).
    await tester.tap(find.byIcon(BlynkIcons.chevron).first);
    await tester.pumpAndSettle();
    expect(pushed, ['/home']);
    expect(pushedArguments, [1]);
  });

  testWidgets('a signed-in user sees their name and phone', (tester) async {
    await _pump(tester, auth: SignedInAuth());

    expect(find.text('Nimal Perera'), findsOneWidget);
    expect(find.text('+94771234567'), findsOneWidget);
    expect(find.text('My Account'), findsNothing);
  });

  for (final scale in kTextScales) {
    testWidgets('does not overflow at text scale $scale', (tester) async {
      await _pump(tester, textScale: scale);
      expect(tester.takeException(), isNull);
    });
  }
}
