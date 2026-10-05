import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../Models/dental_doctor_model.dart';
import '../Services/Providers/dental.provider.dart';
import '../Services/app_errors.dart';
import '../UI/Widgets/Atoms/app_skeleton.dart';
import '../UI/Widgets/Atoms/app_state_views.dart';
import '../UI/Widgets/Atoms/blynk_button.dart';
import '../UI/Widgets/Atoms/failure_states.dart';
import '../UI/Widgets/Atoms/money_text.dart';
import '../UI/Widgets/Organisms/dental_rating_section.dart';
import '../UI/Widgets/Organisms/dental_widgets.dart';
import '../app_responsive.dart';
import '../design/tokens.dart';

/// A doctor's profile scoped to one clinic (task F2): the pairing's own fee,
/// never a doctor-global figure (plan §8.2 - fee/availability are
/// clinic-doctor scoped). The primary CTA hands off to F3's slot picker,
/// carrying both ids forward exactly as it received them.
class DentalDoctorProfileScreen extends StatefulWidget {
  const DentalDoctorProfileScreen({super.key, required this.doctorId, required this.clinicId});

  final String doctorId;
  final String clinicId;

  @override
  State<DentalDoctorProfileScreen> createState() => _DentalDoctorProfileScreenState();
}

class _DentalDoctorProfileScreenState extends State<DentalDoctorProfileScreen> {
  DoctorModel? _doctor;
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
    try {
      final doctor = await context.read<DentalProvider>().fetchDoctorDetail(widget.doctorId);
      if (!mounted) return;
      setState(() {
        _doctor = doctor;
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

  /// The one clinic-doctor pairing this screen is scoped to, from the
  /// doctor's own `clinics[]` (`DoctorClinicDto`, plan §8.2). Null when the
  /// doctor no longer practices at this clinic - the fee then reads
  /// "Not available" rather than a stale or invented figure.
  DoctorClinicModel? get _pairing {
    final doctor = _doctor;
    if (doctor == null) return null;
    for (final clinic in doctor.clinics) {
      if (clinic.clinicId == widget.clinicId) return clinic;
    }
    return null;
  }

  @override
  Widget build(BuildContext context) {
    final doctor = _doctor;
    final canBook = !_loading && _failure == null && doctor != null;
    return Scaffold(
      backgroundColor: BlynkColors.paper,
      appBar: AppBar(title: Text(doctor?.fullName ?? 'Doctor')),
      body: ContentFrame(child: _body()),
      bottomNavigationBar: canBook ? _BookBar(doctorId: widget.doctorId, clinicId: widget.clinicId) : null,
    );
  }

  Widget _body() {
    if (_loading) {
      return SkeletonScope(
        child: ListView(
          key: const Key('doctor-profile-skeleton'),
          padding: const EdgeInsets.symmetric(vertical: BlynkSpace.s16),
          children: const [
            AppSkeleton(
              height: DentalLayout.profileTileSize,
              width: DentalLayout.profileTileSize,
              radius: BlynkRadius.chip,
            ),
            SizedBox(height: BlynkSpace.s16),
            AppSkeleton(height: 20, width: 180),
            SizedBox(height: BlynkSpace.s8),
            AppSkeleton(height: 14, width: 120),
            SizedBox(height: BlynkSpace.s24),
            AppSkeleton(height: 60),
          ],
        ),
      );
    }

    final failure = _failure;
    if (failure != null) {
      if (failure.isNotFound) {
        return AppStateView.notFound(
          title: 'Doctor not found',
          message: 'This profile may have been removed or is no longer listed.',
          actionLabel: 'Go back',
          onAction: () => Navigator.of(context).maybePop(),
        );
      }
      return FailureState(
        failure: failure,
        title: "We couldn't load this doctor",
        scrollable: false,
        onRetry: _load,
        retryKey: const Key('doctor-profile-retry'),
      );
    }

    final doctor = _doctor!;
    final pairing = _pairing;
    return ListView(
      padding: const EdgeInsets.only(top: BlynkSpace.s24, bottom: BlynkSpace.s32),
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            DentalGlyphTile(
              glyph: BlynkIcons.profile,
              size: DentalLayout.profileTileSize,
              imageUrl: doctor.photoUrl,
            ),
            const SizedBox(width: BlynkSpace.s16),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(doctor.fullName, style: BlynkText.title),
                  const SizedBox(height: BlynkSpace.s4),
                  Text(
                    dentalSpecialtyLabel(doctor.specialty),
                    style: BlynkText.body.copyWith(color: BlynkColors.ink2),
                  ),
                  // "★ 4.6 (12)", or nothing at all before the first rating.
                  if (doctor.ratingLabel != null) ...[
                    const SizedBox(height: BlynkSpace.s4),
                    DentalDoctorRating(
                      key: const Key('doctor-rating'),
                      average: doctor.ratingAverage,
                      count: doctor.ratingCount,
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
        // Only a bio the backend actually returned. A null/blank bio renders
        // nothing at all - no placeholder, no "coming soon".
        if (doctor.bio != null && doctor.bio!.trim().isNotEmpty) ...[
          const SizedBox(height: BlynkSpace.s32),
          const DentalSectionTitle('About'),
          const SizedBox(height: BlynkSpace.s12),
          Text(doctor.bio!.trim(), style: BlynkText.body),
        ],
        const SizedBox(height: BlynkSpace.s32),
        DentalCard(
          key: const Key('doctor-fee-card'),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Expanded(
                child: DentalFact(
                  label: 'Consultation fee at this clinic',
                  // No payment is taken anywhere in this flow - the figure is
                  // what the clinic charges in person, not a total due here.
                  child: Text('Payable at the clinic, in person'),
                ),
              ),
              const SizedBox(width: BlynkSpace.s12),
              if (pairing?.consultationFee != null)
                MoneyText(pairing!.consultationFee!, style: BlynkType.price)
              else
                Text('Not available', style: BlynkText.body.copyWith(color: BlynkColors.ink3)),
            ],
          ),
        ),
      ],
    );
  }
}

/// The screen's one sticky yellow action, pinned under the content -
/// `ProductDetailsScreen`'s convention, and the same `BlynkButton.cta` the
/// rest of the app's forward actions use. Names the route F5 registers
/// (`/dental/book`); the args map is the shape F3/F5 expect.
class _BookBar extends StatelessWidget {
  const _BookBar({required this.doctorId, required this.clinicId});

  final String doctorId;
  final String clinicId;

  @override
  Widget build(BuildContext context) {
    return DentalBottomBar(
      child: BlynkButton.cta(
        key: const Key('book-appointment-cta'),
        label: 'Book appointment',
        onPressed: () => Navigator.of(context).pushNamed(
          '/dental/book',
          arguments: {'doctorId': doctorId, 'clinicId': clinicId},
        ),
      ),
    );
  }
}
