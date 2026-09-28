// google_map_view.dart - the ONLY file that imports the Google Maps SDK
// (plan section 11; enforced by test/map_isolation_test.dart). Everything else
// in this app depends only on map_provider.dart.
//
// Legacy `Marker`s only: no Map ID / cloudMapId, no style JSON (D12), so the
// Android free path stays free and the map looks like standard Google Maps.
// No ETA, route, navigation, geocoding or Places anywhere. This file reads no
// API key: the Android SDK reads it from the manifest.
//
// Real rendering has NOT been exercised on a device or emulator; widget tests
// run against a fake platform (test/fixtures/fake_google_maps_platform.dart).
import 'dart:async';
import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flutter/foundation.dart';
import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart'
    show
        BitmapDescriptor,
        CameraPosition,
        CameraUpdate,
        GoogleMap,
        GoogleMapController,
        LatLng,
        LatLngBounds,
        Marker,
        MarkerId;

import 'package:ecom/design/tokens.dart';

import 'map_marker_logic.dart';
import 'map_provider.dart';
import 'map_unavailable_card.dart';

/// Padding (logical px) around the two markers when the camera fits them.
const double _fitPadding = 48;
const Duration _fitDuration = BlynkMotion.camera;

/// Fit is retried a couple of times because the native map may not have been
/// laid out on the first post-frame (newLatLngBounds throws before layout).
const int _fitMaxRetries = 2;
const Duration _fitRetryDelay = Duration(milliseconds: 250);

/// Constant, small bottom inset so Google's own logo / attribution is never
/// covered by anything Blynk draws over the tracking map.
const double googleMapLogoClearance = 8;

/// Zoom for the address picker: street level.
const double _pickerZoom = 16;

const String _trackingSemanticsLabel = 'Map showing the rider and your delivery address';
const String _pickerMapSemanticsLabel = 'Map for choosing your delivery location';
const String _pickerPinSemanticsLabel = 'Delivery location pin';

/// Test seam for the web gate (kIsWeb cannot be changed in a test).
@visibleForTesting
bool? debugTreatAsWeb;

/// The Google Maps plugin has no Windows / Linux / macOS implementation, and
/// Flutter web has no Maps JS script or key configured (web is only a fallback;
/// the PWA is a separate React app), so there the honest "Map unavailable" card
/// is shown instead of a map. Web is checked first: its defaultTargetPlatform
/// is usually android.
bool get _googleMapsSupportedHere {
  if (debugTreatAsWeb ?? kIsWeb) return false;
  return defaultTargetPlatform == TargetPlatform.android || defaultTargetPlatform == TargetPlatform.iOS;
}

bool _validCoordinate(GeoPoint p) =>
    p.latitude.isFinite && p.longitude.isFinite && p.latitude.abs() <= 90 && p.longitude.abs() <= 180;

// ---------------------------------------------------------------------------
// Marker icons
// ---------------------------------------------------------------------------

/// The three marker images, drawn once with dart:ui (no image assets) and
/// cached per tone and device pixel ratio.
///
///  - destination: ink location-pin glyph;
///  - riderLive: ink disc, white ring, white two-wheeler glyph;
///  - riderStale: the same shape in ink2 at reduced opacity with a DASHED ring,
///    so a stale rider is distinguishable without relying on colour.
class GoogleMarkerIcons {
  const GoogleMarkerIcons._();

  static final Map<(MapMarkerTone, double), Future<BitmapDescriptor>> _cache = {};

  /// Test seam: replaces the dart:ui renderer so widget tests stay synchronous.
  @visibleForTesting
  static Future<BitmapDescriptor> Function(MapMarkerTone tone, double pixelRatio)? debugRenderer;

  @visibleForTesting
  static void clearCache() => _cache.clear();

  static Future<BitmapDescriptor> iconFor(MapMarkerTone tone, double pixelRatio) {
    final ratio = pixelRatio.isFinite && pixelRatio > 0 ? pixelRatio : 1.0;
    return _cache.putIfAbsent((tone, ratio), () async {
      final render = debugRenderer ?? renderMarkerIcon;
      try {
        return await render(tone, ratio);
      } catch (_) {
        _cache.remove((tone, ratio)); // do not cache a failure: the next build retries
        rethrow;
      }
    });
  }

  /// Anchor (fraction of the image) that sits on the coordinate. The pin's tip
  /// is at 22/24 of the glyph box; the rider disc is centred.
  static Offset anchorFor(MapMarkerTone tone) =>
      tone == MapMarkerTone.destination ? const Offset(0.5, 22 / 24) : const Offset(0.5, 0.5);

  static const double _pinSize = 40;
  static const double _riderSize = 44;

  /// Renders one tone to a PNG-backed [BitmapDescriptor] at [pixelRatio].
  static Future<BitmapDescriptor> renderMarkerIcon(MapMarkerTone tone, double pixelRatio) async {
    final logical = tone == MapMarkerTone.destination ? _pinSize : _riderSize;
    final pixels = (logical * pixelRatio).ceil();
    final recorder = ui.PictureRecorder();
    final canvas = Canvas(recorder)..scale(pixels / logical);

    if (tone == MapMarkerTone.destination) {
      _paintGlyph(canvas, Icons.location_on, const Size(_pinSize, _pinSize), BlynkColors.ink, _pinSize);
    } else {
      _paintRider(canvas, stale: tone == MapMarkerTone.riderStale);
    }

    final image = await recorder.endRecording().toImage(pixels, pixels);
    try {
      final data = await image.toByteData(format: ui.ImageByteFormat.png);
      if (data == null) throw StateError('marker icon encoding returned no data');
      return BitmapDescriptor.bytes(
        Uint8List.view(data.buffer, data.offsetInBytes, data.lengthInBytes),
        imagePixelRatio: pixels / logical,
      );
    } finally {
      image.dispose();
    }
  }

  static void _paintGlyph(Canvas canvas, IconData icon, Size box, Color color, double size) {
    final painter = TextPainter(
      text: TextSpan(
        text: String.fromCharCode(icon.codePoint),
        style: BlynkText.glyph(icon, size, color),
      ),
      textDirection: TextDirection.ltr,
    )..layout();
    painter.paint(canvas, Offset((box.width - painter.width) / 2, (box.height - painter.height) / 2));
    painter.dispose();
  }

  static void _paintRider(Canvas canvas, {required bool stale}) {
    const centre = Offset(_riderSize / 2, _riderSize / 2);
    const discRadius = 17.0;
    const ringRadius = 20.0;

    if (stale) {
      // One layer so the ring and the disc fade together, not separately.
      canvas.saveLayer(
        Offset.zero & const Size(_riderSize, _riderSize),
        Paint()..color = BlynkColors.paper.withValues(alpha: 0.7),
      );
    }
    canvas.drawCircle(centre, discRadius, Paint()..color = stale ? BlynkColors.ink2 : BlynkColors.ink);

    final ring = Paint()
      ..color = BlynkColors.paper
      ..style = PaintingStyle.stroke
      ..strokeWidth = stale ? 2 : 3;
    if (stale) {
      const dashes = 16;
      const sweep = 2 * math.pi / dashes;
      final rect = Rect.fromCircle(center: centre, radius: ringRadius - 1);
      for (var i = 0; i < dashes; i += 2) {
        canvas.drawArc(rect, i * sweep, sweep, false, ring);
      }
    } else {
      canvas.drawCircle(centre, ringRadius - 1.5, ring);
    }

    _paintGlyph(canvas, Icons.two_wheeler, const Size(_riderSize, _riderSize), BlynkColors.paper, 22);
    if (stale) canvas.restore();
  }
}

// ---------------------------------------------------------------------------
// Tracking view
// ---------------------------------------------------------------------------

class GoogleTrackingMapView extends TrackingMapView {
  const GoogleTrackingMapView({
    super.key,
    required this.initialCenter,
    required this.initialZoom,
    required this.markers,
    this.semanticsLabel,
  }) : super.constructor();

  @override
  final GeoPoint initialCenter;
  @override
  final double initialZoom;
  @override
  final Set<MapMarkerSpec> markers;

  /// Screen-reader label override for the map region (task-F1 review-fix
  /// round 1). Defaults to [_trackingSemanticsLabel] - every existing
  /// delivery-tracking call site (`OrderTrackingMap`) never passes this, so
  /// its announced text is completely unchanged. A caller with a different
  /// use for this widget (e.g. `ClinicLocationMap`, a static clinic-address
  /// pin - never a rider, never a delivery) supplies its own text instead.
  final String? semanticsLabel;

  @override
  Widget build(BuildContext context) => _TrackingBody(
        initialCenter: initialCenter,
        initialZoom: initialZoom,
        markers: markers,
        semanticsLabel: semanticsLabel,
      );
}

class _TrackingBody extends StatefulWidget {
  const _TrackingBody({
    required this.initialCenter,
    required this.initialZoom,
    required this.markers,
    this.semanticsLabel,
  });
  final GeoPoint initialCenter;
  final double initialZoom;
  final Set<MapMarkerSpec> markers;
  final String? semanticsLabel;

  @override
  State<_TrackingBody> createState() => _TrackingBodyState();
}

/// A read-only map: every interaction is off and the map ignores pointers, so
/// the surrounding page scroll always wins. The markers are declarative: the
/// plugin diffs the Set<Marker> by MarkerId, so the same id at a new position
/// is a move of the existing marker and a vanished id is removed (the same
/// semantics as map_marker_logic.dart's diffMarkers). Positions are never
/// interpolated or extrapolated.
///
/// The camera fits the destination and the rider ONCE, the first time both are
/// present, after the map is created and laid out; it never re-centres after
/// that. A failed camera call is logged and swallowed (retried a few times
/// when it may just be too early); it must never crash the order screen.
class _TrackingBodyState extends State<_TrackingBody>
    with SingleTickerProviderStateMixin {
  // Motion M11: the rider glides between real fixes. See MarkerMotion for
  // what it will and will not do.
  final MarkerMotion _motion = MarkerMotion();
  late final AnimationController _move = AnimationController(
    vsync: this,
    duration: BlynkMotion.slow,
  )..addListener(_onMoveTick);
  bool _reducedMotion = false;

  @override
  void initState() {
    super.initState();
    // Record where every marker starts, so the FIRST fix after this is a
    // glide from here rather than a "first sighting" cut.
    _motion.retarget(widget.markers, snapAll: true);
  }

  void _onMoveTick() {
    if (!mounted) return;
    _motion.tick(BlynkMotion.standard.transform(_move.value));
    setState(() {});
  }

  GoogleMapController? _controller;
  bool _disposed = false;
  bool _fitted = false;
  bool _fitting = false;
  bool _fitScheduled = false;
  Timer? _retryTimer;

  double? _ratio;
  final Map<MapMarkerTone, BitmapDescriptor> _icons = {};
  final Set<MapMarkerTone> _requested = {};

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _reducedMotion = BlynkMotion.reduced(context);
    final ratio = MediaQuery.devicePixelRatioOf(context);
    if (_ratio != ratio) {
      _ratio = ratio;
      _icons.clear();
      _requested.clear();
    }
    _requestIcons();
  }

  @override
  void didUpdateWidget(covariant _TrackingBody oldWidget) {
    super.didUpdateWidget(oldWidget);
    _requestIcons();
    if (!setEquals(oldWidget.markers, widget.markers)) {
      _scheduleFit();
      if (_motion.retarget(widget.markers, snapAll: _reducedMotion)) {
        _move.forward(from: 0);
      }
    }
  }

  @override
  void dispose() {
    _disposed = true;
    _retryTimer?.cancel();
    _controller = null;
    _move.dispose();
    super.dispose();
  }

  void _requestIcons() {
    final ratio = _ratio;
    if (ratio == null || !_googleMapsSupportedHere) return;
    for (final tone in {for (final m in widget.markers) m.tone}) {
      if (_icons.containsKey(tone) || !_requested.add(tone)) continue;
      unawaited(_loadIcon(tone, ratio));
    }
  }

  Future<void> _loadIcon(MapMarkerTone tone, double ratio) async {
    BitmapDescriptor icon;
    try {
      icon = await GoogleMarkerIcons.iconFor(tone, ratio);
    } catch (e) {
      debugPrint('Map marker icon could not be drawn: $e');
      // Still show the marker, in the SDK's stock pin, rather than none.
      icon = BitmapDescriptor.defaultMarkerWithHue(
        tone == MapMarkerTone.destination ? BitmapDescriptor.hueViolet : BitmapDescriptor.hueAzure,
      );
    }
    if (_disposed || _ratio != ratio) return;
    setState(() => _icons[tone] = icon);
  }

  /// The icon each marker id is currently showing, so a retone (live -> stale)
  /// keeps the old icon until the new one is drawn instead of the marker
  /// vanishing for a frame.
  final Map<String, BitmapDescriptor> _shownIcon = {};

  Set<Marker> _markers() {
    final markers = <Marker>{};
    // Rendered where each marker is SHOWN; the fit below uses the real specs.
    for (final spec in _motion.shownSpecs(widget.markers)) {
      final icon = _icons[spec.tone] ?? _shownIcon[spec.id];
      if (icon == null || !_validCoordinate(spec.position)) continue;
      _shownIcon[spec.id] = icon;
      markers.add(
        Marker(
          markerId: MarkerId(spec.id),
          position: LatLng(spec.position.latitude, spec.position.longitude),
          icon: icon,
          anchor: GoogleMarkerIcons.anchorFor(spec.tone),
          // The rider always draws above the destination.
          zIndexInt: spec.tone == MapMarkerTone.destination ? 1 : 2,
        ),
      );
    }
    _shownIcon.removeWhere((id, _) => !markers.any((m) => m.markerId.value == id));
    return markers;
  }

  void _onMapCreated(GoogleMapController controller) {
    if (_disposed) return;
    _controller = controller;
    _scheduleFit();
  }

  void _scheduleFit() {
    if (_fitScheduled || _fitted || _controller == null) return;
    _fitScheduled = true;
    // After a frame so the native map has a size (newLatLngBounds needs one).
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _fitScheduled = false;
      unawaited(_fit(0));
    });
  }

  Future<void> _fit(int attempt) async {
    final controller = _controller;
    if (_disposed || controller == null || _fitting) return;
    final destination = widget.markers.where((m) => m.tone == MapMarkerTone.destination);
    final rider = widget.markers.where((m) => m.tone != MapMarkerTone.destination);
    if (!shouldFitCamera(hasFitted: _fitted, riderPresent: rider.isNotEmpty) || destination.isEmpty) return;
    final bounds = boundsFor(destination.first.position, rider.first.position);
    if (bounds == null) return;

    final update = CameraUpdate.newLatLngBounds(
      LatLngBounds(
        southwest: LatLng(bounds.south, bounds.west),
        northeast: LatLng(bounds.north, bounds.east),
      ),
      _fitPadding,
    );
    final reduceMotion = MediaQuery.disableAnimationsOf(context);
    _fitting = true;
    try {
      if (reduceMotion) {
        await controller.moveCamera(update);
      } else {
        await controller.animateCamera(update, duration: _fitDuration);
      }
      _fitted = true;
    } catch (e) {
      debugPrint('Map camera fit failed (attempt ${attempt + 1}): $e');
      if (attempt < _fitMaxRetries && !_disposed) {
        _retryTimer?.cancel();
        _retryTimer = Timer(_fitRetryDelay, () => unawaited(_fit(attempt + 1)));
      }
    } finally {
      _fitting = false;
    }
  }

  @override
  Widget build(BuildContext context) {
    if (!_googleMapsSupportedHere) return const MapUnavailableCard();

    return Semantics(
      label: widget.semanticsLabel ?? _trackingSemanticsLabel,
      container: true,
      child: ExcludeSemantics(
        child: IgnorePointer(
          child: GoogleMap(
            initialCameraPosition: CameraPosition(
              target: LatLng(widget.initialCenter.latitude, widget.initialCenter.longitude),
              zoom: widget.initialZoom,
            ),
            onMapCreated: _onMapCreated,
            markers: _markers(),
            // Read-only: every switch is off (the plugin defaults most to on).
            scrollGesturesEnabled: false,
            zoomGesturesEnabled: false,
            rotateGesturesEnabled: false,
            tiltGesturesEnabled: false,
            zoomControlsEnabled: false,
            mapToolbarEnabled: false,
            compassEnabled: false,
            myLocationEnabled: false, // no location layer, no location permission
            myLocationButtonEnabled: false,
            indoorViewEnabled: false,
            trafficEnabled: false,
            buildingsEnabled: false,
            padding: const EdgeInsets.only(bottom: googleMapLogoClearance),
          ),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Location picker
// ---------------------------------------------------------------------------

class GoogleLocationPickerView extends LocationPickerMapView {
  const GoogleLocationPickerView({
    super.key,
    required this.initialPosition,
    required this.onPositionChanged,
  }) : super.constructor();

  final GeoPoint initialPosition;
  final ValueChanged<GeoPoint> onPositionChanged;

  @override
  Widget build(BuildContext context) =>
      _PickerBody(initialPosition: initialPosition, onPositionChanged: onPositionChanged);
}

class _PickerBody extends StatefulWidget {
  const _PickerBody({required this.initialPosition, required this.onPositionChanged});
  final GeoPoint initialPosition;
  final ValueChanged<GeoPoint> onPositionChanged;

  @override
  State<_PickerBody> createState() => _PickerBodyState();
}

/// A fixed centre pin (plain Flutter, above the map) over a pannable map: the
/// picked coordinate is the camera target. It is reported from onCameraMove
/// (each frame; the plugin only tracks the camera when that callback is set)
/// and once more from onCameraIdle with the last target, because onCameraIdle
/// carries no position. GoogleMap.padding is deliberately NOT set: it would
/// shift the centre away from the pin.
///
/// When the platform cannot host the map the placeholder is shown WITHOUT the
/// pin (a fixed pin over no map would look like a chosen spot), no position is
/// ever reported, and a [PickerMapUnavailableNotification] tells the screen.
class _PickerBodyState extends State<_PickerBody> {
  LatLng? _lastTarget;
  GeoPoint? _lastReported;

  @override
  void initState() {
    super.initState();
    if (!_googleMapsSupportedHere) {
      // After the first frame: a listener above calls setState in response.
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) const PickerMapUnavailableNotification().dispatch(context);
      });
    }
  }

  void _report(LatLng target, {required bool force}) {
    if (!mounted) return;
    final point = GeoPoint(target.latitude, target.longitude);
    if (!force && point == _lastReported) return;
    _lastReported = point;
    widget.onPositionChanged(point);
  }

  void _onCameraMove(CameraPosition position) {
    _lastTarget = position.target;
    _report(position.target, force: false);
  }

  void _onCameraIdle() {
    final target = _lastTarget;
    if (target != null) _report(target, force: true);
  }

  @override
  Widget build(BuildContext context) {
    if (!_googleMapsSupportedHere) return const MapUnavailableCard();

    return Stack(
      fit: StackFit.expand,
      children: [
        Semantics(
          label: _pickerMapSemanticsLabel,
          container: true,
          child: ExcludeSemantics(
            child: GoogleMap(
              initialCameraPosition: CameraPosition(
                target: LatLng(widget.initialPosition.latitude, widget.initialPosition.longitude),
                zoom: _pickerZoom,
              ),
              onCameraMove: _onCameraMove,
              onCameraIdle: _onCameraIdle,
              scrollGesturesEnabled: true,
              zoomGesturesEnabled: true,
              rotateGesturesEnabled: false,
              tiltGesturesEnabled: false,
              zoomControlsEnabled: false,
              mapToolbarEnabled: false,
              compassEnabled: false,
              myLocationEnabled: false, // the position comes from the address flow's own permission ask
              myLocationButtonEnabled: false,
              indoorViewEnabled: false,
              trafficEnabled: false,
              // Its own full-screen route: the map takes every drag.
              gestureRecognizers: {
                Factory<OneSequenceGestureRecognizer>(() => EagerGestureRecognizer()),
              },
            ),
          ),
        ),
        const Positioned.fill(child: IgnorePointer(child: _CentrePin(key: Key('picker-pin')))),
      ],
    );
  }
}

/// The pin's tip sits on the centre of the view (the camera target): the glyph
/// is lifted by half its height.
class _CentrePin extends StatelessWidget {
  const _CentrePin({super.key});

  static const double _size = 44;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: _pickerPinSemanticsLabel,
      child: Center(
        child: Transform.translate(
          offset: const Offset(0, -_size / 2),
          child: const Icon(Icons.location_on, size: _size, color: BlynkColors.ink),
        ),
      ),
    );
  }
}
