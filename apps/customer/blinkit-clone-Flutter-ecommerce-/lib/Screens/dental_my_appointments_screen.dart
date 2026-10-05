import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../Models/dental_appointment_model.dart';
import '../Models/dental_format.dart';
import '../Models/dental_status_labels.dart';
import '../Services/Providers/dental.provider.dart';
import '../Services/app_errors.dart';
import '../UI/Widgets/Atoms/app_skeleton.dart';
import '../UI/Widgets/Atoms/app_state_views.dart';
import '../UI/Widgets/Atoms/failure_states.dart';
import '../UI/Widgets/Atoms/status_badge.dart';
import '../UI/Widgets/Organisms/dental_rating_section.dart';
import '../UI/Widgets/Organisms/dental_widgets.dart';
import '../app_responsive.dart';
import '../design/tokens.dart';

/// The customer's own appointments (task F4) - `user_orders_screen.dart`'s
/// pattern (pull-to-refresh, an empty state, a tap-through row) for a list
/// the backend already scopes to the signed-in customer (nothing here
/// filters "is this mine" - common.md rule 8, brief's explicit rule).
///
/// Bucketed Upcoming/Past by comparing each row's `start_at` against
/// [DentalProvider.now] (the provider's own injectable clock, never
/// `DateTime.now()` directly - task-F1-report.md's convention, required here
/// so the bucketing is deterministic under test). This mirrors exactly the
/// rule the backend's OWN `bucket` query param already uses
/// (`appointment.repository.ts`: `start_at >= now` is upcoming, `< now` is
/// past, ordered ascending/descending respectively) - applied client-side
/// here to one flat fetched list (`user_orders_screen.dart` has no bucket
/// tabs of its own to mirror; this is the same underlying rule the server
/// already defines, not an invented one) rather than round-tripping twice.
/// `isCompletedAt`'s "confirmed && start_at in the past" case is exactly the
/// Past bucket for a `CONFIRMED` row; every other status buckets the same
/// way, by date alone - a `HELD`/cancelled/expired row with a future
/// `start_at` still reads as Upcoming, since nothing about its status makes
/// "when" a different question.
class DentalMyAppointmentsScreen extends StatefulWidget {
  const DentalMyAppointmentsScreen({super.key});

  @override
  State<DentalMyAppointmentsScreen> createState() => _DentalMyAppointmentsScreenState();
}

enum _Bucket { upcoming, past }

class _DentalMyAppointmentsScreenState extends State<DentalMyAppointmentsScreen> {
  bool _loading = true;
  CustomerError? _failure;
  List<AppointmentModel> _appointments = const [];
  _Bucket _bucket = _Bucket.upcoming;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  Future<void> _load() async {
    if (!mounted) return;
    if (!_loading) setState(() => _loading = true);
    setState(() {
      _loading = true;
      _failure = null;
    });
    try {
      final appointments = await context.read<DentalProvider>().fetchMyAppointments(limit: 50);
      if (!mounted) return;
      setState(() {
        _appointments = appointments;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _failure = AppErrors.from(e);
        _loading = false;
      });
    }
  }

  /// Swaps in the server's rated copy of one appointment, so its row shows
  /// "Your rating" at once instead of the form.
  void _replace(AppointmentModel updated) {
    if (!mounted) return;
    setState(() {
      _appointments = [
        for (final appointment in _appointments) appointment.id == updated.id ? updated : appointment,
      ];
    });
  }

  void _selectBucket(_Bucket bucket) {
    if (bucket == _bucket) return;
    setState(() => _bucket = bucket);
  }

  /// A very-old fallback for the (never expected in practice) case of a
  /// `start_at` the server didn't send - keeps the sort total without
  /// crashing on a null comparison, and such a row always lands in Past
  /// (never Upcoming - see [_bucketed]).
  static final DateTime _epoch = DateTime.utc(1970);

  List<AppointmentModel> _bucketed(DateTime now) {
    final upcoming = <AppointmentModel>[];
    final past = <AppointmentModel>[];
    for (final appointment in _appointments) {
      final startAt = appointment.startAt;
      if (startAt != null && !startAt.isBefore(now)) {
        upcoming.add(appointment);
      } else {
        past.add(appointment);
      }
    }
    upcoming.sort((a, b) => (a.startAt ?? _epoch).compareTo(b.startAt ?? _epoch));
    past.sort((a, b) => (b.startAt ?? _epoch).compareTo(a.startAt ?? _epoch));
    return _bucket == _Bucket.upcoming ? upcoming : past;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: BlynkColors.paper,
      appBar: AppBar(title: const Text('My appointments')),
      body: ContentFrame(child: _body()),
    );
  }

  Widget _body() {
    if (_loading) {
      return SkeletonScope(
        child: ListView(
          key: const Key('appointments-skeleton'),
          padding: const EdgeInsets.symmetric(vertical: BlynkSpace.s16),
          children: const [
            AppSkeleton(height: 48, radius: BlynkRadius.md),
            SizedBox(height: BlynkSpace.s16),
            ListRowSkeleton(),
            ListRowSkeleton(),
            ListRowSkeleton(),
          ],
        ),
      );
    }

    final failure = _failure;
    if (failure != null && _appointments.isEmpty) {
      return FailureState(
        failure: failure,
        title: "We couldn't load your appointments",
        retryKey: const Key('appointments-retry'),
        onRetry: _load,
      );
    }

    final now = context.read<DentalProvider>().now;
    final rows = _bucketed(now);

    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.only(top: BlynkSpace.s16),
          child: _BucketToggle(selected: _bucket, onSelect: _selectBucket),
        ),
        Expanded(
          child: RefreshIndicator(
            onRefresh: _load,
            child: rows.isEmpty
                ? ListView(
                    physics: const AlwaysScrollableScrollPhysics(),
                    children: [
                      PullableState(
                        child: AppStateView.empty(
                          title: _bucket == _Bucket.upcoming
                              ? 'No upcoming appointments'
                              : 'No past appointments',
                          message: _bucket == _Bucket.upcoming
                              ? 'Book a visit to see it here.'
                              : null,
                        ),
                      ),
                    ],
                  )
                : ListView.separated(
                    key: Key('appointments-list-${_bucket.name}'),
                    physics: const AlwaysScrollableScrollPhysics(),
                    padding: const EdgeInsets.only(top: BlynkSpace.s16, bottom: BlynkSpace.s32),
                    itemCount: rows.length,
                    separatorBuilder: (_, __) => const SizedBox(height: BlynkSpace.s12),
                    itemBuilder: (context, index) {
                      final appointment = rows[index];
                      final row = _AppointmentRow(appointment: appointment, now: now);
                      if (!appointment.canRate && appointment.rating == null) return row;
                      // A finished visit: the row, then a compact "Rate your
                      // visit" card (the form opens in a sheet) or the
                      // rating already given.
                      return Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          row,
                          const SizedBox(height: BlynkSpace.s8),
                          DentalRatingCard(
                            key: Key('appointment-rating-${appointment.id}'),
                            appointment: appointment,
                            onRated: _replace,
                            compact: true,
                          ),
                        ],
                      );
                    },
                  ),
          ),
        ),
      ],
    );
  }
}

/// Upcoming / Past. Each segment is its own ≥48 dp target (pinned by
/// `touch_targets_test.dart`) and the selected one is a `paper` pill on the
/// `well` track - chrome that says where you are, not a second action.
class _BucketToggle extends StatelessWidget {
  const _BucketToggle({required this.selected, required this.onSelect});

  final _Bucket selected;
  final ValueChanged<_Bucket> onSelect;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: const BoxDecoration(
        color: BlynkColors.well,
        borderRadius: BlynkRadius.mdAll,
      ),
      child: Padding(
        padding: const EdgeInsets.all(BlynkSpace.s4),
        child: Row(
          children: [
            Expanded(child: _segment(context, _Bucket.upcoming, 'Upcoming')),
            Expanded(child: _segment(context, _Bucket.past, 'Past')),
          ],
        ),
      ),
    );
  }

  Widget _segment(BuildContext context, _Bucket bucket, String label) {
    final isSelected = bucket == selected;
    return Semantics(
      button: true,
      selected: isSelected,
      label: label,
      excludeSemantics: true,
      child: Material(
        type: MaterialType.transparency,
        borderRadius: BlynkRadius.mdAll,
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          key: Key('appt-tab-${bucket.name}'),
          onTap: () => onSelect(bucket),
          child: Container(
            constraints: const BoxConstraints(minHeight: BlynkControl.minHeight),
            alignment: Alignment.center,
            padding: const EdgeInsets.symmetric(
              horizontal: BlynkSpace.s12,
              vertical: BlynkSpace.s8,
            ),
            decoration: BoxDecoration(
              color: isSelected ? BlynkColors.paper : BlynkColors.clear,
              borderRadius: BlynkRadius.mdAll,
            ),
            child: Text(
              label,
              textAlign: TextAlign.center,
              style: BlynkText.body.copyWith(
                color: isSelected ? BlynkColors.ink : BlynkColors.ink2,
                fontWeight: isSelected ? FontWeight.w800 : FontWeight.w600,
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _AppointmentRow extends StatelessWidget {
  const _AppointmentRow({required this.appointment, required this.now});

  final AppointmentModel appointment;
  final DateTime now;

  @override
  Widget build(BuildContext context) {
    final doctor = appointment.doctor;
    final clinic = appointment.clinic;
    final startAt = appointment.startAt;
    // The real status model, through the same StatusBadge tones orders use.
    final badge = dentalAppointmentBadge(appointment, now);
    final dateLabel = startAt == null ? 'Time unavailable' : formatAppointmentDateTime(startAt);

    return DentalCard(
      key: Key('appointment-row-${appointment.id}'),
      semanticLabel: '${doctor?.fullName ?? 'Appointment'}, ${badge.label}, $dateLabel',
      onTap: () => Navigator.of(context)
          .pushNamed('/dental/appointments/detail', arguments: appointment.id),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const DentalGlyphTile(glyph: BlynkIcons.profile),
          const SizedBox(width: BlynkSpace.s12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Wrap(
                  crossAxisAlignment: WrapCrossAlignment.center,
                  spacing: BlynkSpace.s8,
                  runSpacing: BlynkSpace.s4,
                  children: [
                    Text(doctor?.fullName ?? 'Appointment', style: BlynkText.heading),
                    StatusBadge(tone: badge.tone, label: badge.label),
                  ],
                ),
                if (clinic != null) ...[
                  const SizedBox(height: BlynkSpace.s4),
                  Text(clinic.name, style: BlynkText.body.copyWith(color: BlynkColors.ink2)),
                ],
                const SizedBox(height: BlynkSpace.s4),
                Text(dateLabel, style: BlynkText.caption.copyWith(color: BlynkColors.ink3)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
