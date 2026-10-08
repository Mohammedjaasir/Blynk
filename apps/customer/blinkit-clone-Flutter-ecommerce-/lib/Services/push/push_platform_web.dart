import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';

import 'push_platform.dart';
import 'web_push_config.dart';

/// Web build (the PWA at blynk.lk/app, owner 2026-10-08): Firebase Cloud
/// Messaging web push. The browser shows the notification itself while the
/// app is closed or in the background, via /firebase-messaging-sw.js (served
/// by the landing site). Unsupported browsers - an iPhone before iOS 16.4, or
/// Safari before Blynk is added to the Home Screen - throw in [initialize],
/// and the app simply runs without push.
PushPlatform createPushPlatform() => WebPushPlatform();

class WebPushPlatform implements PushPlatform {
  FirebaseMessaging get _messaging => FirebaseMessaging.instance;

  @override
  String get platformName => 'web';

  @override
  Future<void> initialize() async {
    if (Firebase.apps.isEmpty) {
      await Firebase.initializeApp(options: blynkWebFirebaseOptions);
    }
    if (!await _messaging.isSupported()) {
      throw UnsupportedError('This browser cannot receive web push');
    }
  }

  // A web push opens the app at its link (set by the server); there is no
  // launch payload to read here.
  @override
  Future<Map<String, dynamic>?> launchData() async => null;

  @override
  Stream<Map<String, dynamic>> get taps => FirebaseMessaging.onMessageOpenedApp.map((m) => m.data);

  /// Only once the customer has allowed notifications: asking for a token
  /// before that would make the browser prompt out of context.
  @override
  Future<String?> getToken() async {
    final settings = await _messaging.getNotificationSettings();
    if (settings.authorizationStatus != AuthorizationStatus.authorized) return null;
    return _messaging.getToken(vapidKey: blynkWebPushVapidKey);
  }

  @override
  Stream<String> get onTokenRefresh => _messaging.onTokenRefresh;

  @override
  Future<void> deleteToken() => _messaging.deleteToken();

  @override
  Future<void> requestPermission() async {
    await _messaging.requestPermission();
  }
}
