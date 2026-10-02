/// The device side of push notifications, behind a seam so the app's logic
/// ([PushNotifications]) is tested with a fake and never needs Firebase.
///
/// The real implementation is `push_platform_firebase.dart` (Android/iOS).
/// The web build gets [NoopPushPlatform]: every call does nothing, so the web
/// shop needs no Firebase web config.
abstract class PushPlatform {
  /// 'android' or 'ios' - what POST /me/devices records.
  String get platformName;

  /// Starts Firebase and local notifications. Throws when it cannot (e.g. a
  /// build without google-services.json); the app then runs without push.
  Future<void> initialize();

  /// The data of the notification that launched the app from terminated,
  /// if any.
  Future<Map<String, dynamic>?> launchData();

  /// Data of each notification the customer taps while the app is running
  /// or in the background.
  Stream<Map<String, dynamic>> get taps;

  Future<String?> getToken();
  Stream<String> get onTokenRefresh;

  /// Invalidates this device's token (logout): FCM then reports it as
  /// unregistered and the server forgets it.
  Future<void> deleteToken();

  /// Android 13+ / iOS: the system "allow notifications" prompt.
  Future<void> requestPermission();
}

class NoopPushPlatform implements PushPlatform {
  const NoopPushPlatform();

  @override
  String get platformName => 'web';
  @override
  Future<void> initialize() async {}
  @override
  Future<Map<String, dynamic>?> launchData() async => null;
  @override
  Stream<Map<String, dynamic>> get taps => const Stream.empty();
  @override
  Future<String?> getToken() async => null;
  @override
  Stream<String> get onTokenRefresh => const Stream.empty();
  @override
  Future<void> deleteToken() async {}
  @override
  Future<void> requestPermission() async {}
}
