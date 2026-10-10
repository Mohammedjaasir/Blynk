import 'package:flutter/widgets.dart';

/// Where a guest was going when a screen asked them to log in, so the login
/// flow can take them back there instead of leaving them on the shop
/// (owner, 2026-10-10: "If they want to go to the doctors section, they must
/// log in or create an account; then only they can see").
///
/// The login flow always ends with a fresh shop (`/home`, everything below
/// removed). [goHome] does that and then opens the remembered route on top,
/// so Back from it returns to the shop. One destination at a time; it is
/// forgotten once used, when the guest backs out of logging in, or after
/// [maxAge] (a login started long ago should not jump anywhere).
class PostLoginDestination {
  PostLoginDestination._();

  static const Duration maxAge = Duration(minutes: 30);

  static RouteSettings? _pending;
  static DateTime? _setAt;

  /// Clock seam for tests.
  @visibleForTesting
  static DateTime Function() now = DateTime.now;

  /// Remembers [name] (and its [arguments]) for after the login.
  static void remember(String name, {Object? arguments}) {
    _pending = RouteSettings(name: name, arguments: arguments);
    _setAt = now();
  }

  /// The remembered route, if any and still fresh, without using it up.
  static RouteSettings? get pending {
    final setAt = _setAt;
    if (_pending == null || setAt == null) return null;
    if (now().difference(setAt) > maxAge) {
      clear();
      return null;
    }
    return _pending;
  }

  /// The remembered route (if fresh), forgotten as it is handed out.
  static RouteSettings? take() {
    final destination = pending;
    clear();
    return destination;
  }

  static void clear() {
    _pending = null;
    _setAt = null;
  }

  /// The end of a successful login: the shop, then the remembered route on
  /// top of it when there is one.
  static void goHome(NavigatorState navigator) {
    final destination = take();
    navigator.pushNamedAndRemoveUntil('/home', (route) => false);
    final name = destination?.name;
    if (name != null && name.isNotEmpty) {
      navigator.pushNamed(name, arguments: destination!.arguments);
    }
  }
}
