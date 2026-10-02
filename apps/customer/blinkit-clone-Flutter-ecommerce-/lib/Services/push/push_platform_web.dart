import 'push_platform.dart';

/// Web build: no Firebase at all (the web shop has no Firebase web config).
PushPlatform createPushPlatform() => const NoopPushPlatform();
