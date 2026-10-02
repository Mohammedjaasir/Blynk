import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'package:ecom/Infrastructure/HttpMethods/requesting_methods.dart';
import 'package:ecom/Screens/Auth/login_screen.dart';
import 'package:ecom/Services/Providers/auth.provider.dart';
import 'package:ecom/Services/app_session_cleaner.dart';
import 'package:ecom/Services/push/push_notifications.dart';
import 'package:ecom/UI/Widgets/Atoms/snackbar_helper.dart';
import 'package:ecom/design/tokens.dart';
import 'package:ecom/UI/Widgets/Atoms/blynk_crossfade.dart';
import 'package:ecom/UI/Widgets/Organisms/blynk_launch_screen.dart';

/// The message shown after a login the server no longer accepts.
const String kSessionEndedMessage = "You've been logged out. Log in again to see your orders.";

/// The app's start route. Local-first: whether a customer is signed in is
/// decided from what is stored on the device, so a returning customer goes
/// straight to the shop with no network wait and no glimpse of the login
/// screen; the session is re-checked in the background by [AuthProvider]. A
/// guest sees the login screen (with its Skip).
class SessionGate extends StatefulWidget {
  const SessionGate({super.key, this.pendingProductId});

  /// Set when the app was opened from a shared product link: once the gate
  /// has decided, the product opens on top of the shop (or the login screen).
  final String? pendingProductId;

  @override
  State<SessionGate> createState() => _SessionGateState();
}

class _SessionGateState extends State<SessionGate> {
  bool? _signedIn;
  bool _introDone = false;
  bool _showLogin = false;
  Timer? _cap;

  /// [AuthProvider.restoreSession] reads device storage only, so this cap
  /// only covers storage itself not answering: the intro never becomes a
  /// loading screen.
  static const Duration _decisionCap = Duration(seconds: 5);

  @override
  void initState() {
    super.initState();
    unawaited(_decide());
  }

  @override
  void dispose() {
    _cap?.cancel();
    super.dispose();
  }

  Future<void> _decide() async {
    final signedIn = await context.read<AuthProvider>().restoreSession();
    if (!mounted) return;
    _signedIn = signedIn;
    _leaveIfReady();
  }

  void _onIntroLeaving() {
    if (!mounted) return;
    _introDone = true;
    if (_signedIn == null) {
      _cap = Timer(_decisionCap, () {
        if (mounted && _signedIn == null) setState(() => _showLogin = true);
      });
    }
    _leaveIfReady();
  }

  void _leaveIfReady() {
    final signedIn = _signedIn;
    if (!mounted || !_introDone || signedIn == null) return;
    _cap?.cancel();
    final navigator = Navigator.of(context);
    if (signedIn) {
      unawaited(navigator.pushReplacementNamed('/home'));
    } else {
      setState(() => _showLogin = true);
    }
    _openPendingProduct(navigator);
    unawaited(_openPushLaunchTarget(navigator));
  }

  bool _pendingOpened = false;

  void _openPendingProduct(NavigatorState navigator) {
    final id = widget.pendingProductId;
    if (id == null || _pendingOpened) return;
    _pendingOpened = true;
    unawaited(navigator.pushNamed('/product', arguments: id));
  }

  bool _pushChecked = false;

  /// The same pattern for a push notification that launched the app from
  /// closed: its order or product opens on top, once the gate has decided.
  Future<void> _openPushLaunchTarget(NavigatorState navigator) async {
    if (_pushChecked) return;
    _pushChecked = true;
    final target = await PushNotifications.instance.takeLaunchTarget();
    if (target == null || !navigator.mounted) return;
    unawaited(navigator.pushNamed(target.route, arguments: target.id));
  }

  @override
  Widget build(BuildContext context) {
    // The intro is on screen from Flutter's first frame (it matches the
    // native splash exactly), so there is never a blank white frame between
    // the two. The login screen crossfades in over the intro's exit; Home
    // arrives through the app's route transition. BlynkCrossfade shows its
    // first child at full opacity - it only ever animates a change.
    return BlynkCrossfade(
      duration: BlynkMotion.slow,
      alignment: Alignment.center,
      child: _showLogin
          ? const KeyedSubtree(key: ValueKey('gate-login'), child: LoginScreen())
          : KeyedSubtree(
              key: const ValueKey('gate-intro'),
              child: BlynkLaunchScreen(onLeave: _onIntroLeaving),
            ),
    );
  }
}

/// Wired once, above the navigator. When the server rejects the login (the
/// HTTP layer or [AuthProvider] reports it) this forgets the customer's data,
/// returns to the login screen and says so in plain words. A logout the
/// customer chose is handled by the logout dialog, not here.
class SessionEndListener extends StatefulWidget {
  const SessionEndListener({
    super.key,
    required this.navigatorKey,
    required this.messengerKey,
    required this.child,
  });

  final GlobalKey<NavigatorState> navigatorKey;
  final GlobalKey<ScaffoldMessengerState> messengerKey;
  final Widget child;

  @override
  State<SessionEndListener> createState() => _SessionEndListenerState();
}

class _SessionEndListenerState extends State<SessionEndListener> {
  StreamSubscription<void>? _rejectedSub;
  StreamSubscription<SessionEndReason>? _endedSub;

  @override
  void initState() {
    super.initState();
    final auth = context.read<AuthProvider>();
    _rejectedSub = ApiService.sessionRejected.listen((_) => auth.endSession());
    _endedSub = auth.onSessionEnded.listen((_) => _onSessionEnded());
  }

  @override
  void dispose() {
    _rejectedSub?.cancel();
    _endedSub?.cancel();
    super.dispose();
  }

  void _onSessionEnded() {
    if (!mounted) return;
    AppSessionCleaner.clearUserScopedState(context);
    widget.navigatorKey.currentState?.pushNamedAndRemoveUntil('/login', (_) => false);
    showBlynkSnackBar(messengerKey: widget.messengerKey, message: kSessionEndedMessage);
  }

  @override
  Widget build(BuildContext context) => widget.child;
}
