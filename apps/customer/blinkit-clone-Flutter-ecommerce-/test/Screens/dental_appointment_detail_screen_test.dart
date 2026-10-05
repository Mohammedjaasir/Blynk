import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:ecom/Screens/dental_appointment_detail_screen.dart';
import 'package:ecom/Services/Exceptions/api_exception.dart';
import 'package:ecom/Services/Providers/dental.provider.dart';
import 'package:ecom/UI/Widgets/Atoms/money_text.dart';
import 'package:ecom/UI/Widgets/Atoms/status_badge.dart';

import '../fixtures/dental_fixtures.dart';
import '../fixtures/tracking_fakes.dart';

/// `dental_provider_test.dart`'s `_FakeDentalApi` pattern, duplicated per
/// this codebase's own convention (task-F3-report.md).
class _FakeDentalApi {
  final calls = <Map<String, dynamic>>[];
  final Map<String, Object Function(Map<String, dynamic>? query, Object? body)> routes = {};

  Future<dynamic> call(String method, String url, {Object? body, Map<String, dynamic>? query}) async {
    final key = '$method $url';
    calls.add({'key': key, 'query': query, 'body': body});
    final r = routes[key];
    if (r == null) throw ApiException(404, 'No route registered for $key.', code: 'NOT_FOUND');
    final v = r(query, body);
    if (v is ApiException) throw v;
    return v;
  }
}

Map<String, dynamic> _envelope(Object? data) => {'success': true, 'data': data};

DateTime _testNow() => DateTime.utc(2027, 6, 7, 3, 0, 0);

const _appointmentId = 'a0000001-0000-0000-0000-000000000001';
const _clinicId = 'c0000001-0000-0000-0000-000000000001';
const _detailUrl = 'GET /dental/appointments/$_appointmentId';
const _clinicUrl = 'GET /dental/clinics/$_clinicId';
const _cancelUrl = 'POST /dental/appointments/$_appointmentId/cancel';

void main() {
  late _FakeDentalApi api;
  late DentalProvider provider;

  setUp(() {
    api = _FakeDentalApi();
    provider = DentalProvider(request: api.call, clock: _testNow);
    // Registered for every test: the detail screen always tries to resolve
    // the clinic's lat/lng for the map (task-F4 brief: "fetch the clinic
    // detail if the appointment response doesn't already embed lat/lng") -
    // a missing/failed route here is non-fatal (caught, map just doesn't
    // render), so tests that don't care about the map don't need to touch
    // this, but registering it once keeps every test's appointment detail
    // free of an unrelated logged 404.
    api.routes[_clinicUrl] = (q, b) => _envelope({'clinic': clinicJson(id: _clinicId)});
  });

  Future<void> pumpScreen(WidgetTester tester) async {
    // Tall enough that every section (badge, cards, the 200px map, the
    // cancel section) is actually built and laid out without scrolling -
    // otherwise content this far down a ListView is never built at all at
    // the default 800x600 test surface (not just "offstage" - genuinely
    // outside the sliver's cache extent).
    tester.view.physicalSize = const Size(1200, 2600);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      ChangeNotifierProvider<DentalProvider>.value(
        value: provider,
        child: const MaterialApp(
          home: DentalAppointmentDetailScreen(
            appointmentId: _appointmentId,
            mapBuilder: fakeMapBuilder,
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  testWidgets('renders the full appointment info: doctor, clinic, date/time, fee, patient, map', (tester) async {
    api.routes[_detailUrl] = (q, b) => _envelope({'appointment': appointmentJson(status: 'CONFIRMED')});
    await pumpScreen(tester);

    expect(find.text('Dr. Nadeesha Perera'), findsOneWidget);
    expect(find.text('Smile Dental Clinic'), findsOneWidget);
    expect(find.byType(MoneyText), findsOneWidget);
    expect(tester.widget<MoneyText>(find.byType(MoneyText)).amount, 3500);
    expect(find.text('Jane Silva'), findsOneWidget);
    expect(find.text('+94771234567'), findsOneWidget);
    expect(find.textContaining('Sensitive to cold water'), findsOneWidget);
    expect(find.byKey(const Key('appointment-status-badge')), findsOneWidget);
    expect(find.byKey(const Key('appointment-map-frame')), findsOneWidget);
  });

  testWidgets('shows the cancel section for a CONFIRMED appointment', (tester) async {
    api.routes[_detailUrl] = (q, b) => _envelope({'appointment': appointmentJson(status: 'CONFIRMED')});
    await pumpScreen(tester);
    expect(find.byKey(const Key('dental-cancel-section')), findsOneWidget);
  });

  testWidgets('hides the cancel section for HELD', (tester) async {
    api.routes[_detailUrl] = (q, b) => _envelope({
          'appointment': appointmentJson(status: 'HELD', heldUntil: '2027-06-07T03:05:00.000Z'),
        });
    await pumpScreen(tester);
    expect(find.byKey(const Key('dental-cancel-section')), findsNothing);
  });

  testWidgets('hides the cancel section for EXPIRED', (tester) async {
    api.routes[_detailUrl] = (q, b) => _envelope({'appointment': appointmentJson(status: 'EXPIRED')});
    await pumpScreen(tester);
    expect(find.byKey(const Key('dental-cancel-section')), findsNothing);
  });

  testWidgets('hides the cancel section for CANCELLED_BY_CUSTOMER', (tester) async {
    api.routes[_detailUrl] = (q, b) => _envelope({'appointment': appointmentJson(status: 'CANCELLED_BY_CUSTOMER')});
    await pumpScreen(tester);
    expect(find.byKey(const Key('dental-cancel-section')), findsNothing);
  });

  testWidgets('hides the cancel section for CANCELLED_BY_CLINIC', (tester) async {
    api.routes[_detailUrl] = (q, b) => _envelope({'appointment': appointmentJson(status: 'CANCELLED_BY_CLINIC')});
    await pumpScreen(tester);
    expect(find.byKey(const Key('dental-cancel-section')), findsNothing);
  });

  testWidgets('never shows any deadline/cutoff/countdown copy anywhere on this screen', (tester) async {
    api.routes[_detailUrl] = (q, b) => _envelope({'appointment': appointmentJson(status: 'CONFIRMED')});
    await pumpScreen(tester);

    expect(find.textContaining('cancel by', skipOffstage: false), findsNothing);
    expect(find.textContaining('until', skipOffstage: false), findsNothing);
    expect(find.textContaining('deadline', skipOffstage: false), findsNothing);
    expect(find.textContaining('hours left', skipOffstage: false), findsNothing);
  });

  testWidgets('a successful cancel refetches and shows the updated CANCELLED_BY_CUSTOMER status', (tester) async {
    var detailCalls = 0;
    api.routes[_detailUrl] = (q, b) {
      detailCalls++;
      final status = detailCalls == 1 ? 'CONFIRMED' : 'CANCELLED_BY_CUSTOMER';
      return _envelope({'appointment': appointmentJson(status: status)});
    };
    api.routes[_cancelUrl] = (q, b) => _envelope({'appointment': appointmentJson(status: 'CANCELLED_BY_CUSTOMER')});

    await pumpScreen(tester);
    expect(
      tester.widget<StatusBadge>(find.byKey(const Key('appointment-status-badge'))).label,
      'Confirmed',
    );
    expect(find.byKey(const Key('dental-cancel-section')), findsOneWidget);

    await tester.tap(find.byKey(const Key('cancel-appointment-button')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('confirm-cancel-appointment')));
    await tester.pumpAndSettle();

    expect(
      tester.widget<StatusBadge>(find.byKey(const Key('appointment-status-badge'))).label,
      'Cancelled',
    );
    // Cancel section is gone now that status is no longer CONFIRMED.
    expect(find.byKey(const Key('dental-cancel-section')), findsNothing);

    final sentBody = api.calls.firstWhere((c) => c['key'] == _cancelUrl)['body'];
    expect(sentBody, isNull, reason: 'no reason was entered, so the body is omitted entirely');
  });

  testWidgets('the reason field, when filled in, is sent as {reason} on cancel', (tester) async {
    api.routes[_detailUrl] = (q, b) => _envelope({'appointment': appointmentJson(status: 'CONFIRMED')});
    api.routes[_cancelUrl] = (q, b) => _envelope({'appointment': appointmentJson(status: 'CANCELLED_BY_CUSTOMER')});

    await pumpScreen(tester);
    await tester.enterText(find.byKey(const Key('cancel-reason-field')), 'Feeling better now.');
    await tester.tap(find.byKey(const Key('cancel-appointment-button')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('confirm-cancel-appointment')));
    await tester.pumpAndSettle();

    final sentBody = api.calls.firstWhere((c) => c['key'] == _cancelUrl)['body'] as Map;
    expect(sentBody['reason'], 'Feeling better now.');
  });

  testWidgets('a cancel race (409 already cancelled) shows the real backend message, never a false success',
      (tester) async {
    var detailCalls = 0;
    api.routes[_detailUrl] = (q, b) {
      detailCalls++;
      // Someone else (the clinic, or a second device) cancelled it first -
      // the refetch after the refusal must show that real, current state.
      final status = detailCalls == 1 ? 'CONFIRMED' : 'CANCELLED_BY_CUSTOMER';
      return _envelope({'appointment': appointmentJson(status: status)});
    };
    api.routes[_cancelUrl] =
        (q, b) => ApiException(409, 'Already cancelled.', code: 'APPOINTMENT_ALREADY_CANCELLED');

    await pumpScreen(tester);
    await tester.tap(find.byKey(const Key('cancel-appointment-button')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('confirm-cancel-appointment')));

    // Deliberately NOT pumpAndSettle here: the SnackBar auto-dismisses after
    // a few real seconds, and pumpAndSettle would drive virtual time past
    // that before this assertion ever ran. A handful of bare `pump()`s
    // (no duration - timers do not advance) is enough to flush the cancel
    // call, the SnackBar's own entrance and the refetch's two network calls.
    await tester.pump();
    await tester.pump();
    await tester.pump();
    await tester.pump();
    await tester.pump();

    expect(find.text('This appointment is already cancelled.'), findsOneWidget);
    // The real, current state after the refetch - never a false "cancelled
    // by me just now" read, and never a stale re-enabled button either.
    expect(
      tester.widget<StatusBadge>(find.byKey(const Key('appointment-status-badge'))).label,
      'Cancelled',
    );
    expect(find.byKey(const Key('dental-cancel-section')), findsNothing);
  });

  testWidgets('a 404 (not found or not owned) shows the not-found state, not a raw error', (tester) async {
    api.routes[_detailUrl] = (q, b) => ApiException(404, 'Not found.', code: 'APPOINTMENT_NOT_FOUND');
    await pumpScreen(tester);

    expect(find.text('Appointment not found'), findsOneWidget);
    expect(find.textContaining('APPOINTMENT_NOT_FOUND'), findsNothing);
  });

  testWidgets('a generic load failure shows a retryable error', (tester) async {
    api.routes[_detailUrl] = (q, b) => ApiException(500, 'boom');
    await pumpScreen(tester);

    expect(find.byKey(const Key('appointment-detail-retry')), findsOneWidget);

    api.routes[_detailUrl] = (q, b) => _envelope({'appointment': appointmentJson(status: 'CONFIRMED')});
    await tester.tap(find.byKey(const Key('appointment-detail-retry')));
    await tester.pumpAndSettle();

    expect(find.text('Dr. Nadeesha Perera'), findsOneWidget);
  });

  group('rate your visit', () {
    const rateUrl = 'POST /dental/appointments/$_appointmentId/rating';

    testWidgets('no rating card when the backend says can_rate is false and there is no rating', (tester) async {
      api.routes[_detailUrl] = (q, b) => _envelope({'appointment': appointmentJson(status: 'CONFIRMED')});
      await pumpScreen(tester);
      expect(find.byKey(const Key('dental-rating-card')), findsNothing);
      expect(find.text('Your rating'), findsNothing);
    });

    testWidgets('select stars, type a comment, submit: the body is right and "Your rating" replaces the form',
        (tester) async {
      api.routes[_detailUrl] =
          (q, b) => _envelope({'appointment': appointmentJson(status: 'CONFIRMED', canRate: true)});
      api.routes[rateUrl] = (q, b) => _envelope({
            'rating': ratingJson(stars: 4, comment: 'Very gentle.'),
            'appointment': appointmentJson(status: 'CONFIRMED', rating: ratingJson(stars: 4, comment: 'Very gentle.')),
          });
      await pumpScreen(tester);

      expect(find.byKey(const Key('dental-rating-card')), findsOneWidget);
      // Submit is disabled until a star is chosen.
      await tester.tap(find.byKey(const Key('submit-rating')));
      await tester.pump();
      expect(api.calls.where((c) => c['key'] == rateUrl), isEmpty);

      expect(find.bySemanticsLabel('1 star'), findsOneWidget);
      expect(find.bySemanticsLabel('3 stars'), findsOneWidget);
      expect(tester.getSize(find.byKey(const Key('rating-star-1'))), const Size(48, 48));

      await tester.tap(find.byKey(const Key('rating-star-4')));
      await tester.pump();
      await tester.enterText(find.byKey(const Key('rating-comment-field')), '  Very gentle.  ');
      await tester.pump();
      expect(find.text('16 / 500'), findsOneWidget);

      await tester.tap(find.byKey(const Key('submit-rating')));
      await tester.pumpAndSettle();

      final sent = api.calls.singleWhere((c) => c['key'] == rateUrl)['body'];
      expect(sent, {'stars': 4, 'comment': 'Very gentle.'});
      expect(find.byKey(const Key('dental-rating-card')), findsNothing);
      expect(find.byKey(const Key('your-rating')), findsOneWidget);
      expect(find.text('Your rating'), findsOneWidget);
      expect(find.text('Very gentle.'), findsOneWidget);
      expect(find.bySemanticsLabel('Rated 4 out of 5 stars'), findsOneWidget);
    });

    testWidgets('a refusal shows the server message and keeps the form', (tester) async {
      api.routes[_detailUrl] =
          (q, b) => _envelope({'appointment': appointmentJson(status: 'CONFIRMED', canRate: true)});
      api.routes[rateUrl] =
          (q, b) => ApiException(422, 'You can rate this visit once it is over.', code: 'VISIT_NOT_FINISHED');
      await pumpScreen(tester);

      await tester.tap(find.byKey(const Key('rating-star-2')));
      await tester.pump();
      await tester.tap(find.byKey(const Key('submit-rating')));
      await tester.pumpAndSettle();

      expect(find.text('You can rate this visit once it is over.'), findsOneWidget);
      expect(find.byKey(const Key('dental-rating-card')), findsOneWidget);
      expect(find.text('Your rating'), findsNothing);
    });

    testWidgets('an already-rated appointment shows the rating, never the form', (tester) async {
      api.routes[_detailUrl] = (q, b) => _envelope({
            'appointment': appointmentJson(status: 'CONFIRMED', rating: ratingJson(stars: 5, comment: null)),
          });
      await pumpScreen(tester);
      expect(find.byKey(const Key('your-rating')), findsOneWidget);
      expect(find.byKey(const Key('submit-rating')), findsNothing);
    });
  });
}
