import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:ecom/Services/global_error_handling.dart';
import 'package:ecom/UI/Widgets/Atoms/app_state_views.dart';
import 'package:ecom/app_theme.dart';

void main() {
  late GlobalKey<NavigatorState> navigatorKey;
  late List<String> logged;

  // The framework's own handlers, restored after every test so an installed
  // handler can never leak into another test.
  late ErrorWidgetBuilder originalBuilder;
  late bool Function(Object, StackTrace)? originalPlatformOnError;
  FlutterExceptionHandler? originalOnError;

  setUp(() {
    navigatorKey = GlobalKey<NavigatorState>();
    logged = [];
    originalBuilder = ErrorWidget.builder;
    originalPlatformOnError = PlatformDispatcher.instance.onError;
  });

  tearDown(() {
    ErrorWidget.builder = originalBuilder;
    PlatformDispatcher.instance.onError = originalPlatformOnError;
  });

  /// Installs the real handlers. FlutterError.onError is put back straight away
  /// in widget tests (their binding owns it to report build errors); the plain
  /// tests below that exercise it restore it themselves.
  VoidCallback install({required bool release, bool keepFlutterHandler = false}) {
    originalOnError = FlutterError.onError;
    final uninstall = GlobalErrorHandling.install(
      navigatorKey: navigatorKey,
      isRelease: release,
      log: logged.add,
    );
    if (keepFlutterHandler) FlutterError.onError = originalOnError;
    addTearDown(() => FlutterError.onError = originalOnError);
    return uninstall;
  }

  /// A widget test with the release handlers installed. The binding checks
  /// ErrorWidget.builder at the end of the test body, so it is put back there.
  void releaseWidgetTest(String name, Future<void> Function(WidgetTester tester) body) {
    testWidgets(name, (tester) async {
      final uninstall = install(release: true, keepFlutterHandler: true);
      try {
        await body(tester);
      } finally {
        uninstall();
      }
    });
  }

  group('handlers are installed', () {
    test('FlutterError.onError and PlatformDispatcher.onError are replaced', () {
      install(release: true);
      expect(FlutterError.onError, isNot(same(originalOnError)));
      expect(PlatformDispatcher.instance.onError, isNotNull);
      expect(PlatformDispatcher.instance.onError, isNot(same(originalPlatformOnError)));
    });

    test('release: a framework error is logged as its type and place only', () {
      install(release: true);
      FlutterError.onError!(const FlutterErrorDetails(
        exception: FormatException('phone number 0771234567 is not valid'),
        library: 'widgets library',
      ));

      expect(logged, hasLength(1));
      expect(logged.single, contains('FormatException'));
      expect(logged.single, contains('widgets library'));
      expect(logged.single, isNot(contains('0771234567')), reason: 'no user data in a release log');
      expect(logged.single, isNot(contains('phone number')));
    });

    test('release: an uncaught async error is logged by type only and reported handled', () {
      install(release: true);
      final handled = PlatformDispatcher.instance.onError!(
        StateError('token abc123 rejected'),
        StackTrace.current,
      );

      expect(handled, isTrue, reason: 'true = handled, so the engine does not also crash');
      expect(logged.single, contains('StateError'));
      expect(logged.single, isNot(contains('abc123')));
      expect(logged.single, isNot(contains('#0')), reason: 'no stack trace in a release log');
    });

    test('debug: the message and stack are logged for the developer', () {
      install(release: false);
      final handled = PlatformDispatcher.instance.onError!(StateError('boom'), StackTrace.current);

      expect(handled, isTrue);
      expect(logged.single, contains('boom'));
    });

    test('debug: a framework error is logged and still presented', () {
      install(release: false);
      // presentError writes to the console; silence it for the assertion.
      final original = debugPrint;
      debugPrint = (String? message, {int? wrapWidth}) {};
      addTearDown(() => debugPrint = original);
      FlutterError.onError!(FlutterErrorDetails(exception: StateError('layout boom'), library: 'rendering'));

      expect(logged.single, contains('layout boom'));
    });

    test('uninstall puts the previous handlers back', () {
      final uninstall = install(release: true);
      uninstall();
      expect(FlutterError.onError, same(originalOnError));
      expect(ErrorWidget.builder, same(originalBuilder));
      expect(PlatformDispatcher.instance.onError, same(originalPlatformOnError));
    });

    test('main() installs it before runApp', () {
      final source = File('lib/main.dart').readAsStringSync();
      expect(source, contains('GlobalErrorHandling.install('));
      expect(source.indexOf('GlobalErrorHandling.install('), lessThan(source.indexOf('runApp(')));
    });

    test('no third-party crash SDK is used', () {
      final pubspec = File('pubspec.yaml').readAsStringSync().toLowerCase();
      // Firebase is in the app for push only (firebase_core/firebase_messaging,
      // phase 6); its crash SDK (firebase_crashlytics) stays out.
      for (final sdk in ['sentry', 'crashlytics', 'bugsnag', 'datadog']) {
        expect(pubspec, isNot(contains(sdk)));
      }
    });
  });

  group('the release error widget', () {
    test("debug keeps Flutter's default error widget", () {
      install(release: false);
      expect(ErrorWidget.builder, same(originalBuilder));
    });

    test('release replaces it', () {
      install(release: true);
      expect(ErrorWidget.builder, isNot(same(originalBuilder)));
    });

    releaseWidgetTest('a widget that throws while building shows the customer-safe fallback', (tester) async {
      await tester.pumpWidget(MaterialApp(
        theme: AppTheme.appTHeme,
        navigatorKey: navigatorKey,
        home: Scaffold(
          body: Builder(builder: (context) => throw StateError('secret internals')),
        ),
      ));
      final exception = tester.takeException(); // the build error is still reported
      expect(exception, isA<StateError>());

      expect(find.text('Something went wrong'), findsOneWidget);
      expect(find.text('Go to Shop'), findsOneWidget);
      expect(find.byType(ErrorWidget), findsNothing, reason: 'not the red/grey framework box');
      expect(find.textContaining('secret'), findsNothing);
      expect(find.textContaining('StateError'), findsNothing);
      expect(find.byType(AppStateView), findsOneWidget);
    });

    releaseWidgetTest('its copy is plain: no exclamation mark, no technical words', (tester) async {
      final fallback = ErrorWidget.builder(FlutterErrorDetails(exception: StateError('x')));
      await tester.pumpWidget(MaterialApp(theme: AppTheme.appTHeme, home: Scaffold(body: fallback)));

      final texts = tester.widgetList<Text>(find.byType(Text)).map((t) => t.data ?? '').join(' ').toLowerCase();
      expect(texts, isNotEmpty);
      expect(texts, isNot(contains('!')));
      for (final word in ['exception', 'error', 'server', 'api', 'stack']) {
        expect(texts, isNot(contains(word)), reason: word);
      }
    });

    releaseWidgetTest('"Go to Shop" reloads to Home, clearing the stack', (tester) async {
      final pushed = <String?>[];
      await tester.pumpWidget(MaterialApp(
        theme: AppTheme.appTHeme,
        navigatorKey: navigatorKey,
        onGenerateRoute: (settings) {
          pushed.add(settings.name);
          return MaterialPageRoute(
            settings: settings,
            builder: (_) => Scaffold(
              body: settings.name == '/home'
                  ? const Text('home')
                  : Builder(builder: (context) => throw StateError('x')),
            ),
          );
        },
        initialRoute: '/broken',
      ));
      tester.takeException();

      await tester.tap(find.text('Go to Shop'));
      await tester.pumpAndSettle();

      expect(pushed.last, '/home');
      expect(find.text('home'), findsOneWidget);
      expect(navigatorKey.currentState!.canPop(), isFalse, reason: 'the broken page is gone from the stack');
    });

    releaseWidgetTest('it works even when the failed widget had no theme or directionality above it', (tester) async {
      await tester.pumpWidget(MediaQuery(
        data: const MediaQueryData(size: Size(400, 800)),
        child: ErrorWidget.builder(FlutterErrorDetails(exception: StateError('x'))),
      ));
      expect(tester.takeException(), isNull);
      expect(find.text('Something went wrong'), findsOneWidget);
    });

    for (final scale in [1.0, 2.0]) {
      releaseWidgetTest('it does not overflow at text scale $scale', (tester) async {
          tester.view.physicalSize = const Size(320, 480);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.reset);
        await tester.pumpWidget(MaterialApp(
          theme: AppTheme.appTHeme,
          builder: (context, child) => MediaQuery(
            data: MediaQuery.of(context).copyWith(textScaler: TextScaler.linear(scale)),
            child: child!,
          ),
          home: Scaffold(body: ErrorWidget.builder(FlutterErrorDetails(exception: StateError('x')))),
        ));
        expect(tester.takeException(), isNull);
        expect(find.text('Go to Shop'), findsOneWidget);
      });
    }
  });
}
