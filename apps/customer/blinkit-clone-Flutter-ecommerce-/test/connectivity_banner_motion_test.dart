import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:ecom/Services/Providers/connectivity_hint.dart';
import 'package:ecom/Services/Exceptions/api_exception.dart';
import 'package:ecom/UI/Widgets/Atoms/connectivity_banner.dart';
import 'package:ecom/UI/Widgets/Atoms/offline_banner.dart';
import 'package:ecom/design/motion.dart';

/// The banner on its own, apart from any screen: it must be absent until the
/// app is offline, arrive over one beat, and leave over one beat. This is the
/// widget's own contract; the wiring tests cover where screens place it.
Widget _host(ConnectivityHint hint, {bool hasContent = true, bool reduceMotion = false}) =>
    ChangeNotifierProvider<ConnectivityHint>.value(
      value: hint,
      child: MediaQuery(
        data: MediaQueryData(size: const Size(400, 800), disableAnimations: reduceMotion),
        child: MaterialApp(
          home: Scaffold(
            body: Column(children: [ConnectivityBanner(hasContent: hasContent)]),
          ),
        ),
      ),
    );

ApiException _offline() => ApiException(503, 'x', code: 'NETWORK_ERROR');

void main() {
  group('ConnectivityBanner motion', () {
    testWidgets('absent while online, on the first frame and after settling', (tester) async {
      final hint = ConnectivityHint();
      addTearDown(hint.dispose);
      await tester.pumpWidget(_host(hint));
      await tester.pump();
      expect(find.byType(OfflineBanner), findsNothing);
      await tester.pumpAndSettle();
      expect(find.byType(OfflineBanner), findsNothing);
      expect(tester.hasRunningAnimations, isFalse);
    });

    testWidgets('arrives over one beat when the app goes offline', (tester) async {
      final hint = ConnectivityHint();
      addTearDown(hint.dispose);
      await tester.pumpWidget(_host(hint));
      await tester.pumpAndSettle();

      hint.record(_offline());
      await tester.pump();
      // In the tree at once (a screen reader can announce it)...
      expect(find.byType(OfflineBanner, skipOffstage: false), findsOneWidget);
      // ...and fully arrived one beat later.
      await tester.pump(BlynkMotion.base);
      await tester.pump();
      expect(find.byType(OfflineBanner), findsOneWidget);
      expect(tester.getSize(find.byType(OfflineBanner)).height, greaterThan(0));
    });

    testWidgets('leaves over one beat when the connection is back, and is then gone', (tester) async {
      final hint = ConnectivityHint();
      addTearDown(hint.dispose);
      await tester.pumpWidget(_host(hint));
      await tester.pumpAndSettle();
      hint.record(_offline());
      await tester.pumpAndSettle();
      expect(find.byType(OfflineBanner), findsOneWidget);

      hint.record(null);
      await tester.pump();
      // Still fading on the frame after clearing - not cut.
      expect(find.byType(OfflineBanner, skipOffstage: false), findsOneWidget);
      await tester.pumpAndSettle();
      expect(find.byType(OfflineBanner, skipOffstage: false), findsNothing);
      expect(tester.hasRunningAnimations, isFalse);
    });

    testWidgets('with nothing saved to show, it never appears', (tester) async {
      final hint = ConnectivityHint();
      addTearDown(hint.dispose);
      await tester.pumpWidget(_host(hint, hasContent: false));
      hint.record(_offline());
      await tester.pumpAndSettle();
      expect(find.byType(OfflineBanner, skipOffstage: false), findsNothing);
    });

    testWidgets('reduced motion: in and out in the same frame', (tester) async {
      final hint = ConnectivityHint();
      addTearDown(hint.dispose);
      await tester.pumpWidget(_host(hint, reduceMotion: true));
      await tester.pump();
      hint.record(_offline());
      await tester.pump();
      expect(find.byType(OfflineBanner), findsOneWidget);
      hint.record(null);
      await tester.pump();
      await tester.pump();
      expect(find.byType(OfflineBanner, skipOffstage: false), findsNothing);
      expect(tester.hasRunningAnimations, isFalse);
    });
  });
}
