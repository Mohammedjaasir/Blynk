import 'package:flutter/widgets.dart';

import 'google_map_view.dart';
import 'map_provider_config.dart';
import 'maplibre_map_view.dart';

/// Provider-neutral map contracts (plan section 8.4). This file names no map
/// SDK: only the adapter files (google_map_view.dart, maplibre_map_view.dart)
/// may import one, so swapping the map provider later means changing those
/// files and the two factories below, nothing else. Every other file,
/// including OrderTrackingMap, depends on this file alone. The factories pick
/// ONE adapter at runtime (map_provider_config.dart) and never build both.

/// A latitude/longitude pair in degrees. Value-equal so a marker set can be
/// compared and diffed.
@immutable
class GeoPoint {
  const GeoPoint(this.latitude, this.longitude);
  final double latitude;
  final double longitude;

  @override
  bool operator ==(Object other) =>
      other is GeoPoint && other.latitude == latitude && other.longitude == longitude;

  @override
  int get hashCode => Object.hash(latitude, longitude);

  @override
  String toString() => 'GeoPoint($latitude, $longitude)';
}

/// Whether the active map draws OpenStreetMap-derived tiles, so Blynk must draw
/// the OSM credit itself. False for Google, which draws its own logo and
/// copyright that nothing may cover (plan sections 11.5, 12).
bool get mapNeedsOsmAttribution => MapProviderConfig.kind == MapProviderKind.maplibre;

enum MapMarkerTone { destination, riderLive, riderStale }

/// One marker to draw. [id] is the marker's identity across updates: the same
/// id at a new position is the same marker moving, not a new marker.
@immutable
class MapMarkerSpec {
  const MapMarkerSpec({required this.id, required this.position, required this.tone, this.heading});
  final String id;
  final GeoPoint position;
  final MapMarkerTone tone;

  /// Rider markers only (owner, 2026-10-10): the direction of travel in
  /// degrees clockwise from north; the bike icon is rotated to it. Null
  /// points the icon north (no move seen yet).
  final double? heading;

  @override
  bool operator ==(Object other) =>
      other is MapMarkerSpec &&
      other.id == id &&
      other.position == position &&
      other.tone == tone &&
      other.heading == heading;

  @override
  int get hashCode => Object.hash(id, position, tone, heading);

  @override
  String toString() => 'MapMarkerSpec($id, $position, $tone${heading == null ? '' : ', heading $heading'})';
}

/// Builds a [TrackingMapView]. The default is the real map; OrderTrackingMap
/// accepts an override so widget tests can supply a fake without a native
/// platform view.
///
/// [semanticsLabel] is an optional screen-reader label override for the map
/// region (task F1 fix round 1). It is honoured by the Google adapter today
/// (falling back to its own generic delivery/rider phrase when omitted -
/// `google_map_view.dart`'s `GoogleTrackingMapView.semanticsLabel`); the
/// MapLibre adapter has no built-in semantics node of its own and silently
/// ignores it. Every implementation of this typedef must still declare the
/// parameter (Dart function-type subtyping requires it, even when unused),
/// which is why the grocery-order call sites (`OrderTrackingMap`'s own
/// `_defaultMapBuilder`, and every test fake) now accept-and-forward/ignore
/// it without changing their own behaviour.
typedef TrackingMapBuilder = TrackingMapView Function({
  required GeoPoint initialCenter,
  required double initialZoom,
  required Set<MapMarkerSpec> markers,
  String? semanticsLabel,
});

/// The order-tracking map's builder once it draws the road route too (owner,
/// 2026-10-10). A separate typedef so every existing [TrackingMapBuilder]
/// (the dental maps, older test fakes) keeps its exact signature: Dart
/// function types would reject them if a parameter were added there.
/// [route] is the road from the rider to the door (empty = no line);
/// [interactive] is true on the full-screen map (pan / zoom).
typedef RoutedTrackingMapBuilder = TrackingMapView Function({
  required GeoPoint initialCenter,
  required double initialZoom,
  required Set<MapMarkerSpec> markers,
  required List<GeoPoint> route,
  required bool interactive,
});

/// A read-only map showing a fixed set of markers - the live delivery-tracking
/// map. The concrete widget returned is GoogleTrackingMapView (or
/// MapLibreTrackingMapView on rollback); callers never reference those classes
/// directly.
///
/// [markers] may change between builds: implementations move / retone /
/// remove the markers whose [MapMarkerSpec.id] persists, appears or vanishes.
abstract class TrackingMapView extends StatelessWidget {
  factory TrackingMapView({
    Key? key,
    required GeoPoint initialCenter,
    required double initialZoom,
    required Set<MapMarkerSpec> markers,
    String? semanticsLabel,
    List<GeoPoint> route = const [],
    bool interactive = false,
  }) {
    switch (MapProviderConfig.kind) {
      case MapProviderKind.google:
        return GoogleTrackingMapView(
          key: key,
          initialCenter: initialCenter,
          initialZoom: initialZoom,
          markers: markers,
          semanticsLabel: semanticsLabel,
          route: route,
          interactive: interactive,
        );
      case MapProviderKind.maplibre:
        // MapLibre draws no Semantics node of its own (task-F1 review-fix
        // round 1): nothing to override yet, so semanticsLabel is not
        // threaded to it. A caller relying on a label with this adapter
        // must supply its own Semantics wrapper (ClinicLocationMap does).
        return MapLibreTrackingMapView(
          key: key,
          initialCenter: initialCenter,
          initialZoom: initialZoom,
          markers: markers,
          route: route,
          interactive: interactive,
        );
    }
  }

  const TrackingMapView.constructor({super.key});

  GeoPoint get initialCenter;
  double get initialZoom;
  Set<MapMarkerSpec> get markers;
}

/// Builds a [LocationPickerMapView]. The default is the real map; the picker
/// screen accepts an override so widget tests can supply a fake without a
/// native platform view.
typedef LocationPickerMapBuilder = LocationPickerMapView Function({
  required GeoPoint initialPosition,
  required ValueChanged<GeoPoint> onPositionChanged,
});

/// An interactive map with ONE fixed pin - the address location picker
/// (Task M6). The pin stays at the centre of the view and the map pans
/// underneath it, so the picked coordinate is whatever is under the pin.
/// [onPositionChanged] reports that coordinate as the map moves and once more
/// when it settles. When the map itself cannot be shown the implementation
/// shows an honest "Map unavailable" state (no pin) and never reports a
/// position: the caller keeps the last one it knew. The concrete widget
/// returned is GoogleLocationPickerView (or MapLibreLocationPickerView on
/// rollback).
///
/// When it falls back to "Map unavailable" the implementation also dispatches a
/// [PickerMapUnavailableNotification] up the tree, so the screen can stop
/// telling the customer to "move the map" (the position it holds is then the
/// device fix, not something the customer chose).
abstract class LocationPickerMapView extends StatelessWidget {
  factory LocationPickerMapView({
    Key? key,
    required GeoPoint initialPosition,
    required ValueChanged<GeoPoint> onPositionChanged,
  }) {
    switch (MapProviderConfig.kind) {
      case MapProviderKind.google:
        return GoogleLocationPickerView(
            key: key, initialPosition: initialPosition, onPositionChanged: onPositionChanged);
      case MapProviderKind.maplibre:
        return MapLibreLocationPickerView(
            key: key, initialPosition: initialPosition, onPositionChanged: onPositionChanged);
    }
  }

  const LocationPickerMapView.constructor({super.key});
}

/// Sent up the widget tree by a [LocationPickerMapView] that could not prepare
/// a map and is showing the "Map unavailable" placeholder instead. Carries no
/// data: it only lets the picker screen swap its instruction copy.
class PickerMapUnavailableNotification extends Notification {
  const PickerMapUnavailableNotification();
}
