import 'package:flutter_test/flutter_test.dart';
import 'package:ecom/Models/rider_location_model.dart';

Map<String, dynamic> eventJson({Map<String, dynamic> override = const {}, List<String> without = const []}) {
  final m = <String, dynamic>{
    'latitude': 6.44,
    'longitude': 80.03,
    'accuracy': 8.5,
    'captured_at': '2026-09-19T10:00:00.000Z',
    'received_at': '2026-09-19T10:00:01.000Z',
    ...override,
  };
  for (final k in without) {
    m.remove(k);
  }
  return m;
}

void main() {
  group('RiderLocationPoint', () {
    test('parses a well-formed SSE location event', () {
      final p = RiderLocationPoint.tryParse({
        'latitude': 6.44, 'longitude': 80.03, 'accuracy': 8.5,
        'captured_at': '2026-09-19T10:00:00.000Z', 'received_at': '2026-09-19T10:00:01.000Z',
      })!;
      expect(p.latitude, 6.44);
      expect(p.longitude, 80.03);
      expect(p.accuracy, 8.5);
      expect(p.capturedAt, DateTime.utc(2026, 9, 19, 10, 0, 0));
      expect(p.receivedAt, DateTime.utc(2026, 9, 19, 10, 0, 1));
    });

    test('malformed payloads parse as null, never a fabricated point', () {
      expect(RiderLocationPoint.tryParse({'latitude': 6.44}), isNull);
      expect(RiderLocationPoint.tryParse(null), isNull);
      expect(RiderLocationPoint.tryParse('not a map'), isNull);
    });

    test('non-map input parses as null', () {
      for (final bad in <Object?>[null, 'x', 42, 4.2, true, <Object?>[], [eventJson()]]) {
        expect(RiderLocationPoint.tryParse(bad), isNull, reason: '$bad');
      }
    });

    test('an empty map parses as null', () {
      expect(RiderLocationPoint.tryParse(<String, dynamic>{}), isNull);
    });

    test('a JSON-decoded Map<dynamic, dynamic> is accepted', () {
      final p = RiderLocationPoint.tryParse(<dynamic, dynamic>{...eventJson()});
      expect(p, isNotNull);
      expect(p!.latitude, 6.44);
    });

    test('each missing required field yields null', () {
      for (final k in ['latitude', 'longitude', 'captured_at', 'received_at']) {
        expect(RiderLocationPoint.tryParse(eventJson(without: [k])), isNull, reason: 'missing $k');
      }
    });

    test('each null required field yields null', () {
      for (final k in ['latitude', 'longitude', 'captured_at', 'received_at']) {
        expect(RiderLocationPoint.tryParse(eventJson(override: {k: null})), isNull, reason: 'null $k');
      }
    });

    test('each unparseable coordinate yields null', () {
      for (final k in ['latitude', 'longitude']) {
        for (final bad in <Object>['abc', '', '  ', true, <int>[1]]) {
          expect(RiderLocationPoint.tryParse(eventJson(override: {k: bad})), isNull, reason: '$k=$bad');
        }
      }
    });

    test('unparseable dates yield null', () {
      for (final k in ['captured_at', 'received_at']) {
        for (final bad in <Object>['not-a-date', '', 'yesterday', '2026-13-45T99:00:00Z', '2026-13-01T10:00:00Z', '2026-02-30T10:00:00Z', '2026-09-19T24:00:00Z', '2026-09-19T10:60:00Z', '2026-09-19', true]) {
          expect(RiderLocationPoint.tryParse(eventJson(override: {k: bad})), isNull, reason: '$k=$bad');
        }
      }
    });

    test('a valid leap day and an offset-suffixed timestamp parse', () {
      final p = RiderLocationPoint.tryParse(eventJson(override: {
        'captured_at': '2028-02-29T10:00:00.000Z', 'received_at': '2026-09-19T15:30:01.000+05:30',
      }))!;
      expect(p.capturedAt, DateTime.utc(2028, 2, 29, 10));
      expect(p.receivedAt, DateTime.utc(2026, 9, 19, 10, 0, 1));
    });

    test('numeric strings are tolerated (numbers may arrive as strings)', () {
      final p = RiderLocationPoint.tryParse(eventJson(override: {'latitude': '6.44', 'longitude': '80.03', 'accuracy': '8.5'}))!;
      expect(p.latitude, 6.44);
      expect(p.longitude, 80.03);
      expect(p.accuracy, 8.5);
    });

    test('integer JSON numbers parse as doubles', () {
      final p = RiderLocationPoint.tryParse(eventJson(override: {'latitude': 6, 'longitude': 80, 'accuracy': 10}))!;
      expect(p.latitude, 6.0);
      expect(p.longitude, 80.0);
      expect(p.accuracy, 10.0);
    });

    test('NaN and Infinity in a coordinate yield null', () {
      for (final k in ['latitude', 'longitude']) {
        for (final bad in <Object>[double.nan, double.infinity, double.negativeInfinity, 'NaN', 'Infinity', '-Infinity']) {
          expect(RiderLocationPoint.tryParse(eventJson(override: {k: bad})), isNull, reason: '$k=$bad');
        }
      }
    });

    test('latitude out of [-90, 90] yields null; the bounds themselves are valid', () {
      expect(RiderLocationPoint.tryParse(eventJson(override: {'latitude': 90.0001})), isNull);
      expect(RiderLocationPoint.tryParse(eventJson(override: {'latitude': -90.0001})), isNull);
      expect(RiderLocationPoint.tryParse(eventJson(override: {'latitude': 91})), isNull);
      expect(RiderLocationPoint.tryParse(eventJson(override: {'latitude': 90}))!.latitude, 90.0);
      expect(RiderLocationPoint.tryParse(eventJson(override: {'latitude': -90}))!.latitude, -90.0);
    });

    test('longitude out of [-180, 180] yields null; the bounds themselves are valid', () {
      expect(RiderLocationPoint.tryParse(eventJson(override: {'longitude': 180.0001})), isNull);
      expect(RiderLocationPoint.tryParse(eventJson(override: {'longitude': -180.0001})), isNull);
      expect(RiderLocationPoint.tryParse(eventJson(override: {'longitude': 181})), isNull);
      expect(RiderLocationPoint.tryParse(eventJson(override: {'longitude': 180}))!.longitude, 180.0);
      expect(RiderLocationPoint.tryParse(eventJson(override: {'longitude': -180}))!.longitude, -180.0);
    });

    test('a coordinate of exactly 0 is a valid point, not a missing one', () {
      final p = RiderLocationPoint.tryParse(eventJson(override: {'latitude': 0, 'longitude': 0}))!;
      expect(p.latitude, 0.0);
      expect(p.longitude, 0.0);
    });

    test('accuracy is optional: missing, null, invalid or not above 0 keeps the point with accuracy unknown', () {
      for (final bad in <Object?>[null, 0, 0.0, -1, '-0.5', 'abc', double.nan, double.infinity]) {
        final p = RiderLocationPoint.tryParse(eventJson(override: {'accuracy': bad}));
        expect(p, isNotNull, reason: 'accuracy=$bad');
        expect(p!.accuracy, isNull, reason: 'accuracy=$bad');
        expect(p.latitude, 6.44);
      }
      final missing = RiderLocationPoint.tryParse(eventJson(without: ['accuracy']));
      expect(missing, isNotNull);
      expect(missing!.accuracy, isNull);
      expect(RiderLocationPoint.tryParse(eventJson(override: {'accuracy': 0.1}))!.accuracy, 0.1);
    });
  });

  group('classifyFreshness', () {
    final now = DateTime.utc(2026, 9, 19, 10, 0, 20);
    test('LIVE within the live window', () {
      expect(classifyFreshness(DateTime.utc(2026, 9, 19, 10, 0, 5), now: now), LocationFreshness.live);
    });
    test('STALE beyond live but within the stale ceiling', () {
      expect(classifyFreshness(now.subtract(const Duration(seconds: 40)), now: now), LocationFreshness.stale);
    });
    test('OFFLINE beyond the stale ceiling', () {
      expect(classifyFreshness(now.subtract(const Duration(minutes: 5)), now: now), LocationFreshness.offline);
    });

    test('an age of zero is LIVE', () {
      expect(classifyFreshness(now, now: now), LocationFreshness.live);
    });
    test('boundary: exactly 18 s is LIVE (inclusive)', () {
      expect(classifyFreshness(now.subtract(const Duration(seconds: 18)), now: now), LocationFreshness.live);
    });
    test('boundary: 18 s + 1 ms is STALE', () {
      expect(classifyFreshness(now.subtract(const Duration(seconds: 18, milliseconds: 1)), now: now), LocationFreshness.stale);
    });
    test('boundary: exactly 2 min is STALE (inclusive)', () {
      expect(classifyFreshness(now.subtract(const Duration(minutes: 2)), now: now), LocationFreshness.stale);
    });
    test('boundary: 2 min + 1 ms is OFFLINE', () {
      expect(classifyFreshness(now.subtract(const Duration(minutes: 2, milliseconds: 1)), now: now), LocationFreshness.offline);
    });
    test('a capturedAt in the future (clock skew) does not throw and is LIVE', () {
      expect(classifyFreshness(now.add(const Duration(seconds: 5)), now: now), LocationFreshness.live);
      expect(classifyFreshness(now.add(const Duration(days: 365)), now: now), LocationFreshness.live);
    });
    test('compares instants, not zones: a local-zone capturedAt classifies the same', () {
      final localCaptured = now.subtract(const Duration(seconds: 40)).toLocal();
      expect(classifyFreshness(localCaptured, now: now), LocationFreshness.stale);
    });
    test('defaults now to the current time when omitted', () {
      expect(classifyFreshness(DateTime.now().toUtc()), LocationFreshness.live);
      expect(classifyFreshness(DateTime.now().toUtc().subtract(const Duration(minutes: 10))), LocationFreshness.offline);
    });
  });
}
