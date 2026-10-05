import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:ecom/Screens/dental_my_appointments_screen.dart';
import 'package:ecom/Services/Exceptions/api_exception.dart';
import 'package:ecom/Services/Providers/dental.provider.dart';
import 'package:ecom/UI/Widgets/Atoms/status_badge.dart';

import '../fixtures/dental_fixtures.dart';

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

/// Fixed "now" every test uses (matches `dental_slot_picker_screen_test.dart`'s
/// own convention: 2027-06-07T03:00:00Z), so bucketing is deterministic - a
/// test never depends on the real wall clock.
DateTime _testNow() => DateTime.utc(2027, 6, 7, 3, 0, 0);

const _listUrl = 'GET /dental/appointments';

/// One row of each of the 5 real backend statuses, plus two derived-display
/// cases (a `HELD` row whose hold has lazily expired, and a `CONFIRMED` row
/// whose start time has passed) - task-F4 brief's explicit "status badges
/// map correctly for all 5 states" requirement, plus the critical-rule-2
/// display-only expired-hold case.
List<Map<String, dynamic>> _fixtureAppointments() => [
      appointmentJson(
        id: 'a-upcoming-confirmed',
        status: 'CONFIRMED',
        startAt: '2027-06-08T03:30:00.000Z',
        detail: false,
      ),
      appointmentJson(
        id: 'a-past-confirmed',
        status: 'CONFIRMED',
        startAt: '2027-06-06T03:30:00.000Z',
        isCompleted: true,
        detail: false,
      ),
      appointmentJson(
        id: 'a-held-future',
        status: 'HELD',
        startAt: '2027-06-07T04:00:00.000Z',
        heldUntil: '2027-06-07T03:05:00.000Z',
        detail: false,
      ),
      appointmentJson(
        id: 'a-held-expired-display',
        status: 'HELD',
        startAt: '2027-06-07T05:00:00.000Z',
        heldUntil: '2027-06-07T02:00:00.000Z',
        detail: false,
      ),
      appointmentJson(
        id: 'a-cancelled-customer',
        status: 'CANCELLED_BY_CUSTOMER',
        startAt: '2027-06-09T03:30:00.000Z',
        detail: false,
      ),
      appointmentJson(
        id: 'a-cancelled-clinic',
        status: 'CANCELLED_BY_CLINIC',
        startAt: '2027-06-05T03:30:00.000Z',
        detail: false,
      ),
      appointmentJson(
        id: 'a-expired-raw',
        status: 'EXPIRED',
        startAt: '2027-06-04T03:30:00.000Z',
        detail: false,
      ),
    ];

void main() {
  late _FakeDentalApi api;
  late DentalProvider provider;
  late List<Object?> pushedRoutes;

  setUp(() {
    api = _FakeDentalApi();
    provider = DentalProvider(request: api.call, clock: _testNow);
    pushedRoutes = [];
  });

  Future<void> pumpScreen(WidgetTester tester) async {
    await tester.pumpWidget(
      ChangeNotifierProvider<DentalProvider>.value(
        value: provider,
        child: MaterialApp(
          home: const DentalMyAppointmentsScreen(),
          onGenerateRoute: (settings) {
            pushedRoutes.add(settings.arguments);
            return MaterialPageRoute(builder: (_) => Scaffold(body: Text('route:${settings.name}')));
          },
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  testWidgets('shows a skeleton while the first fetch is in flight', (tester) async {
    api.routes[_listUrl] = (q, b) => _envelope({'appointments': _fixtureAppointments(), 'pagination': {}});
    await tester.pumpWidget(
      ChangeNotifierProvider<DentalProvider>.value(
        value: provider,
        child: const MaterialApp(home: DentalMyAppointmentsScreen()),
      ),
    );
    expect(find.byKey(const Key('appointments-skeleton')), findsOneWidget);
    await tester.pumpAndSettle();
  });

  testWidgets('Upcoming tab shows only rows whose start_at has not yet passed, ascending', (tester) async {
    api.routes[_listUrl] = (q, b) => _envelope({'appointments': _fixtureAppointments(), 'pagination': {}});
    await pumpScreen(tester);

    expect(find.byKey(const Key('appointment-row-a-upcoming-confirmed')), findsOneWidget);
    expect(find.byKey(const Key('appointment-row-a-held-future')), findsOneWidget);
    expect(find.byKey(const Key('appointment-row-a-held-expired-display')), findsOneWidget);
    expect(find.byKey(const Key('appointment-row-a-cancelled-customer')), findsOneWidget);

    // Past-dated rows are absent from the Upcoming tab.
    expect(find.byKey(const Key('appointment-row-a-past-confirmed')), findsNothing);
    expect(find.byKey(const Key('appointment-row-a-cancelled-clinic')), findsNothing);
    expect(find.byKey(const Key('appointment-row-a-expired-raw')), findsNothing);
  });

  testWidgets('switching to the Past tab shows only rows whose start_at has already passed', (tester) async {
    api.routes[_listUrl] = (q, b) => _envelope({'appointments': _fixtureAppointments(), 'pagination': {}});
    await pumpScreen(tester);

    await tester.tap(find.byKey(const Key('appt-tab-past')));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('appointment-row-a-past-confirmed')), findsOneWidget);
    expect(find.byKey(const Key('appointment-row-a-cancelled-clinic')), findsOneWidget);
    expect(find.byKey(const Key('appointment-row-a-expired-raw')), findsOneWidget);

    expect(find.byKey(const Key('appointment-row-a-upcoming-confirmed')), findsNothing);
    expect(find.byKey(const Key('appointment-row-a-held-future')), findsNothing);
  });

  testWidgets('status badges map correctly for all 5 backend states, plus the derived display cases',
      (tester) async {
    api.routes[_listUrl] = (q, b) => _envelope({'appointments': _fixtureAppointments(), 'pagination': {}});
    await pumpScreen(tester);

    StatusBadge badgeIn(Key rowKey) =>
        tester.widget<StatusBadge>(find.descendant(of: find.byKey(rowKey), matching: find.byType(StatusBadge)));

    expect(badgeIn(const Key('appointment-row-a-upcoming-confirmed')).label, 'Confirmed');
    expect(badgeIn(const Key('appointment-row-a-upcoming-confirmed')).tone, BadgeTone.positive);
    expect(badgeIn(const Key('appointment-row-a-held-future')).label, 'Reserved');
    expect(badgeIn(const Key('appointment-row-a-held-future')).tone, BadgeTone.notice);
    // Display-only: a HELD row whose held_until has lazily elapsed reads as
    // "Expired", though its real backend status is still 'HELD'.
    expect(badgeIn(const Key('appointment-row-a-held-expired-display')).label, 'Expired');
    expect(badgeIn(const Key('appointment-row-a-held-expired-display')).tone, BadgeTone.neutral);
    expect(badgeIn(const Key('appointment-row-a-cancelled-customer')).label, 'Cancelled');
    expect(badgeIn(const Key('appointment-row-a-cancelled-customer')).tone, BadgeTone.neutral);

    await tester.tap(find.byKey(const Key('appt-tab-past')));
    await tester.pumpAndSettle();

    // A CONFIRMED row with a past start_at reads as "Completed".
    expect(badgeIn(const Key('appointment-row-a-past-confirmed')).label, 'Completed');
    expect(badgeIn(const Key('appointment-row-a-cancelled-clinic')).label, 'Cancelled by clinic');
    expect(badgeIn(const Key('appointment-row-a-cancelled-clinic')).tone, BadgeTone.problem);
    expect(badgeIn(const Key('appointment-row-a-expired-raw')).label, 'Expired');
    expect(badgeIn(const Key('appointment-row-a-expired-raw')).tone, BadgeTone.neutral);
  });

  testWidgets('tapping a row navigates to the appointment detail route with the bare id argument',
      (tester) async {
    api.routes[_listUrl] = (q, b) => _envelope({'appointments': _fixtureAppointments(), 'pagination': {}});
    await pumpScreen(tester);

    await tester.tap(find.byKey(const Key('appointment-row-a-upcoming-confirmed')));
    await tester.pumpAndSettle();

    expect(pushedRoutes, contains('a-upcoming-confirmed'));
  });

  testWidgets('empty Upcoming state, no appointments at all', (tester) async {
    api.routes[_listUrl] = (q, b) => _envelope({'appointments': <Object>[], 'pagination': {}});
    await pumpScreen(tester);
    expect(find.text('No upcoming appointments'), findsOneWidget);
  });

  testWidgets('empty Past state, only upcoming appointments exist', (tester) async {
    api.routes[_listUrl] = (q, b) => _envelope({
          'appointments': [
            appointmentJson(id: 'a1', status: 'CONFIRMED', startAt: '2027-06-08T03:30:00.000Z', detail: false),
          ],
          'pagination': {},
        });
    await pumpScreen(tester);

    await tester.tap(find.byKey(const Key('appt-tab-past')));
    await tester.pumpAndSettle();

    expect(find.text('No past appointments'), findsOneWidget);
  });

  testWidgets('a load failure shows a retryable error, not a raw exception', (tester) async {
    api.routes[_listUrl] = (q, b) => ApiException(500, 'boom');
    await pumpScreen(tester);

    expect(find.byKey(const Key('appointments-retry')), findsOneWidget);
    expect(find.textContaining('boom'), findsNothing);

    api.routes[_listUrl] = (q, b) => _envelope({'appointments': _fixtureAppointments(), 'pagination': {}});
    await tester.tap(find.byKey(const Key('appointments-retry')));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('appointment-row-a-upcoming-confirmed')), findsOneWidget);
  });

  testWidgets('never filters client-side beyond what the backend already returned', (tester) async {
    // Even an appointment shape that looks "off" (no doctor/clinic block) is
    // still shown as-is - ownership/filtering is entirely the backend's job
    // (brief's explicit rule); this screen never second-guesses the list.
    api.routes[_listUrl] = (q, b) => _envelope({
          'appointments': [
            {
              'id': 'a-bare',
              'clinic_doctor_id': 'cd1',
              'start_at': '2027-06-08T03:30:00.000Z',
              'end_at': '2027-06-08T04:00:00.000Z',
              'status': 'CONFIRMED',
              'held_until': null,
              'consultation_fee_snapshot': 3500,
              'is_completed': false,
              'can_cancel': true,
            },
          ],
          'pagination': {},
        });
    await pumpScreen(tester);
    expect(find.byKey(const Key('appointment-row-a-bare')), findsOneWidget);
  });

  group('rate your visit', () {
    List<Map<String, dynamic>> ratingRows() => [
          appointmentJson(
            id: 'a-rateable',
            status: 'CONFIRMED',
            startAt: '2027-06-06T03:30:00.000Z',
            canRate: true,
            detail: false,
          ),
          appointmentJson(
            id: 'a-rated',
            status: 'CONFIRMED',
            startAt: '2027-06-05T03:30:00.000Z',
            rating: ratingJson(stars: 3, comment: 'Fine overall.'),
            detail: false,
          ),
          appointmentJson(
            id: 'a-not-rateable',
            status: 'CANCELLED_BY_CLINIC',
            startAt: '2027-06-04T03:30:00.000Z',
            detail: false,
          ),
        ];

    testWidgets('only a can_rate row gets the "Rate your visit" card; a rated row shows its rating', (tester) async {
      api.routes[_listUrl] = (q, b) => _envelope({'appointments': ratingRows()});
      await pumpScreen(tester);
      await tester.tap(find.byKey(const Key('appt-tab-past')));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('rate-visit-a-rateable')), findsOneWidget);
      expect(find.byKey(const Key('appointment-rating-a-rateable')), findsOneWidget);
      expect(find.byKey(const Key('appointment-rating-a-not-rateable')), findsNothing);
      expect(find.byKey(const Key('rate-visit-a-rated')), findsNothing);
      expect(find.text('Your rating'), findsOneWidget);
      expect(find.text('Fine overall.'), findsOneWidget);
    });

    testWidgets('no rating card on a fixture with no can_rate rows', (tester) async {
      api.routes[_listUrl] = (q, b) => _envelope({'appointments': _fixtureAppointments()});
      await pumpScreen(tester);
      await tester.tap(find.byKey(const Key('appt-tab-past')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('dental-rating-card')), findsNothing);
      expect(find.text('Rate your visit'), findsNothing);
    });

    testWidgets('rating from the list opens the form in a sheet and the row then shows "Your rating"',
        (tester) async {
      api.routes[_listUrl] = (q, b) => _envelope({'appointments': ratingRows().take(1).toList()});
      api.routes['POST /dental/appointments/a-rateable/rating'] = (q, b) => _envelope({
            'rating': ratingJson(stars: 5, comment: null),
            'appointment': appointmentJson(
              id: 'a-rateable',
              status: 'CONFIRMED',
              startAt: '2027-06-06T03:30:00.000Z',
              rating: ratingJson(stars: 5, comment: null),
            ),
          });
      await pumpScreen(tester);
      await tester.tap(find.byKey(const Key('appt-tab-past')));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('rate-visit-a-rateable')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('rating-star-5')));
      await tester.pump();
      await tester.tap(find.byKey(const Key('submit-rating')));
      await tester.pumpAndSettle();

      expect(api.calls.last['body'], {'stars': 5});
      expect(find.byKey(const Key('submit-rating')), findsNothing);
      expect(find.byKey(const Key('rate-visit-a-rateable')), findsNothing);
      expect(find.text('Your rating'), findsOneWidget);
    });
  });
}
