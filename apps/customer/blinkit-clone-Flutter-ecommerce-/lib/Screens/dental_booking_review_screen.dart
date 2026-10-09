import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../Models/dental_appointment_model.dart';
import '../Models/dental_doctor_model.dart';
import '../Models/dental_format.dart';
import '../Services/Providers/dental.provider.dart';
import '../Services/app_errors.dart';
import '../UI/Widgets/Atoms/app_state_views.dart';
import '../UI/Widgets/Atoms/blynk_button.dart';
import '../UI/Widgets/Atoms/money_text.dart';
import '../UI/Widgets/Organisms/dental_widgets.dart';
import '../app_responsive.dart';
import '../design/tokens.dart';
import 'dental_booking_confirmation_screen.dart';

/// Step 3 of the booking flow (task F3): the last look before committing.
/// `hold`'s `clinic_doctor_id`/`start_at` are fixed - nothing here can change
/// them, only the patient details carried forward from the previous screen.
///
/// The countdown is real: it reads `hold.heldUntil`, the actual value the
/// backend returned from `holdSlot` (never a client-invented 5-minute
/// timer - common.md / B3's critical rule). It is cosmetic ONLY - reaching
/// zero swaps this screen into the same "hold expired" state a real
/// `410`/`409` from `confirmAppointment` would, but the backend's response to
/// an actual confirm attempt is still the only real gate.
class DentalBookingReviewScreen extends StatefulWidget {
  const DentalBookingReviewScreen({
    super.key,
    required this.hold,
    required this.doctor,
    required this.pairing,
    required this.patientName,
    required this.patientPhone,
    this.patientNotes,
    required this.onExpired,
    this.now,
  });

  final AppointmentModel hold;
  final DoctorModel doctor;
  final DoctorClinicModel pairing;
  final String patientName;
  final String patientPhone;
  final String? patientNotes;

  /// Bounces the whole sub-flow back to the slot picker and refreshes it.
  final VoidCallback onExpired;

  /// Test seam for the ticking countdown - defaults to the real wall clock.
  /// `DentalProvider`'s own injectable-clock convention.
  final DateTime Function()? now;

  @override
  State<DentalBookingReviewScreen> createState() => _DentalBookingReviewScreenState();
}

class _DentalBookingReviewScreenState extends State<DentalBookingReviewScreen> {
  Timer? _ticker;
  bool _confirming = false;
  bool _expired = false;
  String? _errorMessage;

  DateTime get _now => widget.now?.call() ?? DateTime.now();

  Duration get _remaining {
    final heldUntil = widget.hold.heldUntil;
    if (heldUntil == null) return Duration.zero;
    final left = heldUntil.difference(_now);
    return left.isNegative ? Duration.zero : left;
  }

  @override
  void initState() {
    super.initState();
    _expired = _remaining <= Duration.zero;
    _ticker = Timer.periodic(const Duration(seconds: 1), (_) {
      if (!mounted) return;
      final expiredNow = _remaining <= Duration.zero;
      if (expiredNow != _expired) {
        setState(() => _expired = expiredNow);
      } else {
        setState(() {}); // repaint the ticking "m:ss" text
      }
    });
  }

  @override
  void dispose() {
    _ticker?.cancel();
    super.dispose();
  }

  Future<void> _confirm() async {
    if (_confirming || _expired) return;
    setState(() {
      _confirming = true;
      _errorMessage = null;
    });
    final outcome = await context.read<DentalProvider>().confirmAppointment(
          id: widget.hold.id,
          patientName: widget.patientName,
          patientPhone: widget.patientPhone,
          patientNotes: widget.patientNotes,
        );
    if (!mounted) return;

    if (outcome.ok) {
      setState(() => _confirming = false);
      Navigator.of(context).push(
        MaterialPageRoute(
          builder: (_) => DentalBookingConfirmationScreen(appointment: outcome.appointment!),
        ),
      );
      return;
    }

    // 410 HOLD_EXPIRED and 409 APPOINTMENT_NOT_HELD both mean "something
    // changed server-side" - both route to the same non-scary expired state,
    // never a raw error dump (brief).
    if (outcome.isHoldExpired || outcome.isNotHeld) {
      setState(() {
        _confirming = false;
        _expired = true;
      });
      return;
    }

    setState(() {
      _confirming = false;
      _errorMessage = AppErrors.from(outcome.error).message;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: BlynkColors.paper,
      appBar: AppBar(title: const Text('Review booking')),
      body: ContentFrame(child: _expired ? _expiredBody() : _reviewBody()),
      bottomNavigationBar: _expired ? null : _confirmBar(),
    );
  }

  Widget _expiredBody() {
    return AppStateView(
      icon: BlynkIcons.warning,
      title: 'Your hold expired',
      message: 'This time is no longer reserved for you. Pick a new time to continue.',
      actionLabel: 'Pick a new time',
      onAction: widget.onExpired,
      actionKey: const Key('review-pick-new-time'),
    );
  }

  Widget _reviewBody() {
    final hold = widget.hold;
    return ListView(
      padding: const EdgeInsets.only(top: BlynkSpace.s16, bottom: BlynkSpace.s32),
      children: [
        _HoldCountdownCard(remaining: _remaining),
        const SizedBox(height: BlynkSpace.s16),
        _SummaryCard(doctor: widget.doctor, pairing: widget.pairing, startAt: hold.startAt),
        const SizedBox(height: BlynkSpace.s16),
        _PatientCard(name: widget.patientName, phone: widget.patientPhone, notes: widget.patientNotes),
        const SizedBox(height: BlynkSpace.s16),
        _PayAtClinicNotice(fee: hold.consultationFeeSnapshot),
        if (_errorMessage != null) ...[
          const SizedBox(height: BlynkSpace.s16),
          Semantics(
            liveRegion: true,
            container: true,
            child: Text(
              _errorMessage!,
              key: const Key('confirm-error'),
              style: BlynkText.body.copyWith(color: BlynkColors.problem),
            ),
          ),
        ],
      ],
    );
  }

  /// The screen's one yellow action, sticky at the bottom - the same
  /// `BlynkButton.cta` the rest of the app's forward actions use.
  Widget _confirmBar() {
    return DentalBottomBar(
      child: BlynkButton.cta(
        key: const Key('confirm-booking'),
        label: 'Confirm booking',
        loading: _confirming,
        onPressed: _confirm,
      ),
    );
  }
}

class _SummaryCard extends StatelessWidget {
  const _SummaryCard({required this.doctor, required this.pairing, required this.startAt});

  final DoctorModel doctor;
  final DoctorClinicModel pairing;
  final DateTime? startAt;

  @override
  Widget build(BuildContext context) {
    return DentalCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
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
                      doctor.specialty,
                      style: BlynkText.body.copyWith(color: BlynkColors.ink2),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: BlynkSpace.s16),
          Text(pairing.name, style: BlynkText.body.copyWith(fontWeight: FontWeight.w700)),
          Text(pairing.addressLine, style: BlynkText.caption.copyWith(color: BlynkColors.ink3)),
          const SizedBox(height: BlynkSpace.s16),
          DentalFact(
            label: 'When',
            child: Text(
              startAt == null ? 'Time unavailable' : formatAppointmentDateTime(startAt!),
              style: BlynkText.body.copyWith(fontWeight: FontWeight.w700, color: BlynkColors.ink),
            ),
          ),
        ],
      ),
    );
  }
}

class _PatientCard extends StatelessWidget {
  const _PatientCard({required this.name, required this.phone, this.notes});

  final String name;
  final String phone;
  final String? notes;

  @override
  Widget build(BuildContext context) {
    return DentalCard(
      child: DentalFact(
        label: 'Patient',
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(name, style: BlynkText.body),
            Text(phone, style: BlynkText.body.copyWith(color: BlynkColors.ink2)),
            if (notes != null && notes!.isNotEmpty) ...[
              const SizedBox(height: BlynkSpace.s8),
              Text(notes!, style: BlynkText.caption.copyWith(color: BlynkColors.ink3)),
            ],
          ],
        ),
      ),
    );
  }
}

class _HoldCountdownCard extends StatelessWidget {
  const _HoldCountdownCard({required this.remaining});

  final Duration remaining;

  @override
  Widget build(BuildContext context) {
    final text = 'Reserved for ${formatHoldCountdown(remaining)}';
    return DecoratedBox(
      key: const Key('hold-countdown'),
      decoration: const BoxDecoration(
        color: BlynkColors.noticeTint,
        borderRadius: BlynkRadius.mdAll,
      ),
      child: Padding(
        padding: const EdgeInsets.all(BlynkSpace.s12),
        child: Semantics(
          liveRegion: true,
          container: true,
          child: Row(
            children: [
              const Icon(BlynkIcons.pending, size: BlynkIcons.sm, color: BlynkColors.notice),
              const SizedBox(width: BlynkSpace.s8),
              Expanded(
                child: Text(
                  text,
                  style: BlynkText.body.copyWith(color: BlynkColors.notice, fontWeight: FontWeight.w700),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// No online payment anywhere in this flow (common.md rule 2 / plan §11): the
/// only figure shown is the indicative fee the backend snapshotted on the
/// hold, and the copy is explicit that it is collected at the clinic, never
/// here. There is no pay button, no method selector and no total due.
class _PayAtClinicNotice extends StatelessWidget {
  const _PayAtClinicNotice({required this.fee});

  final double? fee;

  @override
  Widget build(BuildContext context) {
    return DentalCard(
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
            MoneyText(fee!, style: BlynkType.price)
          else
            Text('Not available', style: BlynkText.body.copyWith(color: BlynkColors.ink3)),
        ],
      ),
    );
  }
}
