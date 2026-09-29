import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:ecom/Screens/feedback_screen.dart';
import 'package:ecom/Screens/help_screen.dart';
import 'package:ecom/Screens/profile_screen.dart';
import 'package:ecom/Services/Exceptions/api_exception.dart';
import 'package:ecom/Services/Providers/auth.provider.dart';
import 'package:ecom/Services/Providers/feedback.provider.dart';
import 'package:ecom/UI/Widgets/Atoms/blynk_button.dart';
import 'package:ecom/app_theme.dart';

import '../fixtures/session_fakes.dart';

/// Records every POST /feedback and answers with [respond] - no network.
class _Recorder {
  final calls = <Map<String, dynamic>>[];
  Future<dynamic> Function() respond = () async => {
        'success': true,
        'data': {'feedback': {'id': 'f1', 'status': 'NEW'}},
      };

  Future<dynamic> call({String? methodType, String? url, dynamic body}) {
    calls.add({'method': methodType, 'url': url, 'body': body});
    return respond();
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  FlutterSecureStorage.setMockInitialValues({});

  late _Recorder api;
  setUp(() => api = _Recorder());

  /// Opens the screen on top of a plain home page, so a successful send has
  /// somewhere to pop back to.
  Future<void> pumpScreen(WidgetTester tester) async {
    tester.view.physicalSize = const Size(400, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      MaterialApp(
        theme: AppTheme.theme,
        home: Builder(
          builder: (context) => Scaffold(
            body: TextButton(
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute(
                  builder: (_) => FeedbackScreen(provider: FeedbackProvider(request: api.call)),
                ),
              ),
              child: const Text('open'),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();
  }

  Future<void> tapSend(WidgetTester tester) async {
    final send = find.widgetWithText(BlynkButton, 'Send feedback');
    await tester.ensureVisible(send);
    await tester.tap(send);
  }

  testWidgets('shows the title, five stars, four category chips and the counter', (tester) async {
    await pumpScreen(tester);

    expect(find.text('Send feedback'), findsNWidgets(2)); // app bar + button
    expect(find.byIcon(Icons.star_outline_rounded), findsNWidgets(5));
    for (final chip in ['App', 'Delivery', 'Products', 'Other']) {
      expect(find.widgetWithText(ChoiceChip, chip), findsOneWidget, reason: chip);
    }
    expect(find.text('0 / 2000'), findsOneWidget);

    await tester.enterText(find.byType(TextField), 'Hello');
    await tester.pump();
    expect(find.text('5 / 2000'), findsOneWidget);
  });

  testWidgets('asks for a category and a message before sending anything', (tester) async {
    await pumpScreen(tester);

    await tapSend(tester);
    await tester.pump();

    expect(find.text('Choose what your feedback is about.'), findsOneWidget);
    expect(find.text('Write a message first.'), findsOneWidget);
    expect(api.calls, isEmpty);

    // Whitespace alone is not a message.
    await tester.tap(find.widgetWithText(ChoiceChip, 'App'));
    await tester.enterText(find.byType(TextField), '   ');
    await tapSend(tester);
    await tester.pump();
    expect(find.text('Choose what your feedback is about.'), findsNothing);
    expect(find.text('Write a message first.'), findsOneWidget);
    expect(api.calls, isEmpty);
  });

  testWidgets('sends rating, category and the trimmed message, then thanks and pops', (tester) async {
    await pumpScreen(tester);

    await tester.tap(find.bySemanticsLabel('4 stars'));
    await tester.tap(find.widgetWithText(ChoiceChip, 'Delivery'));
    await tester.enterText(find.byType(TextField), '  Rider was lovely  ');
    await tapSend(tester);
    await tester.pumpAndSettle();

    expect(api.calls, [
      {
        'method': 'POST',
        'url': '/feedback',
        'body': {'category': 'DELIVERY', 'message': 'Rider was lovely', 'rating': 4},
      },
    ]);
    expect(find.text('Thanks - your feedback was sent'), findsOneWidget);
    expect(find.byType(FeedbackScreen), findsNothing);
  });

  testWidgets('the rating is optional, and tapping the chosen star clears it', (tester) async {
    await pumpScreen(tester);

    await tester.tap(find.bySemanticsLabel('3 stars'));
    await tester.pump();
    expect(find.byIcon(Icons.star_rounded), findsNWidgets(3));
    await tester.tap(find.bySemanticsLabel('3 stars'));
    await tester.pump();
    expect(find.byIcon(Icons.star_rounded), findsNothing);

    await tester.tap(find.widgetWithText(ChoiceChip, 'App'));
    await tester.enterText(find.byType(TextField), 'No stars from me');
    await tapSend(tester);
    await tester.pumpAndSettle();

    expect(api.calls.single['body'], {'category': 'APP', 'message': 'No stars from me'});
  });

  testWidgets('shows a loading button while sending, and one tap sends once', (tester) async {
    final pending = Completer<dynamic>();
    api.respond = () => pending.future;
    await pumpScreen(tester);

    await tester.tap(find.widgetWithText(ChoiceChip, 'Other'));
    await tester.enterText(find.byType(TextField), 'Hi');
    await tapSend(tester);
    await tester.pump();

    expect(tester.widget<BlynkButton>(find.byType(BlynkButton)).loading, isTrue);
    await tapSend(tester);
    await tester.pump();
    expect(api.calls, hasLength(1));

    pending.complete({'success': true});
    await tester.pumpAndSettle();
    expect(find.byType(FeedbackScreen), findsNothing);
  });

  testWidgets('the hourly limit (429 FEEDBACK_RATE_LIMITED) says so and keeps the message', (tester) async {
    api.respond = () async => throw ApiException(429, 'raw', code: 'FEEDBACK_RATE_LIMITED');
    await pumpScreen(tester);

    await tester.tap(find.widgetWithText(ChoiceChip, 'Products'));
    await tester.enterText(find.byType(TextField), 'Sixth message');
    await tapSend(tester);
    await tester.pumpAndSettle();

    expect(find.text("You've sent 5 messages in the last hour. Please try again later."), findsOneWidget);
    expect(find.byType(FeedbackScreen), findsOneWidget);
    expect(find.text('Sixth message'), findsOneWidget);
    expect(tester.widget<BlynkButton>(find.byType(BlynkButton)).loading, isFalse);
  });

  testWidgets('a server failure shows the mapped words, never the raw error', (tester) async {
    api.respond = () async => throw ApiException(500, 'pg: relation does not exist');
    await pumpScreen(tester);

    await tester.tap(find.widgetWithText(ChoiceChip, 'App'));
    await tester.enterText(find.byType(TextField), 'Hello');
    await tapSend(tester);
    await tester.pumpAndSettle();

    expect(find.text('Something went wrong on our side. Try again in a moment.'), findsOneWidget);
    expect(find.textContaining('pg:'), findsNothing);
  });

  group('entry points', () {
    Future<List<String>> pumpHost(WidgetTester tester, Widget home, AuthProvider auth) async {
      final pushed = <String>[];
      tester.view.physicalSize = const Size(400, 1600);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(
        ChangeNotifierProvider<AuthProvider>.value(
          value: auth,
          child: MaterialApp(
            theme: AppTheme.theme,
            home: home,
            onGenerateRoute: (settings) {
              pushed.add(settings.name ?? '');
              return MaterialPageRoute(builder: (_) => const SizedBox());
            },
          ),
        ),
      );
      await tester.pumpAndSettle();
      return pushed;
    }

    testWidgets('Profile: a guest tapping Send feedback is sent to log in', (tester) async {
      final pushed = await pumpHost(tester, const ProfileScreen(), AuthProvider());
      await tester.tap(find.text('Send feedback'));
      await tester.pumpAndSettle();
      expect(pushed, ['/login']);
      expect(find.byType(FeedbackScreen), findsNothing);
    });

    testWidgets('Profile: a signed-in customer gets the feedback screen', (tester) async {
      final pushed = await pumpHost(tester, const ProfileScreen(), SignedInAuth());
      await tester.tap(find.text('Send feedback'));
      await tester.pumpAndSettle();
      expect(pushed, isEmpty);
      expect(find.byType(FeedbackScreen), findsOneWidget);
    });

    testWidgets('Help: offers Send feedback below the answers', (tester) async {
      final pushed = await pumpHost(tester, const HelpScreen(), AuthProvider());
      final row = find.text('Send feedback');
      await tester.ensureVisible(row);
      await tester.tap(row);
      await tester.pumpAndSettle();
      expect(pushed, ['/login']);
    });
  });
}
