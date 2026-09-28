// maplibre_map_view.dart - the ONLY file that imports the MapLibre SDK
// (plan section 8.4; enforced by test/map_isolation_test.dart). Everything else
// in this app depends only on map_provider.dart.
//
// Pure logic (marker diffing, paint, fit-bounds decision, tile URL and style
// substitution) lives in map_marker_logic.dart / map_tile_config.dart so it is
// unit-tested without a native platform view. This file is the thin, stateful
// glue that applies that logic to a MapLibreMapController. It has NOT been
// exercised on a device or emulator in the task that wrote it.
import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show rootBundle;
import 'package:maplibre_gl/maplibre_gl.dart'
    show
        AnnotationType,
        AttributionButtonPosition,
        CameraPosition,
        CameraUpdate,
        Circle,
        CircleOptions,
        LatLng,
        LatLngBounds,
        MapLibreMap,
        MapLibreMapController,
        MinMaxZoomPreference;

import 'package:ecom/app_colors.dart';
import 'package:ecom/app_design.dart';

import 'map_marker_logic.dart';
import 'map_provider.dart';
import 'map_tile_config.dart';
import 'map_unavailable_card.dart';
import 'order_tracking_map.dart' show mapAttributionText;
import '../../../design/tokens.dart';

/// Padding (logical px) around the two markers when the camera fits them.
const double _fitPadding = 48;
const Duration _fitDuration = BlynkMotion.camera;

/// The bundled style with the tile URL substituted (map_tile_config.dart), or
/// null when it cannot be prepared safely - the caller then shows "Map
/// unavailable" rather than a map built from a guessed URL. Shared by every map
/// widget in this file.
Future<String?> _prepareMapStyle() async {
  try {
    final raw = await rootBundle.loadString(kMapStyleAsset);
    final tilesUrl = resolveMapTilesUrlFromEnvironment();
    if (tilesUrl != null) return substituteTilesUrl(raw, tilesUrl);
  } catch (e) {
    debugPrint('Map style could not be prepared: $e');
  }
  return null;
}

class MapLibreTrackingMapView extends TrackingMapView {
  const MapLibreTrackingMapView({
    super.key,
    required this.initialCenter,
    required this.initialZoom,
    required this.markers,
  }) : super.constructor();

  @override
  final GeoPoint initialCenter;
  @override
  final double initialZoom;
  @override
  final Set<MapMarkerSpec> markers;

  @override
  Widget build(BuildContext context) =>
      _TrackingMapBody(initialCenter: initialCenter, initialZoom: initialZoom, markers: markers);
}

class _TrackingMapBody extends StatefulWidget {
  const _TrackingMapBody({required this.initialCenter, required this.initialZoom, required this.markers});
  final GeoPoint initialCenter;
  final double initialZoom;
  final Set<MapMarkerSpec> markers;

  @override
  State<_TrackingMapBody> createState() => _TrackingMapBodyState();
}

/// Draws the markers as MapLibre circle annotations (no image assets: a plain
/// coloured dot per tone, which also makes the stale fade a simple opacity).
///
/// Lifecycle rules, because the native map becomes usable asynchronously and
/// can go away at any time:
///  - nothing touches the controller before onStyleLoaded (annotation managers
///    are not initialised earlier) - the wanted markers are read fresh when the
///    map becomes ready, so the latest set is always the one applied;
///  - one apply loop at a time; a marker update that arrives mid-apply sets a
///    dirty flag and the loop runs again, so updates coalesce and never
///    interleave;
///  - after dispose nothing is called;
///  - a failed platform call is logged and swallowed: the order screen must
///    not crash because a map call failed. The next marker change retries.
class _TrackingMapBodyState extends State<_TrackingMapBody>
    with SingleTickerProviderStateMixin {
  // Motion M11: the rider glides between real fixes (see MarkerMotion).
  final MarkerMotion _motion = MarkerMotion();
  late final AnimationController _move = AnimationController(
    vsync: this,
    duration: BlynkMotion.slow,
  )..addListener(_onMoveTick);
  bool _reducedMotion = false;

  void _onMoveTick() {
    if (!mounted) return;
    _motion.tick(BlynkMotion.standard.transform(_move.value));
    _scheduleApply();
  }

  /// The style with the tile URL substituted, or null while loading / failed.
  String? _style;
  bool _styleFailed = false;

  MapLibreMapController? _controller;
  bool _styleLoaded = false;
  bool _disposed = false;
  bool _applying = false;
  bool _dirty = false;
  bool _fitted = false;

  final Map<String, Circle> _circles = {};
  final Map<String, MapMarkerSpec> _applied = {};

  @override
  void initState() {
    super.initState();
    _motion.retarget(widget.markers, snapAll: true); // seed: see google adapter
    unawaited(_loadStyle());
  }

  Future<void> _loadStyle() async {
    final style = await _prepareMapStyle();
    if (!mounted) return;
    setState(() {
      _style = style;
      _styleFailed = style == null;
    });
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _reducedMotion = BlynkMotion.reduced(context);
  }

  @override
  void didUpdateWidget(covariant _TrackingMapBody oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!setEquals(oldWidget.markers, widget.markers)) {
      _scheduleApply();
      if (_motion.retarget(widget.markers, snapAll: _reducedMotion)) {
        _move.forward(from: 0);
      }
    }
  }

  @override
  void dispose() {
    _disposed = true;
    _move.dispose();
    _controller = null;
    _circles.clear();
    _applied.clear();
    super.dispose();
  }

  bool get _canApply => !_disposed && _styleLoaded && _controller != null;

  void _onMapCreated(MapLibreMapController controller) {
    // A (re)created native map starts empty: forget annotations of any
    // earlier one so the diff re-adds everything.
    _controller = controller;
    _styleLoaded = false;
    _circles.clear();
    _applied.clear();
  }

  void _onStyleLoaded() {
    // A style (re)load rebuilds the native circle manager, so every circle
    // added before it is gone: forget them so the diff re-adds the markers.
    _circles.clear();
    _applied.clear();
    _styleLoaded = true;
    _scheduleApply();
  }

  void _scheduleApply() {
    if (_canApply) unawaited(_drain());
  }

  Future<void> _drain() async {
    if (_applying) {
      _dirty = true;
      return;
    }
    _applying = true;
    try {
      do {
        _dirty = false;
        await _applyOnce();
      } while (_dirty && _canApply);
    } finally {
      _applying = false;
    }
  }

  CircleOptions _optionsFor(MapMarkerSpec marker) {
    final paint = markerPaintFor(marker.tone);
    return CircleOptions(
      geometry: LatLng(marker.position.latitude, marker.position.longitude),
      circleColor: paint.colorHex,
      circleOpacity: paint.opacity,
      circleRadius: paint.radius,
      circleStrokeColor: paint.strokeColorHex,
      circleStrokeWidth: paint.strokeWidth,
      circleStrokeOpacity: paint.strokeOpacity,
    );
  }

  Future<void> _applyOnce() async {
    final controller = _controller;
    if (!_canApply || controller == null) return;
    final diff = diffMarkers(_applied, _motion.shownSpecs(widget.markers));
    try {
      for (final id in diff.removedIds) {
        final circle = _circles.remove(id);
        _applied.remove(id);
        if (circle != null) await controller.removeCircle(circle);
        if (!_canApply) return;
      }
      for (final marker in diff.added) {
        final circle = await controller.addCircle(_optionsFor(marker));
        if (!_canApply) return;
        _circles[marker.id] = circle;
        _applied[marker.id] = marker;
      }
      for (final marker in diff.updated) {
        final circle = _circles[marker.id];
        if (circle == null) continue;
        await controller.updateCircle(circle, _optionsFor(marker));
        if (!_canApply) return;
        _applied[marker.id] = marker;
      }
      await _fitOnce(controller);
    } catch (e) {
      debugPrint('Map marker update failed: $e');
    }
  }

  Future<void> _fitOnce(MapLibreMapController controller) async {
    final destination = _applied.values.where((m) => m.tone == MapMarkerTone.destination);
    final rider = _applied.values.where((m) => m.tone != MapMarkerTone.destination);
    if (!shouldFitCamera(hasFitted: _fitted, riderPresent: rider.isNotEmpty) || destination.isEmpty) return;
    final bounds = boundsFor(destination.first.position, rider.first.position);
    if (bounds == null) return;
    _fitted = true;
    await controller.animateCamera(
      CameraUpdate.newLatLngBounds(
        LatLngBounds(
          southwest: LatLng(bounds.south, bounds.west),
          northeast: LatLng(bounds.north, bounds.east),
        ),
        left: _fitPadding,
        top: _fitPadding,
        right: _fitPadding,
        bottom: _fitPadding,
      ),
      duration: _fitDuration,
    );
  }

  @override
  Widget build(BuildContext context) {
    if (_styleFailed) return const MapUnavailableCard();
    final style = _style;
    if (style == null) return const ColoredBox(color: AppSurfaces.tile);

    return MapLibreMap(
      styleString: style,
      initialCameraPosition: CameraPosition(
        target: LatLng(widget.initialCenter.latitude, widget.initialCenter.longitude),
        zoom: widget.initialZoom,
      ),
      onMapCreated: _onMapCreated,
      onStyleLoadedCallback: _onStyleLoaded,
      // A small inline map: keep it light on low/mid-range Android.
      compassEnabled: false,
      rotateGesturesEnabled: false,
      tiltGesturesEnabled: false,
      dragEnabled: false, // annotation dragging; panning the map stays on
      myLocationEnabled: false, // no location layer, no location permission
      logoEnabled: false,
      // Only circles are used, so skip the other annotation managers.
      annotationOrder: const [AnnotationType.circle],
      annotationConsumeTapEvents: const [AnnotationType.circle],
      minMaxZoomPreference: const MinMaxZoomPreference(10, 18),
      // The package offers no switch to hide its native attribution button, so
      // it stays bottom-right; Blynk's own overlay (bottom-left) is the
      // authoritative credit.
      attributionButtonPosition: AttributionButtonPosition.bottomRight,
      // Inside the order screen's scroll view the map would otherwise lose
      // every drag to the page scroll.
      gestureRecognizers: {
        Factory<OneSequenceGestureRecognizer>(() => EagerGestureRecognizer()),
      },
    );
  }
}

class MapLibreLocationPickerView extends LocationPickerMapView {
  const MapLibreLocationPickerView({
    super.key,
    required this.initialPosition,
    required this.onPositionChanged,
  }) : super.constructor();

  final GeoPoint initialPosition;
  final ValueChanged<GeoPoint> onPositionChanged;

  @override
  Widget build(BuildContext context) =>
      _PickerMapBody(initialPosition: initialPosition, onPositionChanged: onPositionChanged);
}

/// Zoom for the address picker: street level, inside the archive's coverage
/// (the tracking map uses the same 10..18 range).
const double _pickerZoom = 16;

class _PickerMapBody extends StatefulWidget {
  const _PickerMapBody({required this.initialPosition, required this.onPositionChanged});
  final GeoPoint initialPosition;
  final ValueChanged<GeoPoint> onPositionChanged;

  @override
  State<_PickerMapBody> createState() => _PickerMapBodyState();
}

/// A fixed centre pin over a pannable map (not an annotation dragged around):
/// the picked coordinate is the camera target. maplibre_gl 0.25.0 reports it
/// through MapLibreMap.onCameraMove (each frame, with the CameraPosition) and
/// onCameraIdle (once settled; the position is then on the controller). Both
/// only carry a position when trackCameraPosition is true - the Android and iOS
/// controllers return null / send nothing otherwise - so it is switched on.
/// Nothing here uses annotations, so no annotation manager or drag setting
/// matters, and the pin is plain Flutter (no image asset, immune to style
/// reloads).
///
/// When the style cannot be prepared the placeholder is shown WITHOUT the pin
/// (a fixed pin over no map would look like a chosen spot) and no position is
/// ever reported: the screen keeps the last one it knew.
///
/// Like the tracking view, this has NOT been exercised on a device or emulator
/// in the task that wrote it.
class _PickerMapBodyState extends State<_PickerMapBody> {
  String? _style;
  bool _styleFailed = false;
  MapLibreMapController? _controller;
  GeoPoint? _lastReported;

  @override
  void initState() {
    super.initState();
    unawaited(_loadStyle());
  }

  Future<void> _loadStyle() async {
    final style = await _prepareMapStyle();
    if (!mounted) return;
    setState(() {
      _style = style;
      _styleFailed = style == null;
    });
    // Tell the screen the customer is not looking at a map, so it does not
    // ask them to move one.
    if (style == null) const PickerMapUnavailableNotification().dispatch(context);
  }

  @override
  void dispose() {
    _controller = null;
    super.dispose();
  }

  /// Reports a camera target, skipping repeats (idle usually re-reports the
  /// last move) and anything after dispose.
  void _report(LatLng target) {
    if (!mounted) return;
    final point = GeoPoint(target.latitude, target.longitude);
    if (point == _lastReported) return;
    _lastReported = point;
    widget.onPositionChanged(point);
  }

  void _onCameraMove(CameraPosition position) => _report(position.target);

  void _onCameraIdle() {
    final position = _controller?.cameraPosition;
    if (position != null) _report(position.target);
  }

  @override
  Widget build(BuildContext context) {
    final style = _style;
    final Widget map;
    if (_styleFailed) {
      map = const MapUnavailableCard();
    } else if (style == null) {
      map = const ColoredBox(color: AppSurfaces.tile);
    } else {
      map = MapLibreMap(
        styleString: style,
        initialCameraPosition: CameraPosition(
          target: LatLng(widget.initialPosition.latitude, widget.initialPosition.longitude),
          zoom: _pickerZoom,
        ),
        onMapCreated: (controller) => _controller = controller,
        onCameraMove: _onCameraMove,
        onCameraIdle: _onCameraIdle,
        trackCameraPosition: true,
        // A confirmation aid: keep it light on low/mid-range Android.
        compassEnabled: false,
        rotateGesturesEnabled: false,
        tiltGesturesEnabled: false,
        myLocationEnabled: false, // the position comes from the address flow's own permission ask
        logoEnabled: false,
        annotationOrder: const [],
        minMaxZoomPreference: const MinMaxZoomPreference(10, 18),
        attributionButtonPosition: AttributionButtonPosition.bottomRight,
      );
    }

    return Stack(
      fit: StackFit.expand,
      children: [
        map,
        if (style != null && !_styleFailed)
          const Positioned.fill(child: IgnorePointer(child: _CentrePin(key: Key('picker-pin')))),
        const Positioned(left: AppSpacing.sm, bottom: AppSpacing.sm, child: _PickerAttribution()),
      ],
    );
  }
}

/// The pin's tip sits exactly on the centre of the view (the camera target):
/// the glyph is lifted by half its height.
class _CentrePin extends StatelessWidget {
  const _CentrePin({super.key});

  static const double _size = 44;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Transform.translate(
        offset: const Offset(0, -_size / 2),
        child: const Icon(Icons.location_on, size: _size, color: AppColors.primaryGreenColor),
      ),
    );
  }
}

/// The permanent OSM credit (same treatment as OrderTrackingMap's overlay),
/// drawn by Blynk's own widget tree so it survives a style or provider swap.
class _PickerAttribution extends StatelessWidget {
  const _PickerAttribution();

  @override
  Widget build(BuildContext context) {
    return IgnorePointer(
      child: Container(
        key: const Key('map-attribution'),
        padding: const EdgeInsets.symmetric(horizontal: AppSpacing.sm - 2, vertical: 2),
        decoration: BoxDecoration(
          color: Colors.white.withValues(alpha: 0.85),
          borderRadius: BorderRadius.circular(4),
        ),
        child: Text(
          mapAttributionText,
          style: BlynkText.caption.copyWith(color: AppTextColors.primary, fontWeight: FontWeight.w500),
        ),
      ),
    );
  }
}
