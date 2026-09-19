import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:provider/provider.dart';

import 'package:ecom/Services/Providers/auth.provider.dart';
import 'package:ecom/Screens/Auth/login_screen.dart';
import 'package:ecom/app_theme.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  FlutterSecureStorage.setMockInitialValues({});

  testWidgets('LoginScreen smoke and UI render test', (WidgetTester tester) async {
    tester.view.physicalSize = const Size(1280, 900);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(() => tester.view.resetPhysicalSize());

    await tester.pumpWidget(
      ChangeNotifierProvider<AuthProvider>(
        create: (_) => AuthProvider(),
        child: MaterialApp(
          theme: AppTheme.appTHeme,
          home: const LoginScreen(),
        ),
      ),
    );


    // Verify Blynk branding, Skip, Next buttons and headlines are rendered for Slide 1
    expect(find.bySemanticsLabel('Blynk'), findsOneWidget);
    expect(find.text('Skip'), findsOneWidget);
    expect(find.text('Next'), findsOneWidget);
    expect(find.text('Your Groceries'), findsOneWidget);
    expect(find.text('Delivered Fast'), findsOneWidget);

    // Tap Next to navigate to Slide 2 (final slide, with a looping Lottie
    // hero - pumpAndSettle() never returns against a repeat:true animation,
    // so pump bounded ticks for the page transition instead).
    await tester.tap(find.text('Next'));
    for (int i = 0; i < 10; i++) {
      await tester.pump(const Duration(milliseconds: 50));
    }

    expect(find.text('Fast Delivery'), findsOneWidget);
    expect(find.text('To Your Door'), findsOneWidget);
    expect(find.text('Get Started'), findsOneWidget);
  });
}



