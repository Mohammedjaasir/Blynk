import 'dart:math' as math;
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/widgets.dart';

import '../../../design/tokens.dart';

/// The rider-on-a-bike marker (owner, 2026-10-10): a top-down scooter with
/// its rider, drawn in code (no image asset, no third-party art), facing
/// NORTH (up). The map adapters rotate it to the direction of travel, so the
/// front wheel always leads.
///
/// Shared by both map adapters (they never import each other) and by any
/// widget that wants the same glyph. No map SDK here.

/// The icon's logical box. The adapters draw it at this size on the map.
const double kRiderBikeLogicalSize = 48;

/// Opacity of a STALE rider (last seen a while ago): the same bike, faded,
/// so "old position" never relies on colour alone.
const double kRiderBikeStaleOpacity = 0.55;

class RiderBikePainter extends CustomPainter {
  const RiderBikePainter({this.stale = false});

  final bool stale;

  @override
  void paint(Canvas canvas, Size size) {
    final s = size.shortestSide / kRiderBikeLogicalSize;
    canvas.save();
    canvas.translate((size.width - kRiderBikeLogicalSize * s) / 2, (size.height - kRiderBikeLogicalSize * s) / 2);
    canvas.scale(s);
    if (stale) {
      canvas.saveLayer(
        Offset.zero & const Size(kRiderBikeLogicalSize, kRiderBikeLogicalSize),
        Paint()..color = BlynkColors.paper.withValues(alpha: kRiderBikeStaleOpacity),
      );
    }

    const c = kRiderBikeLogicalSize / 2;
    final ink = Paint()..color = BlynkColors.ink;

    // A paper disc with a hairline ring: readable on any tile, light or dark.
    canvas.drawCircle(const Offset(c, c), 22, Paint()..color = BlynkColors.paper);
    canvas.drawCircle(
      const Offset(c, c),
      22,
      Paint()
        ..color = BlynkColors.lineStrong
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.5,
    );

    // A small chevron beyond the front wheel: the direction of travel.
    final nose = Path()
      ..moveTo(c, 3.5)
      ..lineTo(c - 4.5, 8.5)
      ..lineTo(c + 4.5, 8.5)
      ..close();
    canvas.drawPath(nose, ink);

    // Front and rear tyres.
    canvas.drawRRect(
      RRect.fromRectAndRadius(Rect.fromCenter(center: const Offset(c, 13.5), width: 5, height: 8), const Radius.circular(2.5)),
      ink,
    );
    canvas.drawRRect(
      RRect.fromRectAndRadius(Rect.fromCenter(center: const Offset(c, 36.5), width: 6, height: 9), const Radius.circular(3)),
      ink,
    );

    // The scooter's body, front to back.
    canvas.drawRRect(
      RRect.fromRectAndRadius(const Rect.fromLTRB(c - 5.5, 15, c + 5.5, 35), const Radius.circular(5)),
      Paint()..color = BlynkColors.ink2,
    );

    // Handlebar.
    canvas.drawLine(
      const Offset(c - 9, 17),
      const Offset(c + 9, 17),
      Paint()
        ..color = BlynkColors.ink
        ..strokeWidth = 3
        ..strokeCap = StrokeCap.round,
    );

    // The rider: shoulders, then a Blynk-yellow helmet on top.
    canvas.drawRRect(
      RRect.fromRectAndRadius(const Rect.fromLTRB(c - 8, 21, c + 8, 29), const Radius.circular(4)),
      ink,
    );
    canvas.drawCircle(const Offset(c, 24), 5, Paint()..color = BlynkColors.signal);
    canvas.drawCircle(
      const Offset(c, 24),
      5,
      Paint()
        ..color = BlynkColors.ink
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.5,
    );

    if (stale) canvas.restore();
    canvas.restore();
  }

  @override
  bool shouldRepaint(covariant RiderBikePainter oldDelegate) => oldDelegate.stale != stale;
}

/// The bike as a PNG, [pixelRatio] times the logical size, for the map SDKs
/// (both take marker / symbol images as encoded bytes).
Future<Uint8List> renderRiderBikePng({required double pixelRatio, bool stale = false}) async {
  final ratio = pixelRatio.isFinite && pixelRatio > 0 ? pixelRatio : 1.0;
  final pixels = (kRiderBikeLogicalSize * ratio).ceil();
  final recorder = ui.PictureRecorder();
  final canvas = Canvas(recorder);
  RiderBikePainter(stale: stale).paint(canvas, Size(pixels.toDouble(), pixels.toDouble()));
  final image = await recorder.endRecording().toImage(pixels, pixels);
  try {
    final data = await image.toByteData(format: ui.ImageByteFormat.png);
    if (data == null) throw StateError('rider icon encoding returned no data');
    return Uint8List.view(data.buffer, data.offsetInBytes, data.lengthInBytes);
  } finally {
    image.dispose();
  }
}

/// The bike as a widget, turned to [heading] (degrees clockwise from north).
class RiderBikeGlyph extends StatelessWidget {
  const RiderBikeGlyph({super.key, this.size = kRiderBikeLogicalSize, this.heading, this.stale = false});

  final double size;
  final double? heading;
  final bool stale;

  @override
  Widget build(BuildContext context) {
    return Transform.rotate(
      angle: (heading ?? 0) * math.pi / 180,
      child: SizedBox.square(
        dimension: size,
        child: CustomPaint(painter: RiderBikePainter(stale: stale)),
      ),
    );
  }
}
