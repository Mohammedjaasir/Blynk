import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../Models/order_model.dart';
import '../../../Models/rider_location_model.dart';
import '../../../Models/rider_route_model.dart';
import '../../../Services/Providers/location.provider.dart';
import '../../../Services/Providers/rider_route.provider.dart';
import 'map_provider.dart';
import 'rider_contact_card.dart';
import '../../../design/tokens.dart';

/// The OSM/ODbL credit a MapLibre map must show (docs/06-deployment/
/// map-tile-hosting-setup.md section 4). Drawn by Blynk's own widget tree so it
/// exists whatever the map style says; shown only when [mapNeedsOsmAttribution].
const String mapAttributionText = '© OpenStreetMap contributors';

/// W8: the one map-frame height, named in the token layer so this frame and
/// the dental ones cannot drift apart again. Same rendered 220 as before.
const double _mapHeight = BlynkMap.frameHeight;
const double _initialZoom = 14;
const double _fullScreenZoom = 15;

/// The section title above the map. It names what the section is — a live
/// position. The route line, the "Arriving in" time and the rider's name are
/// shown only when the backend sends them (owner, 2026-10-10).
const String mapSectionTitle = 'Live tracking';

/// The control that opens the map full screen (owner, 2026-10-10).
const String fullScreenLabel = 'Full map';

/// The freshness dot. Small enough to read as an indicator rather than a
/// control, and always paired with words.
const double _freshnessDot = BlynkSpace.s8;

/// "Last seen 45 seconds ago" / "Last seen 2 minutes ago". Never a coordinate.
/// A zero or negative age (clock skew) reads "just now" rather than a
/// negative number.
String lastSeenText(Duration age) {
  final seconds = age.inSeconds;
  if (seconds <= 0) return 'Last seen just now';
  if (seconds < 60) return 'Last seen $seconds ${seconds == 1 ? 'second' : 'seconds'} ago';
  final minutes = age.inMinutes;
  return 'Last seen $minutes ${minutes == 1 ? 'minute' : 'minutes'} ago';
}

/// Everything both tracking views (inline and full screen) draw, derived in
/// one place from the providers so the two can never disagree.
@immutable
class TrackingSnapshot {
  const TrackingSnapshot({
    required this.destination,
    required this.markers,
    required this.route,
    required this.riderVisible,
    required this.freshness,
    required this.lastSeen,
    required this.eta,
    required this.heading,
  });

  final GeoPoint destination;
  final Set<MapMarkerSpec> markers;

  /// The road from the rider to the door; empty when there is none to draw.
  final List<GeoPoint> route;
  final bool riderVisible;
  final LocationFreshness? freshness;

  /// "Last seen ..." for a stale rider, else null.
  final String? lastSeen;

  /// "Arriving in ~N min", only for a LIVE rider with a backend route.
  final String? eta;
  final double? heading;

  /// Null when the order has no delivery coordinates (nothing to map).
  static TrackingSnapshot? of(OrderModel order, LocationProvider location, RiderRoute? route) {
    final destLat = order.deliveryLatitude;
    final destLng = order.deliveryLongitude;
    if (destLat == null || destLng == null) return null;
    final destination = GeoPoint(destLat, destLng);
    final point = location.current;
    final freshness = location.freshness;
    final riderVisible = point != null &&
        freshness != null &&
        freshness != LocationFreshness.offline &&
        !location.closed &&
        !location.unavailable;
    final live = riderVisible && freshness == LocationFreshness.live;
    return TrackingSnapshot(
      destination: destination,
      markers: {
        MapMarkerSpec(id: 'destination', position: destination, tone: MapMarkerTone.destination),
        if (riderVisible)
          MapMarkerSpec(
            id: 'rider',
            position: GeoPoint(point.latitude, point.longitude),
            tone: freshness == LocationFreshness.stale ? MapMarkerTone.riderStale : MapMarkerTone.riderLive,
            heading: location.heading,
          ),
      },
      // The line is drawn while the rider is on the map; the time only while
      // the rider is LIVE - a time from an old position would be made up.
      route: riderVisible && route != null ? [for (final (lat, lng) in route.points) GeoPoint(lat, lng)] : const [],
      riderVisible: riderVisible,
      freshness: freshness,
      lastSeen: riderVisible && freshness == LocationFreshness.stale
          ? lastSeenText(location.now.difference(point.capturedAt))
          : null,
      eta: live && route != null ? arrivingText(route.durationSeconds) : null,
      heading: riderVisible ? location.heading : null,
    );
  }
}

/// Builds the map for [snapshot] with whichever builder the caller has: the
/// route-aware test seam, the older marker-only seam, or the real map.
TrackingMapView _buildMap({
  required TrackingSnapshot snapshot,
  required double zoom,
  required bool interactive,
  TrackingMapBuilder? mapBuilder,
  RoutedTrackingMapBuilder? routedMapBuilder,
}) {
  if (routedMapBuilder != null) {
    return routedMapBuilder(
      initialCenter: snapshot.destination,
      initialZoom: zoom,
      markers: snapshot.markers,
      route: snapshot.route,
      interactive: interactive,
    );
  }
  if (mapBuilder != null) {
    return mapBuilder(initialCenter: snapshot.destination, initialZoom: zoom, markers: snapshot.markers);
  }
  return TrackingMapView(
    initialCenter: snapshot.destination,
    initialZoom: zoom,
    markers: snapshot.markers,
    route: snapshot.route,
    interactive: interactive,
  );
}

/// The rider card's headline while the rider is on the road.
String onTheWayText(RiderContact? contact) => '${RiderContactCard.riderName(contact)} is on the way';

/// The customer's live delivery map (plan section 8): the destination pin
/// whenever the order has coordinates; the rider - a bike that turns in the
/// direction of travel - only while a LIVE or STALE point exists and the
/// stream has not ended.
///
/// Rapido-style tracking (owner, 2026-10-10; this REVERSES plan rule D.13
/// "no route, no ETA" of docs/superpowers/plans/2026-09-19-blynk-live-
/// location-tracking.md): the road route from the rider to the door and
/// "Arriving in ~N min", both from the backend's routing engine through a
/// [RiderRouteProvider] above this widget (none = no line, no time, never a
/// guess); the rider's first name and "Call rider" from the order's
/// `rider_contact`; and a tap on the map opens it full screen.
///
/// Depends only on map_provider.dart, never on a concrete map SDK (plan 8.4).
/// Needs a [LocationProvider] above it (Task M5 registers it).
class OrderTrackingMap extends StatefulWidget {
  const OrderTrackingMap({
    super.key,
    required this.order,
    this.mapBuilder,
    this.routedMapBuilder,
    this.openLink,
  });

  final OrderModel order;

  /// Test seam: substitutes the map widget so widget tests need no native
  /// platform view. Production callers leave it null and get the real map;
  /// behaviour is otherwise identical. This older seam draws no route.
  final TrackingMapBuilder? mapBuilder;

  /// Test seam that also receives the route and the interactive flag
  /// (owner, 2026-10-10). Wins over [mapBuilder] when both are given.
  final RoutedTrackingMapBuilder? routedMapBuilder;

  /// Test seam for "Call rider"; null opens links for real.
  final ExternalLinkOpener? openLink;

  @override
  State<OrderTrackingMap> createState() => _OrderTrackingMapState();
}

class _OrderTrackingMapState extends State<OrderTrackingMap> {
  LocationProvider? _location;

  /// Optional: without one (older tests, a tree that never registered it)
  /// the map simply has no route and no time.
  RiderRouteProvider? _routes;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_location != null) return;
    _location = context.read<LocationProvider>()..addListener(_onLocation);
    _routes = Provider.of<RiderRouteProvider?>(context, listen: false);
    _routes?.watch(widget.order.id);
    _onLocation();
  }

  @override
  void didUpdateWidget(covariant OrderTrackingMap oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.order.id != widget.order.id) {
      _routes?.stopWatching(oldWidget.order.id);
      _routes?.watch(widget.order.id);
    }
  }

  @override
  void dispose() {
    _location?.removeListener(_onLocation);
    _routes?.stopWatching(widget.order.id);
    super.dispose();
  }

  /// Every rider update (and the provider's age tick) asks the route
  /// provider whether a fresh route is due; it decides, rate-limited.
  void _onLocation() {
    final location = _location;
    if (location == null) return;
    final live = location.current != null &&
        location.freshness == LocationFreshness.live &&
        !location.closed &&
        !location.unavailable;
    _routes?.refreshIfDue(riderLive: live);
  }

  void _openFullScreen() {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => OrderTrackingFullScreen(
          order: widget.order,
          mapBuilder: widget.mapBuilder,
          routedMapBuilder: widget.routedMapBuilder,
          openLink: widget.openLink,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final location = context.watch<LocationProvider>();
    final routes = _routes;
    return routes == null
        ? _build(context, location, null)
        : ListenableBuilder(
            listenable: routes,
            builder: (context, _) => _build(context, location, routes.route),
          );
  }

  Widget _build(BuildContext context, LocationProvider location, RiderRoute? route) {
    final snapshot = TrackingSnapshot.of(widget.order, location, route);
    if (snapshot == null) return const SizedBox.shrink();
    final map = _buildMap(
      snapshot: snapshot,
      zoom: _initialZoom,
      interactive: false,
      mapBuilder: widget.mapBuilder,
      routedMapBuilder: widget.routedMapBuilder,
    );
    final contact = widget.order.riderContact;
    final showCard = contact != null || snapshot.eta != null;

    // Deliberately NOT wrapped in a card: `google_logo_clearance_test`
    // requires that nothing Blynk paints reaches the map's bottom strip,
    // and a card surface behind the whole section would span it. The
    // section is separated by space, like every other section here.
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Expanded(
              child: Semantics(
                header: true,
                child: const Text(mapSectionTitle, style: BlynkText.sectionHeader),
              ),
            ),
            // Outside the map frame, so nothing is drawn over the map.
            TextButton.icon(
              key: const Key('order-tracking-full-screen'),
              onPressed: _openFullScreen,
              icon: const Icon(Icons.open_in_full, size: BlynkIcons.sm),
              label: const Text(fullScreenLabel),
            ),
          ],
        ),
        const SizedBox(height: BlynkSpace.s12),
        SizedBox(
          key: const Key('order-tracking-map-frame'),
          height: _mapHeight,
          child: ClipRRect(
            borderRadius: BlynkRadius.chipAll,
            child: Stack(
              fit: StackFit.expand,
              children: [
                map,
                // Only over MapLibre's OSM tiles. Google draws its own logo
                // and copyright in that corner: never cover it.
                if (mapNeedsOsmAttribution)
                  const Positioned(
                    left: BlynkSpace.s8,
                    bottom: BlynkSpace.s8,
                    child: _AttributionOverlay(),
                  ),
                // Hairline frame above the map; ignores touches. It keeps a
                // light map from bleeding into a light page.
                const Positioned.fill(
                  child: IgnorePointer(
                    child: DecoratedBox(
                      decoration: BoxDecoration(
                        borderRadius: BlynkRadius.chipAll,
                        border: Border.fromBorderSide(BorderSide(color: BlynkColors.line)),
                      ),
                    ),
                  ),
                ),
                // The inline map is a preview: a tap opens it full screen,
                // where it pans and zooms (owner, 2026-10-10). Paints
                // nothing, so the map and Google's logo stay uncovered, and
                // the page scroll never fights the map for a drag.
                Positioned.fill(
                  child: Semantics(
                    button: true,
                    label: 'Open the map full screen',
                    child: GestureDetector(
                      key: const Key('order-tracking-map-tap'),
                      behavior: HitTestBehavior.opaque,
                      onTap: _openFullScreen,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: BlynkSpace.s12),
        Align(
          alignment: Alignment.centerLeft,
          child: _FreshnessCaption(
            text: snapshot.lastSeen,
            live: snapshot.riderVisible && snapshot.freshness == LocationFreshness.live,
          ),
        ),
        if (showCard) ...[
          const SizedBox(height: BlynkSpace.s12),
          RiderContactCard(
            headline: onTheWayText(contact),
            contact: contact,
            eta: snapshot.eta,
            heading: snapshot.heading,
            openLink: widget.openLink ?? defaultLinkOpener,
          ),
        ],
      ],
    );
  }
}

/// The tracking map full screen (owner, 2026-10-10), Rapido-style: the map
/// fills the screen and pans / zooms; the order and rider card sits below
/// it; back returns to the order. Reads the same [LocationProvider] and
/// [RiderRouteProvider] as the inline map, so the two always agree. It
/// closes itself when the server ends the live stream (the order was
/// delivered, failed or cancelled) so the order screen can show the truth.
class OrderTrackingFullScreen extends StatefulWidget {
  const OrderTrackingFullScreen({
    super.key,
    required this.order,
    this.mapBuilder,
    this.routedMapBuilder,
    this.openLink,
  });

  final OrderModel order;
  final TrackingMapBuilder? mapBuilder;
  final RoutedTrackingMapBuilder? routedMapBuilder;
  final ExternalLinkOpener? openLink;

  @override
  State<OrderTrackingFullScreen> createState() => _OrderTrackingFullScreenState();
}

class _OrderTrackingFullScreenState extends State<OrderTrackingFullScreen> {
  bool _popped = false;

  void _closeIfEnded(LocationProvider location) {
    if (_popped || !location.closed) return;
    _popped = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) Navigator.of(context).maybePop();
    });
  }

  @override
  Widget build(BuildContext context) {
    final location = context.watch<LocationProvider>();
    _closeIfEnded(location);
    final routes = Provider.of<RiderRouteProvider?>(context, listen: false);
    return Scaffold(
      backgroundColor: BlynkColors.paper,
      body: routes == null
          ? _body(context, location, null)
          : ListenableBuilder(
              listenable: routes,
              builder: (context, _) => _body(context, location, routes.route),
            ),
    );
  }

  Widget _body(BuildContext context, LocationProvider location, RiderRoute? route) {
    final snapshot = TrackingSnapshot.of(widget.order, location, route);
    final contact = widget.order.riderContact;
    final map = snapshot == null
        ? const SizedBox.shrink()
        : _buildMap(
            snapshot: snapshot,
            zoom: _fullScreenZoom,
            interactive: true,
            mapBuilder: widget.mapBuilder,
            routedMapBuilder: widget.routedMapBuilder,
          );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Expanded(
          child: Stack(
            fit: StackFit.expand,
            children: [
              KeyedSubtree(key: const Key('order-tracking-full-map'), child: map),
              if (mapNeedsOsmAttribution)
                const Positioned(left: BlynkSpace.s8, bottom: BlynkSpace.s8, child: _AttributionOverlay()),
              Positioned(
                top: 0,
                left: 0,
                child: SafeArea(
                  child: Padding(
                    padding: const EdgeInsets.all(BlynkSpace.s12),
                    child: Material(
                      color: BlynkColors.paper,
                      shape: const CircleBorder(side: BorderSide(color: BlynkColors.lineStrong)),
                      child: IconButton(
                        key: const Key('order-tracking-full-back'),
                        tooltip: 'Back to the order',
                        icon: const Icon(BlynkIcons.back, color: BlynkColors.ink),
                        onPressed: () => Navigator.of(context).maybePop(),
                      ),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
        // The order and rider card, below the map so it never covers the map
        // or the map's own logo / credit.
        Container(
          key: const Key('order-tracking-full-card'),
          color: BlynkColors.paper,
          child: SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.all(BlynkSpace.s16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    'Order ${widget.order.orderNumber}',
                    style: BlynkText.caption.copyWith(color: BlynkColors.ink3),
                  ),
                  const SizedBox(height: BlynkSpace.s8),
                  Align(
                    alignment: Alignment.centerLeft,
                    child: _FreshnessCaption(
                      text: snapshot?.lastSeen,
                      live: snapshot != null &&
                          snapshot.riderVisible &&
                          snapshot.freshness == LocationFreshness.live,
                    ),
                  ),
                  const SizedBox(height: BlynkSpace.s12),
                  RiderContactCard(
                    headline: onTheWayText(contact),
                    contact: contact,
                    eta: snapshot?.eta,
                    heading: snapshot?.heading,
                    openLink: widget.openLink ?? defaultLinkOpener,
                  ),
                ],
              ),
            ),
          ),
        ),
      ],
    );
  }
}

/// Permanent, non-dismissible, non-interactive credit in the map's bottom-left
/// corner: dark text on a translucent white chip so it reads on any tile.
class _AttributionOverlay extends StatelessWidget {
  const _AttributionOverlay();

  /// The chip is a third-party credit sitting on live tiles, so it keeps its
  /// own tight metrics rather than a page spacing step, and stays slightly
  /// translucent so it reads as part of the map.
  static const double _chipPadX = 6;
  static const double _chipPadY = 2;
  static const double _chipOpacity = 0.85;

  @override
  Widget build(BuildContext context) {
    return IgnorePointer(
      child: Container(
        key: const Key('map-attribution'),
        padding: const EdgeInsets.symmetric(horizontal: _chipPadX, vertical: _chipPadY),
        decoration: BoxDecoration(
          color: BlynkColors.paper.withValues(alpha: _chipOpacity),
          borderRadius: BlynkRadius.smAll,
        ),
        child: Text(
          mapAttributionText,
          style: BlynkText.caption.copyWith(color: BlynkColors.ink, fontWeight: FontWeight.w500),
        ),
      ),
    );
  }
}

/// Under-map status line. [live] -> "Live" (green); [text] (a "last seen"
/// string) -> stale; neither -> the unavailable copy (offline, closed,
/// refused, or no point yet).
class _FreshnessCaption extends StatelessWidget {
  const _FreshnessCaption({required this.text, required this.live});
  final String? text;
  final bool live;

  @override
  Widget build(BuildContext context) {
    final Color dot;
    final String label;
    final TextStyle style;
    if (live) {
      dot = BlynkColors.positive;
      label = 'Live';
      // Darker green than the dot: the brand green is below AA for text this
      // size on a light surface; `positiveInk` clears it.
      style = BlynkText.microLabel.copyWith(color: BlynkColors.positiveInk);
    } else if (text != null) {
      dot = BlynkColors.lineStrong;
      label = text!;
      style = BlynkText.caption.copyWith(color: BlynkColors.ink3);
    } else {
      dot = BlynkColors.lineStrong;
      label = 'Live location unavailable right now.';
      style = BlynkText.caption.copyWith(color: BlynkColors.ink3);
    }

    // A soft `well` pill, so the indicator reads as one status object rather
    // than loose text under the map. Never colour alone: the dot always sits
    // beside words that say the same thing.
    return DecoratedBox(
      decoration: const BoxDecoration(color: BlynkColors.well, borderRadius: BlynkRadius.full),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: BlynkSpace.s12, vertical: BlynkSpace.s8),
        child: Row(
          key: const Key('order-tracking-caption'),
          mainAxisSize: MainAxisSize.min,
          children: [
            SizedBox(
              width: _freshnessDot,
              height: _freshnessDot,
              child: DecoratedBox(
                decoration: BoxDecoration(color: dot, shape: BoxShape.circle),
              ),
            ),
            const SizedBox(width: BlynkSpace.s8),
            Flexible(child: Text(label, style: style)),
          ],
        ),
      ),
    );
  }
}
