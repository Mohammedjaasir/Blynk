import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../Models/dental_appointment_model.dart';
import '../Models/dental_clinic_model.dart';
import '../Models/dental_doctor_model.dart';
import '../Models/dental_format.dart';
import '../Models/dental_status_labels.dart';
import '../Services/Providers/dental.provider.dart';
import '../Services/app_errors.dart';
import '../UI/Widgets/Atoms/app_skeleton.dart';
import '../UI/Widgets/Atoms/app_state_views.dart';
import '../UI/Widgets/Atoms/failure_states.dart';
import '../UI/Widgets/Atoms/money_text.dart';
import '../UI/Widgets/Atoms/status_badge.dart';
import '../UI/Widgets/Organisms/clinic_location_map.dart';
import '../UI/Widgets/Organisms/dental_cancel_section.dart';
import '../UI/Widgets/Organisms/dental_rating_section.dart';
import '../UI/Widgets/Organisms/dental_widgets.dart';
import '../UI/Widgets/Organisms/map_provider.dart';
import '../app_responsive.dart';
import '../design/tokens.dart';

/// One appointment, everything the backend knows about it (task F4) -
/// `order_summary_screen.dart`'s detail-screen shape: an `AppStateView` for
/// every loading/error/not-found case, a status badge, then the facts, then
/// (only when the backend's status genuinely allows it) a cancel section.
///
/// A `404` here means "not found OR not owned" - the exact same body either
/// way (task-B3-report.md §7 IDOR, task-F1-report.md's
/// `fetchAppointmentDetail` doc comment) - shown as `AppStateView.notFound`,
/// never a raw error (brief's explicit rule).
class DentalAppointmentDetailScreen extends StatefulWidget {
  const DentalAppointmentDetailScreen({super.key, required this.appointmentId, this.mapBuilder});

  final String appointmentId;

  /// Test seam forwarded to `ClinicLocationMap` - `DentalClinicDetailScreen
  /// .mapBuilder`'s exact convention. Production callers leave it null and
  /// get the real map.
  final TrackingMapBuilder? mapBuilder;

  @override
  State<DentalAppointmentDetailScreen> createState() => _DentalAppointmentDetailScreenState();
}

class _DentalAppointmentDetailScreenState extends State<DentalAppointmentDetailScreen> {
  AppointmentModel? _appointment;

  /// Fetched separately, purely for its `latitude`/`longitude` -
  /// `AppointmentClinicSummary` (the block embedded in the appointment
  /// response) never carries them (task-F1-report.md's model shape). A
  /// failure fetching this is never fatal to the rest of the screen: the map
  /// is a supplementary section, the appointment's own facts are the reason
  /// this screen exists.
  ClinicModel? _clinicLocation;

  CustomerError? _failure;
  bool _loading = true;

  // Bumped by every _load(), so a slower/older response (e.g. from a retry
  // fired before a previous one settled) can never land last and overwrite
  // a newer one - `order_summary_screen.dart`'s convention.
  int _loadGeneration = 0;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  Future<void> _load() async {
    final gen = ++_loadGeneration;
    if (!_loading) setState(() => _loading = true);
    setState(() {
      _loading = true;
      _failure = null;
    });

    final provider = context.read<DentalProvider>();
    try {
      final appointment = await provider.fetchAppointmentDetail(widget.appointmentId);
      if (!mounted || gen != _loadGeneration) return;

      ClinicModel? location;
      final clinicId = appointment.clinic?.id;
      if (clinicId != null && clinicId.isNotEmpty) {
        try {
          location = await provider.fetchClinicDetail(clinicId);
        } catch (_) {
          // Supplementary only (see the field doc comment above) - the
          // appointment itself loaded fine, so the screen still shows
          // everything else; only the map section is skipped.
          location = null;
        }
        if (!mounted || gen != _loadGeneration) return;
      }

      setState(() {
        _appointment = appointment;
        _clinicLocation = location;
        _failure = null;
        _loading = false;
      });
    } catch (e) {
      if (!mounted || gen != _loadGeneration) return;
      setState(() {
        _failure = AppErrors.from(e);
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: BlynkColors.paper,
      appBar: AppBar(title: const Text('Appointment')),
      body: ContentFrame(child: _body()),
    );
  }

  Widget _body() {
    if (_loading) {
      return SkeletonScope(
        child: ListView(
          key: const Key('appointment-detail-skeleton'),
          padding: const EdgeInsets.symmetric(vertical: BlynkSpace.s16),
          children: const [
            AppSkeleton(height: 24, width: 180),
            SizedBox(height: BlynkSpace.s16),
            AppSkeleton(height: 96),
            SizedBox(height: BlynkSpace.s16),
            AppSkeleton(height: DentalLayout.mapFrameHeight),
            SizedBox(height: BlynkSpace.s16),
            AppSkeleton(height: 96),
          ],
        ),
      );
    }

    final failure = _failure;
    if (failure != null) {
      if (failure.isNotFound) {
        return const AppStateView.notFound(
          title: 'Appointment not found',
          message: 'This appointment may have been removed, or belongs to a different account.',
        );
      }
      return FailureState(
        failure: failure,
        title: "We couldn't load this appointment",
        scrollable: false,
        onRetry: _load,
        retryKey: const Key('appointment-detail-retry'),
      );
    }

    final appointment = _appointment!;
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        key: const Key('appointment-detail-content'),
        padding: const EdgeInsets.only(top: BlynkSpace.s16, bottom: BlynkSpace.s32),
        physics: const AlwaysScrollableScrollPhysics(parent: BouncingScrollPhysics()),
        children: [
          ..._sections(appointment),
        ],
      ),
    );
  }

  List<Widget> _sections(AppointmentModel appointment) {
    final doctor = appointment.doctor;
    final clinic = appointment.clinic;
    final startAt = appointment.startAt;
    final fee = appointment.consultationFeeSnapshot;
    final now = context.read<DentalProvider>().now;
    final badge = dentalAppointmentBadge(appointment, now);
    final location = _clinicLocation;
    final cancellationReason = appointment.cancellationReason;
    final showsCancellationReason = (appointment.status == AppointmentStatus.cancelledByCustomer ||
            appointment.status == AppointmentStatus.cancelledByClinic) &&
        cancellationReason != null &&
        cancellationReason.isNotEmpty;

    return [
      // The same StatusBadge tones the orders list uses - one status system.
      Align(
        alignment: Alignment.centerLeft,
        child: StatusBadge(key: const Key('appointment-status-badge'), tone: badge.tone, label: badge.label),
      ),
      const SizedBox(height: BlynkSpace.s16),
      DentalCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (doctor != null) ...[
              Row(
                children: [
                  const DentalGlyphTile(glyph: BlynkIcons.profile),
                  const SizedBox(width: BlynkSpace.s12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(doctor.fullName, style: BlynkText.heading),
                        const SizedBox(height: BlynkSpace.s4),
                        Text(
                          dentalSpecialtyLabel(doctor.specialty),
                          style: BlynkText.body.copyWith(color: BlynkColors.ink2),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: BlynkSpace.s16),
            ],
            if (clinic != null) ...[
              Text(clinic.name, style: BlynkText.body.copyWith(fontWeight: FontWeight.w700)),
              Text(clinic.addressLine, style: BlynkText.caption.copyWith(color: BlynkColors.ink3)),
              const SizedBox(height: BlynkSpace.s16),
            ],
            DentalFact(
              label: 'When',
              child: Text(
                startAt == null ? 'Time unavailable' : formatAppointmentDateTime(startAt),
                style: BlynkText.body.copyWith(fontWeight: FontWeight.w700, color: BlynkColors.ink),
              ),
            ),
            if (showsCancellationReason) ...[
              const SizedBox(height: BlynkSpace.s16),
              DentalFact(label: 'Reason', child: Text(cancellationReason)),
            ],
          ],
        ),
      ),
      if (location != null) ...[
        const SizedBox(height: BlynkSpace.s16),
        DentalMapFrame(
          key: const Key('appointment-map-frame'),
          child: ClinicLocationMap(
            location: GeoPoint(location.latitude, location.longitude),
            label: location.name,
            mapBuilder: widget.mapBuilder,
          ),
        ),
      ],
      const SizedBox(height: BlynkSpace.s16),
      // No payment is taken for an appointment anywhere in this app: this is
      // what the clinic charges in person, never a total due here, and there
      // is no pay action of any kind on this screen.
      DentalCard(
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Expanded(
              child: DentalFact(
                label: 'Consultation fee',
                child: Text('Indicative - payable at the clinic, in person.'),
              ),
            ),
            const SizedBox(width: BlynkSpace.s12),
            if (fee != null)
              MoneyText(fee, style: BlynkType.price)
            else
              Text('Not available', style: BlynkText.body.copyWith(color: BlynkColors.ink3)),
          ],
        ),
      ),
      const SizedBox(height: BlynkSpace.s16),
      DentalCard(
        child: DentalFact(
          label: 'Patient',
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(appointment.patientName ?? 'Not available', style: BlynkText.body),
              if (appointment.patientPhone != null && appointment.patientPhone!.isNotEmpty)
                Text(appointment.patientPhone!, style: BlynkText.body.copyWith(color: BlynkColors.ink2)),
              if (appointment.patientNotes != null && appointment.patientNotes!.isNotEmpty) ...[
                const SizedBox(height: BlynkSpace.s8),
                Text(appointment.patientNotes!, style: BlynkText.caption.copyWith(color: BlynkColors.ink3)),
              ],
            ],
          ),
        ),
      ),
      // Rate your visit (backend `can_rate`), or the rating already given.
      // The server's updated appointment replaces this screen's copy, so the
      // form turns into "Your rating" without a refetch.
      if (appointment.canRate || appointment.rating != null) ...[
        const SizedBox(height: BlynkSpace.s16),
        DentalRatingCard(
          key: const ValueKey('dental-rating-section'),
          appointment: appointment,
          onRated: (updated) {
            if (!mounted) return;
            setState(() => _appointment = updated);
          },
        ),
      ],
      // Cancel - shown ONLY when the backend's status is `CONFIRMED` (brief's
      // explicit, literal rule - not `can_cancel`, though the two agree in
      // this phase since DENTAL-07 enforces no cutoff yet). The stable key
      // keeps the section's own State (and its in-flight guard) alive across
      // an unrelated rebuild of the sections above it.
      if (appointment.status == AppointmentStatus.confirmed) ...[
        const SizedBox(height: BlynkSpace.s32),
        DentalCancelSection(
          key: const ValueKey('dental-cancel-section'),
          appointment: appointment,
          onChanged: _load,
        ),
      ],
    ];
  }
}
