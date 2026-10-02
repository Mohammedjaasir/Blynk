import 'dart:async';
import 'dart:convert';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

import 'push_platform.dart';

/// Android / iOS: Firebase Cloud Messaging, plus flutter_local_notifications
/// to show a push that arrives while the app is open (FCM only shows it by
/// itself when the app is in the background or closed).
PushPlatform createPushPlatform() => FirebasePushPlatform();

class FirebasePushPlatform implements PushPlatform {
  /// The Android channel the backend targets (android.notification.channelId)
  /// and the manifest names as FCM's default.
  static const AndroidNotificationChannel ordersChannel = AndroidNotificationChannel(
    'orders',
    'Order updates',
    description: 'Your order progress, and products you asked about coming back in stock.',
    importance: Importance.high,
  );

  final FlutterLocalNotificationsPlugin _local = FlutterLocalNotificationsPlugin();
  final StreamController<Map<String, dynamic>> _taps = StreamController.broadcast();
  int _nextId = 0;

  @override
  String get platformName => defaultTargetPlatform == TargetPlatform.iOS ? 'ios' : 'android';

  @override
  Future<void> initialize() async {
    await Firebase.initializeApp();
    await _local.initialize(
      settings: const InitializationSettings(
        android: AndroidInitializationSettings('@mipmap/ic_launcher'),
        // Permission is asked at a moment of the app's choosing, not at start-up.
        iOS: DarwinInitializationSettings(
          requestAlertPermission: false,
          requestBadgePermission: false,
          requestSoundPermission: false,
        ),
      ),
      onDidReceiveNotificationResponse: (response) {
        final data = _decode(response.payload);
        if (data != null) _taps.add(data);
      },
    );
    await _local
        .resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>()
        ?.createNotificationChannel(ordersChannel);

    FirebaseMessaging.onMessage.listen(_showInForeground);
    FirebaseMessaging.onMessageOpenedApp.listen((message) => _taps.add(message.data));
  }

  Future<void> _showInForeground(RemoteMessage message) async {
    final notification = message.notification;
    if (notification == null) return;
    await _local.show(
      id: _nextId++,
      title: notification.title,
      body: notification.body,
      notificationDetails: NotificationDetails(
        android: AndroidNotificationDetails(
          ordersChannel.id,
          ordersChannel.name,
          channelDescription: ordersChannel.description,
          importance: Importance.high,
          priority: Priority.high,
        ),
        iOS: const DarwinNotificationDetails(),
      ),
      payload: jsonEncode(message.data),
    );
  }

  static Map<String, dynamic>? _decode(String? payload) {
    if (payload == null || payload.isEmpty) return null;
    try {
      final value = jsonDecode(payload);
      return value is Map ? value.cast<String, dynamic>() : null;
    } catch (_) {
      return null;
    }
  }

  @override
  Future<Map<String, dynamic>?> launchData() async {
    final initial = await FirebaseMessaging.instance.getInitialMessage();
    if (initial != null) return initial.data;
    // One of the app's own foreground notifications, tapped after the app closed.
    final details = await _local.getNotificationAppLaunchDetails();
    if (details?.didNotificationLaunchApp == true) {
      return _decode(details!.notificationResponse?.payload);
    }
    return null;
  }

  @override
  Stream<Map<String, dynamic>> get taps => _taps.stream;

  @override
  Future<String?> getToken() => FirebaseMessaging.instance.getToken();

  @override
  Stream<String> get onTokenRefresh => FirebaseMessaging.instance.onTokenRefresh;

  @override
  Future<void> deleteToken() => FirebaseMessaging.instance.deleteToken();

  @override
  Future<void> requestPermission() async {
    await FirebaseMessaging.instance.requestPermission();
  }
}
