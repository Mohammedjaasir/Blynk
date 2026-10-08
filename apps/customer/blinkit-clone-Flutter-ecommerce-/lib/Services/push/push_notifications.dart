import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/widgets.dart';
import 'package:provider/provider.dart';

import 'package:ecom/Infrastructure/HttpMethods/requesting_methods.dart';
import 'package:ecom/Services/Providers/auth.provider.dart';

import 'push_platform.dart';
import 'push_platform_firebase.dart' if (dart.library.js_interop) 'push_platform_web.dart';
import 'push_target.dart';

export 'push_target.dart';

/// Registers this device for push: POST /me/devices {token, platform}.
typedef RegisterDevice = Future<void> Function(String token, String platform);

/// Forgets this device on the server: DELETE /me/devices/:token, sent with
/// the access token the customer had before logging out.
typedef UnregisterDevice = Future<void> Function(String token, String accessToken);

Future<void> _registerWithApi(String token, String platform) async {
  await ApiService.requestMethods(
    methodType: 'POST',
    url: '/me/devices',
    body: {'token': token, 'platform': platform},
  );
}

/// Sent outside ApiService on purpose: after a logout the app's HTTP client
/// would try to renew a rejected token, and nothing here may touch the
/// session. A failure is fine - [PushPlatform.deleteToken] retires the token
/// at FCM anyway, and the server drops it on the next send.
Future<void> _unregisterWithApi(String token, String accessToken) async {
  final dio = Dio(BaseOptions(
    baseUrl: getApiBaseUrl(),
    connectTimeout: const Duration(seconds: 10),
    receiveTimeout: const Duration(seconds: 10),
  ));
  await dio.delete<dynamic>(
    '/me/devices/${Uri.encodeComponent(token)}',
    options: Options(headers: {'Authorization': 'Bearer $accessToken'}),
  );
}

/// Push notifications (phase 6, Firebase Cloud Messaging).
///
/// - [start] runs once from `main`, never blocking the first frame. If
///   Firebase cannot start (no google-services.json in this build, no Play
///   services) push is simply off and everything below is a no-op.
/// - On the web every call is a no-op: the web shop has no Firebase config.
/// - A tap on a notification opens the order (`/order`) or the product
///   (`/product`). A tap that launched the app from closed is kept for the
///   start route, [SessionGate], which opens it like a shared product link.
/// - [signedIn] / [signedOut] keep the server's device list in step with the
///   session ([PushSessionSync] calls them).
/// - [requestPermission] is called at a moment that explains itself (after
///   placing an order, or tapping "Notify me"), never at first launch.
class PushNotifications {
  PushNotifications({
    PushPlatform? platform,
    RegisterDevice? register,
    UnregisterDevice? unregister,
    bool? enabled,
  })  : _platform = platform ?? createPushPlatform(),
        _register = register ?? _registerWithApi,
        _unregister = unregister ?? _unregisterWithApi,
        // On for the web too since 2026-10-08 (the PWA): push_platform_web.dart.
        _enabled = enabled ?? true;

  /// The app's instance. Replaced in tests.
  static PushNotifications instance = PushNotifications();

  /// How long the start route waits for Firebase to report a launch tap.
  static const Duration launchWait = Duration(seconds: 3);

  final PushPlatform _platform;
  final RegisterDevice _register;
  final UnregisterDevice _unregister;
  final bool _enabled;

  Future<bool>? _started;
  GlobalKey<NavigatorState>? _navigatorKey;
  PushTarget? _launchTarget;
  bool _launchTaken = false;
  bool _signedIn = false;
  String? _registeredToken;
  final List<StreamSubscription<dynamic>> _subs = [];

  /// Whether push started (false until [start] completes, and for good when
  /// it failed or this is the web).
  Future<bool> get ready => _started ?? Future<bool>.value(false);

  /// Starts push once. Never throws.
  Future<bool> start({GlobalKey<NavigatorState>? navigatorKey}) {
    _navigatorKey = navigatorKey ?? _navigatorKey;
    return _started ??= _start();
  }

  Future<bool> _start() async {
    if (!_enabled) return false;
    try {
      await _platform.initialize();
      try {
        _launchTarget = PushTarget.fromData(await _platform.launchData());
      } catch (_) {}
      _subs.add(_platform.taps.listen((data) {
        final target = PushTarget.fromData(data);
        if (target != null) open(target);
      }));
      _subs.add(_platform.onTokenRefresh.listen((token) {
        if (_signedIn) unawaited(_registerToken(token));
      }));
      return true;
    } catch (e) {
      debugPrint('Push notifications are off: $e');
      return false;
    }
  }

  /// The notification that launched the app from closed, once; null if none.
  Future<PushTarget?> takeLaunchTarget() async {
    final ok = await ready.timeout(launchWait, onTimeout: () => false);
    if (!ok || _launchTaken) return null;
    _launchTaken = true;
    return _launchTarget;
  }

  /// Opens what a notification points at, on top of whatever is showing.
  void open(PushTarget target) {
    unawaited(_navigatorKey?.currentState?.pushNamed(target.route, arguments: target.id));
  }

  /// A customer is signed in (log-in or a restored session): register this
  /// device so the server can reach it.
  Future<void> signedIn() async {
    _signedIn = true;
    if (!await ready) return;
    try {
      final token = await _platform.getToken();
      if (token != null && token.isNotEmpty && _signedIn) await _registerToken(token);
    } catch (_) {}
  }

  Future<void> _registerToken(String token) async {
    try {
      await _register(token, _platform.platformName);
      _registeredToken = token;
    } catch (_) {
      // Offline or the server is down: the next sign-in or token refresh tries again.
    }
  }

  /// The customer logged out (or the session ended): stop pushes to this
  /// device. [accessToken] is the one the customer had, for the server call.
  Future<void> signedOut({String? accessToken}) async {
    _signedIn = false;
    if (!await ready) return;
    final token = _registeredToken;
    _registeredToken = null;
    if (token != null && accessToken != null && accessToken.isNotEmpty) {
      try {
        await _unregister(token, accessToken);
      } catch (_) {}
    }
    try {
      await _platform.deleteToken();
    } catch (_) {}
  }

  /// Asks for permission to show notifications (Android 13+, iOS). The
  /// system asks at most once or twice; after that this does nothing.
  Future<void> requestPermission() async {
    if (!await ready) return;
    try {
      await _platform.requestPermission();
    } catch (_) {}
    // A browser hands out its push token only once allowed, so register now.
    if (_signedIn) {
      try {
        final token = await _platform.getToken();
        if (token != null && token.isNotEmpty && token != _registeredToken) await _registerToken(token);
      } catch (_) {}
    }
  }

  @visibleForTesting
  Future<void> dispose() async {
    for (final s in _subs) {
      await s.cancel();
    }
    _subs.clear();
  }
}

/// Keeps push registration in step with the session: sign-in (or a restored
/// session) registers the device, logout or a rejected session unregisters
/// it. Sits above the navigator, next to [SessionEndListener].
class PushSessionSync extends StatefulWidget {
  const PushSessionSync({super.key, required this.child, this.push});

  final Widget child;

  /// Defaults to [PushNotifications.instance].
  final PushNotifications? push;

  @override
  State<PushSessionSync> createState() => _PushSessionSyncState();
}

class _PushSessionSyncState extends State<PushSessionSync> {
  late final AuthProvider _auth;
  bool _signedIn = false;
  String? _accessToken;

  PushNotifications get _push => widget.push ?? PushNotifications.instance;

  @override
  void initState() {
    super.initState();
    _auth = context.read<AuthProvider>();
    _auth.addListener(_sync);
    _sync();
  }

  @override
  void dispose() {
    _auth.removeListener(_sync);
    super.dispose();
  }

  void _sync() {
    final signedIn = _auth.isAuthenticated;
    // Remembered while signed in: logout clears it before listeners run.
    if (signedIn && (_auth.accessToken?.isNotEmpty ?? false)) _accessToken = _auth.accessToken;
    if (signedIn == _signedIn) return;
    _signedIn = signedIn;
    if (signedIn) {
      unawaited(_push.signedIn());
    } else {
      final token = _accessToken;
      _accessToken = null;
      unawaited(_push.signedOut(accessToken: token));
    }
  }

  @override
  Widget build(BuildContext context) => widget.child;
}
