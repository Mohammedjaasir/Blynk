import 'package:flutter/foundation.dart';

/// Which map adapter the app builds. MapLibre (open source, free, tiles
/// self-hosted by the Blynk API) is the default since 2026-09-28: with no
/// Google Maps key configured the Google map drew a blank grey square, and
/// the owner asked for a free open-source map. Google stays as an opt-in.
enum MapProviderKind { google, maplibre }

/// Compile-time provider choice: `--dart-define=MAP_PROVIDER=google` opts in
/// to Google; anything else (including an unknown value or nothing) is
/// MapLibre.
/// Exactly one adapter is ever built, never both.
class MapProviderConfig {
  const MapProviderConfig._();

  static const String _define = String.fromEnvironment('MAP_PROVIDER', defaultValue: 'maplibre');

  /// The kind selected by the build define. Kept separate from [kind] so tests
  /// can see the pure parsing.
  static MapProviderKind parse(String value) =>
      value.trim().toLowerCase() == 'google' ? MapProviderKind.google : MapProviderKind.maplibre;

  /// Test-only: forces a provider. Reset it to null in tearDown.
  @visibleForTesting
  static MapProviderKind? debugOverride;

  static MapProviderKind get kind => debugOverride ?? parse(_define);
}
