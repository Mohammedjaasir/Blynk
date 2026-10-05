import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../Models/dental_clinic_model.dart';
import '../Models/dental_doctor_model.dart';
import '../Services/Providers/dental.provider.dart';
import '../Services/app_errors.dart';
import '../UI/Widgets/Atoms/app_skeleton.dart';
import '../UI/Widgets/Atoms/app_state_views.dart';
import '../UI/Widgets/Atoms/failure_states.dart';
import '../UI/Widgets/Atoms/money_text.dart';
import '../UI/Widgets/Organisms/clinic_location_map.dart';
import '../UI/Widgets/Organisms/dental_rating_section.dart';
import '../UI/Widgets/Organisms/dental_widgets.dart';
import '../UI/Widgets/Organisms/map_provider.dart';
import '../app_responsive.dart';
import '../design/tokens.dart';

/// A clinic's own page (task F2): name/address/operating hours, its fixed
/// location on `ClinicLocationMap` (task F1), then the roster of doctors
/// practicing there. Fee/availability are clinic-doctor-scoped (plan §8.2),
/// so tapping a doctor row carries both `doctorId` and `clinicId` forward -
/// never the doctor id alone.
class DentalClinicDetailScreen extends StatefulWidget {
  const DentalClinicDetailScreen({super.key, required this.clinicId, this.mapBuilder});

  final String clinicId;

  /// Test seam forwarded to `ClinicLocationMap`, so most widget tests here
  /// never need a native platform view - `OrderSummaryScreen.mapBuilder`'s
  /// exact convention. Production callers leave it null and get the real map.
  final TrackingMapBuilder? mapBuilder;

  @override
  State<DentalClinicDetailScreen> createState() => _DentalClinicDetailScreenState();
}

class _DentalClinicDetailScreenState extends State<DentalClinicDetailScreen> {
  ClinicModel? _clinic;
  List<ClinicDoctorModel> _doctors = const [];
  bool _loading = true;
  CustomerError? _failure;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  Future<void> _load() async {
    if (!mounted) return;
    setState(() {
      _loading = true;
      _failure = null;
    });
    final provider = context.read<DentalProvider>();
    try {
      // Both requests are in flight before either is awaited; Future.wait
      // (default eagerError: false) waits for both to settle so a failure in
      // one never leaves the other's rejection unhandled.
      final results = await Future.wait<Object>([
        provider.fetchClinicDetail(widget.clinicId),
        provider.fetchClinicDoctors(widget.clinicId),
      ]);
      if (!mounted) return;
      setState(() {
        _clinic = results[0] as ClinicModel;
        _doctors = results[1] as List<ClinicDoctorModel>;
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

  static String _formatTime(String raw) => raw.length >= 5 ? raw.substring(0, 5) : raw;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: BlynkColors.paper,
      appBar: AppBar(title: Text(_clinic?.name ?? 'Clinic')),
      body: ContentFrame(child: _body()),
    );
  }

  Widget _body() {
    if (_loading) {
      return SkeletonScope(
        child: ListView(
          key: const Key('clinic-detail-skeleton'),
          padding: const EdgeInsets.symmetric(vertical: BlynkSpace.s16),
          children: const [
            AppSkeleton(height: 22, width: 220),
            SizedBox(height: BlynkSpace.s8),
            AppSkeleton(height: 14, width: 160),
            SizedBox(height: BlynkSpace.s16),
            AppSkeleton(height: DentalLayout.mapFrameHeight),
            SizedBox(height: BlynkSpace.s24),
            ListRowSkeleton(),
            ListRowSkeleton(),
          ],
        ),
      );
    }

    final failure = _failure;
    if (failure != null) {
      if (failure.isNotFound) {
        return AppStateView.notFound(
          title: 'Clinic not found',
          message: 'This clinic may have been removed or is no longer listed.',
          actionLabel: 'Go back',
          onAction: () => Navigator.of(context).maybePop(),
        );
      }
      return FailureState(
        failure: failure,
        title: "We couldn't load this clinic",
        scrollable: false,
        onRetry: _load,
        retryKey: const Key('clinic-detail-retry'),
      );
    }

    final clinic = _clinic!;
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.only(top: BlynkSpace.s16, bottom: BlynkSpace.s32),
        physics: const AlwaysScrollableScrollPhysics(parent: BouncingScrollPhysics()),
        children: [
          Text(clinic.name, style: BlynkText.title),
          const SizedBox(height: BlynkSpace.s8),
          Text(clinic.addressLine, style: BlynkText.body.copyWith(color: BlynkColors.ink2)),
          const SizedBox(height: BlynkSpace.s4),
          Text(clinic.city, style: BlynkText.body.copyWith(color: BlynkColors.ink2)),
          const SizedBox(height: BlynkSpace.s12),
          Align(
            alignment: Alignment.centerLeft,
            child: DentalInfoPill(
              icon: BlynkIcons.pending,
              label: 'Open ${_formatTime(clinic.operatingStartTime)} – ${_formatTime(clinic.operatingEndTime)}',
            ),
          ),
          const SizedBox(height: BlynkSpace.s24),
          DentalMapFrame(
            key: const Key('clinic-map-frame'),
            child: ClinicLocationMap(
              location: GeoPoint(clinic.latitude, clinic.longitude),
              label: clinic.name,
              mapBuilder: widget.mapBuilder,
            ),
          ),
          const SizedBox(height: BlynkSpace.s32),
          const DentalSectionTitle('Doctors'),
          const SizedBox(height: BlynkSpace.s12),
          if (_doctors.isEmpty)
            const AppStateView.empty(title: 'No doctors listed at this clinic yet')
          else
            for (final doctor in _doctors) ...[
              _DoctorRow(clinicId: widget.clinicId, doctor: doctor),
              const SizedBox(height: BlynkSpace.s12),
            ],
        ],
      ),
    );
  }
}

class _DoctorRow extends StatelessWidget {
  const _DoctorRow({required this.clinicId, required this.doctor});

  final String clinicId;
  final ClinicDoctorModel doctor;

  @override
  Widget build(BuildContext context) {
    return DentalCard(
      key: Key('doctor-row-${doctor.clinicDoctorId}'),
      semanticLabel: [
        doctor.fullName,
        dentalSpecialtyLabel(doctor.specialty),
        if (doctor.ratingLabel != null)
          'rated ${doctor.ratingAverage!.toStringAsFixed(1)} out of 5 from ${doctor.ratingCount} '
              '${doctor.ratingCount == 1 ? 'rating' : 'ratings'}',
      ].join(', '),
      onTap: () => Navigator.of(context).pushNamed(
        '/dental/doctor',
        arguments: {'doctorId': doctor.doctorId, 'clinicId': clinicId},
      ),
      child: Row(
        children: [
          DentalGlyphTile(glyph: BlynkIcons.profile, imageUrl: doctor.photoUrl),
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
                // "★ 4.6 (12)", or nothing at all before the first rating.
                if (doctor.ratingLabel != null) ...[
                  const SizedBox(height: BlynkSpace.s4),
                  DentalDoctorRating(
                    key: Key('doctor-rating-${doctor.clinicDoctorId}'),
                    average: doctor.ratingAverage,
                    count: doctor.ratingCount,
                  ),
                ],
                // Rendered only when the backend actually returns a fee for
                // this clinic-doctor pairing - never a zero, never a guess,
                // and never a price to pay here (there is no payment in this
                // flow at all).
                if (doctor.consultationFee != null) ...[
                  const SizedBox(height: BlynkSpace.s8),
                  MoneyText(doctor.consultationFee!, style: BlynkType.priceCompact),
                ],
              ],
            ),
          ),
          const SizedBox(width: BlynkSpace.s8),
          const Icon(BlynkIcons.chevron, color: BlynkColors.ink2),
        ],
      ),
    );
  }
}
