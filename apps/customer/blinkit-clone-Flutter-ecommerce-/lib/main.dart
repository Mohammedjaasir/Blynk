import 'dart:async';

import 'package:flutter/material.dart';
import 'package:ecom/design/scroll_behavior.dart';
import 'package:flutter/services.dart';
import 'package:flutter_dotenv/flutter_dotenv.dart';
import 'package:provider/provider.dart';
import 'package:provider/single_child_widget.dart';

import 'package:ecom/Services/Providers/auth.provider.dart';
import 'package:ecom/Services/Providers/address.provider.dart';
import 'package:ecom/Services/Providers/cart.provider.dart';
import 'package:ecom/Services/Providers/connectivity_hint.dart';
import 'package:ecom/Services/Providers/dental.provider.dart';
import 'package:ecom/Services/app_config.dart';
import 'package:ecom/Services/global_error_handling.dart';
import 'package:ecom/Services/push/push_notifications.dart';
import 'package:ecom/Screens/config_problem_screen.dart';
import 'package:ecom/Services/Providers/location.provider.dart';
import 'package:ecom/Services/Providers/order.provider.dart';
import 'package:ecom/Services/Providers/product.provider.dart';
import 'package:ecom/Services/Providers/store_info.provider.dart';
import 'package:ecom/app_theme.dart';
import 'package:ecom/route_generator.dart';
import 'package:ecom/Screens/session_gate.dart';
import 'package:ecom/UI/Widgets/Organisms/blynk_launch_screen.dart';

// Shared so lib/UI/Widgets/Atoms/app_toast.dart can show a SnackBar
// without needing a BuildContext.
final rootScaffoldMessengerKey = GlobalKey<ScaffoldMessengerState>();

// Lets the session-end listener (above the navigator) send the customer to
// the login screen without a BuildContext under the navigator.
final rootNavigatorKey = GlobalKey<NavigatorState>();

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Before anything can throw: uncaught errors are logged, and a release build
  // shows a plain fallback instead of the framework's error box.
  GlobalErrorHandling.install(navigatorKey: rootNavigatorKey);

  // Load environment variables (.env file)
  try {
    await dotenv.load(fileName: ".env");
  } catch (_) {
    // No .env (e.g. a release build configured with --dart-define): AppConfig
    // treats the values as unset and applies its own rules.
  }

  final config = AppConfig.current();
  // A release build with no usable server address must not start (and must
  // never quietly talk to localhost).
  if (config.validate() == null) {
    SystemChrome.setSystemUIOverlayStyle(
      const SystemUiOverlayStyle(
        statusBarColor: Colors.white,
        statusBarIconBrightness: Brightness.dark,
      ),
    );
  }

  // Hold Flutter's first frame until the intro's logo is decoded (capped).
  // Android's splash fades away the moment Flutter draws; if that first frame
  // is drawn before the logo image is ready, the fade reveals an empty white
  // frame and the logo blinks. A screen recording caught exactly that.
  // Push notifications (Firebase). Started, never awaited: a build without
  // Firebase config, or a phone without Play services, just has no push. A
  // no-op on the web.
  if (config.validate() == null) {
    unawaited(PushNotifications.instance.start(navigatorKey: rootNavigatorKey));
  }

  WidgetsBinding.instance.deferFirstFrame();
  runApp(buildRootWidget(config));
  unawaited(_decodeLaunchLogo().whenComplete(WidgetsBinding.instance.allowFirstFrame));
}

/// Decodes the intro logo into the image cache, or gives up after a short
/// cap so a missing asset can never hold startup hostage.
Future<void> _decodeLaunchLogo() {
  final done = Completer<void>();
  final stream = const AssetImage(BlynkLaunchScreen.logoAsset)
      .resolve(ImageConfiguration.empty);
  late final ImageStreamListener listener;
  listener = ImageStreamListener(
    (_, __) { if (!done.isCompleted) done.complete(); },
    onError: (_, __) { if (!done.isCompleted) done.complete(); },
  );
  stream.addListener(listener);
  return done.future
      .timeout(const Duration(milliseconds: 600), onTimeout: () {})
      .whenComplete(() => stream.removeListener(listener));
}

/// What the app shows first: the "not configured" screen when [config] is
/// unusable (release only), otherwise the real app. A function so a test can
/// check the gate without running [main].
Widget buildRootWidget(AppConfig config) {
  final problem = config.validate();
  if (problem != null) return ConfigErrorApp(problem: problem);
  return MultiProvider(
    providers: buildAppProviders(),
    child: const MainApp(),
  );
}

/// The app's provider tree. A function (not inline in [main]) so a test can
/// check what is registered without running the app.
List<SingleChildWidget> buildAppProviders() => [
      // Learns "offline" from the app's own failed requests (no plugin).
      ChangeNotifierProvider<ConnectivityHint>(
        create: (_) => ConnectivityHint()..attach(),
      ),
      ChangeNotifierProvider<AuthProvider>(
        create: (_) => AuthProvider()..restoreSession(),
      ),
      ChangeNotifierProvider<ProductProvider>(
        create: (_) => ProductProvider(),
      ),
      // The live delivery fee (GET /store, cached on the device). Not lazy, so
      // the fetch starts at launch; it never blocks the first frame and its
      // failures are silent (the fee falls back to the cached or default one).
      ChangeNotifierProvider<StoreInfoProvider>(
        create: (_) => StoreInfoProvider()..load(),
        lazy: false,
      ),
      ChangeNotifierProvider<CartProvider>(
        create: (_) => CartProvider(),
      ),
      ChangeNotifierProvider<AddressProvider>(
        create: (_) => AddressProvider(),
      ),
      ChangeNotifierProvider<OrderProvider>(
        create: (_) => OrderProvider(),
      ),
      // Dental clinic appointments (task F1-F5). No caching of its own by
      // design (task-F1-report.md) - screens re-fetch on demand.
      ChangeNotifierProvider<DentalProvider>(
        create: (_) => DentalProvider(),
      ),
      // The customer's live rider location (SSE), watched by the order detail
      // screen while an order is out for delivery. Default real opener; the
      // provider tree disposes it.
      ChangeNotifierProvider<LocationProvider>(
        create: (_) => LocationProvider(),
      ),
    ];

class MainApp extends StatelessWidget {
  const MainApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Blynk',
      // No stretch overscroll: it bent photos and text (see the class).
      scrollBehavior: const BlynkScrollBehavior(),
      debugShowCheckedModeBanner: false,
      scaffoldMessengerKey: rootScaffoldMessengerKey,
      navigatorKey: rootNavigatorKey,
      builder: (context, child) => SessionEndListener(
        navigatorKey: rootNavigatorKey,
        messengerKey: rootScaffoldMessengerKey,
        // Registers this device for push while someone is signed in.
        child: PushSessionSync(child: child ?? const SizedBox.shrink()),
      ),
      onGenerateRoute: AppRouter.generateRoute,
      onGenerateInitialRoutes: AppRouter.generateInitialRoutes,
      initialRoute: '/',
      theme: AppTheme.appTHeme,
    );
  }
}
