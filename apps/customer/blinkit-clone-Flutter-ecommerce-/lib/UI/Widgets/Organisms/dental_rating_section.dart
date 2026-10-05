import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../Models/dental_appointment_model.dart';
import '../../../Models/dental_doctor_model.dart';
import '../../../Services/Exceptions/api_exception.dart';
import '../../../Services/Providers/dental.provider.dart';
import '../../../Services/app_errors.dart';
import '../../../design/tokens.dart';
import '../Atoms/adaptive_sheet.dart';
import '../Atoms/blynk_button.dart';
import '../Atoms/blynk_text_field.dart';
import 'dental_widgets.dart';

/// What to tell the customer when a rating is refused: the server's own
/// sentence for a deliberate refusal (not rateable, visit not over yet,
/// already rated, validation), the app's own copy when the request never
/// reached the server or the server failed.
String dentalRatingErrorMessage(ApiException error) {
  final code = error.code;
  final transport = code == 'NETWORK_ERROR' || code == 'TIMEOUT';
  final serverFault = error.statusCode == 408 || error.statusCode >= 500;
  if (transport || serverFault || error.message.trim().isEmpty) {
    return AppErrors.from(error).message;
  }
  return error.message;
}

/// "Rate your visit" for one appointment, or - once rated - the rating the
/// customer gave ("Your rating"). Renders nothing when the backend says the
/// visit can't be rated and no rating exists (`can_rate` is the only gate;
/// this widget never re-derives it from the status or the clock).
///
/// [compact] is the my-appointments list's version: a "Rate your visit"
/// button opening the same form in the app's adaptive sheet, so a list row
/// never grows a text field. The detail screen shows the form inline.
class DentalRatingCard extends StatelessWidget {
  const DentalRatingCard({
    super.key,
    required this.appointment,
    required this.onRated,
    this.compact = false,
  });

  final AppointmentModel appointment;

  /// The appointment as the server now has it (rated, `can_rate` off) - the
  /// caller swaps it in for the one it is showing.
  final ValueChanged<AppointmentModel> onRated;
  final bool compact;

  void _handle(RatingOutcome outcome) {
    final rating = outcome.rating;
    if (rating == null) return;
    onRated(outcome.appointment ?? appointment.withRating(rating));
  }

  Future<void> _openSheet(BuildContext context) async {
    final outcome = await showAdaptiveSheet<RatingOutcome>(
      context,
      semanticLabel: 'Rate your visit',
      builder: (sheetContext) => SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(
          BlynkSpace.s24,
          BlynkSpace.s8,
          BlynkSpace.s24,
          BlynkSpace.s24,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text('Rate your visit', style: BlynkText.title),
            const SizedBox(height: BlynkSpace.s16),
            DentalRatingForm(
              appointmentId: appointment.id,
              onRated: (outcome) => Navigator.of(sheetContext).pop(outcome),
            ),
          ],
        ),
      ),
    );
    if (outcome != null) _handle(outcome);
  }

  @override
  Widget build(BuildContext context) {
    final rating = appointment.rating;
    if (rating != null) {
      return DentalCard(
        key: const Key('your-rating'),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text('Your rating', style: BlynkText.heading),
            const SizedBox(height: BlynkSpace.s8),
            DentalRatingStars(stars: rating.stars),
            if (rating.comment != null) ...[
              const SizedBox(height: BlynkSpace.s8),
              Text(rating.comment!, style: BlynkText.body.copyWith(color: BlynkColors.ink2)),
            ],
          ],
        ),
      );
    }

    if (!appointment.canRate) return const SizedBox.shrink();

    if (compact) {
      return DentalCard(
        key: const Key('dental-rating-card'),
        child: Row(
          children: [
            const Expanded(child: Text('How was your visit?', style: BlynkText.heading)),
            const SizedBox(width: BlynkSpace.s12),
            BlynkButton.secondary(
              key: Key('rate-visit-${appointment.id}'),
              label: 'Rate your visit',
              onPressed: () => _openSheet(context),
            ),
          ],
        ),
      );
    }

    return DentalCard(
      key: const Key('dental-rating-card'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          const DentalSectionTitle('Rate your visit'),
          const SizedBox(height: BlynkSpace.s12),
          DentalRatingForm(appointmentId: appointment.id, onRated: _handle),
        ],
      ),
    );
  }
}

/// The rating form itself: five stars, an optional comment and Submit
/// (disabled until a star is chosen). Calls [onRated] only on success; a
/// refusal stays here as an inline message so the customer can try again.
class DentalRatingForm extends StatefulWidget {
  const DentalRatingForm({super.key, required this.appointmentId, required this.onRated});

  final String appointmentId;
  final ValueChanged<RatingOutcome> onRated;

  @override
  State<DentalRatingForm> createState() => _DentalRatingFormState();
}

class _DentalRatingFormState extends State<DentalRatingForm> {
  final TextEditingController _comment = TextEditingController();
  int? _stars;
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _comment.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final stars = _stars;
    if (_busy || stars == null) return;
    setState(() {
      _busy = true;
      _error = null;
    });

    final outcome = await context.read<DentalProvider>().rateAppointment(
          id: widget.appointmentId,
          stars: stars,
          comment: _comment.text,
        );
    if (!mounted) return;

    if (outcome.ok) {
      setState(() => _busy = false);
      widget.onRated(outcome);
      return;
    }
    setState(() {
      _busy = false;
      _error = dentalRatingErrorMessage(outcome.error!);
    });
  }

  @override
  Widget build(BuildContext context) {
    const max = DentalProvider.ratingCommentMaxLength;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: [
        DentalStarPicker(
          value: _stars,
          enabled: !_busy,
          onChanged: (value) => setState(() {
            _stars = value;
            _error = null;
          }),
        ),
        const SizedBox(height: BlynkSpace.s16),
        BlynkTextField(
          key: const Key('rating-comment-field'),
          label: 'Comment (optional)',
          hintText: 'What went well, or what could be better',
          controller: _comment,
          keyboardType: TextInputType.multiline,
          textInputAction: TextInputAction.newline,
          textCapitalization: TextCapitalization.sentences,
          maxLength: max,
          maxLines: 4,
          showClear: false,
          enabled: !_busy,
        ),
        const SizedBox(height: BlynkSpace.s4),
        // BlynkTextField hides the stock counter (feedback_screen.dart's
        // convention for a long free-text field).
        ListenableBuilder(
          listenable: _comment,
          builder: (context, _) => Align(
            alignment: Alignment.centerRight,
            child: Text(
              '${_comment.text.length} / $max',
              style: BlynkText.caption.copyWith(color: BlynkColors.ink2),
            ),
          ),
        ),
        if (_error != null) ...[
          const SizedBox(height: BlynkSpace.s8),
          Semantics(
            liveRegion: true,
            container: true,
            child: Row(
              key: const Key('rating-error'),
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Padding(
                  padding: EdgeInsets.only(top: 2),
                  child: Icon(BlynkIcons.error, size: BlynkIcons.xs, color: BlynkColors.problem),
                ),
                const SizedBox(width: BlynkSpace.s4),
                Expanded(
                  child: Text(_error!, style: BlynkText.caption.copyWith(color: BlynkColors.problem)),
                ),
              ],
            ),
          ),
        ],
        const SizedBox(height: BlynkSpace.s16),
        BlynkButton.cta(
          key: const Key('submit-rating'),
          label: 'Submit rating',
          loading: _busy,
          onPressed: _stars == null || _busy ? null : _submit,
        ),
      ],
    );
  }
}

/// Five 48 dp star targets, each announced as "1 star" ... "5 stars".
class DentalStarPicker extends StatelessWidget {
  const DentalStarPicker({super.key, required this.value, required this.onChanged, this.enabled = true});

  final int? value;
  final ValueChanged<int> onChanged;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    final chosen = value ?? 0;
    return Row(
      children: [
        for (var star = 1; star <= 5; star++)
          Semantics(
            button: true,
            selected: value == star,
            enabled: enabled,
            label: star == 1 ? '1 star' : '$star stars',
            excludeSemantics: true,
            onTap: enabled ? () => onChanged(star) : null,
            child: IconButton(
              key: Key('rating-star-$star'),
              constraints: const BoxConstraints.tightFor(
                width: BlynkControl.minHeight,
                height: BlynkControl.minHeight,
              ),
              padding: EdgeInsets.zero,
              icon: Icon(
                chosen >= star ? BlynkIcons.star : BlynkIcons.starOutline,
                size: BlynkIcons.lg,
                // Ink, not yellow: the yellow belongs to the Submit action.
                color: chosen >= star ? BlynkColors.ink : BlynkColors.ink3,
              ),
              onPressed: enabled ? () => onChanged(star) : null,
            ),
          ),
      ],
    );
  }
}

/// A read-only row of five stars, [stars] of them filled.
class DentalRatingStars extends StatelessWidget {
  const DentalRatingStars({super.key, required this.stars});

  final int stars;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      container: true,
      label: 'Rated $stars out of 5 stars',
      excludeSemantics: true,
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          for (var star = 1; star <= 5; star++)
            Icon(
              stars >= star ? BlynkIcons.star : BlynkIcons.starOutline,
              size: BlynkIcons.md,
              color: stars >= star ? BlynkColors.ink : BlynkColors.ink3,
            ),
        ],
      ),
    );
  }
}

/// A doctor's public rating, `★ 4.6 (12)` (see `dentalRatingLabel`), read
/// aloud as words rather than "black star". Builds nothing at all when there
/// are no ratings yet.
class DentalDoctorRating extends StatelessWidget {
  const DentalDoctorRating({super.key, required this.average, required this.count});

  final double? average;
  final int count;

  @override
  Widget build(BuildContext context) {
    final text = dentalRatingLabel(average, count);
    if (text == null) return const SizedBox.shrink();
    return Semantics(
      container: true,
      label: 'Rated ${average!.toStringAsFixed(1)} out of 5 from $count ${count == 1 ? 'rating' : 'ratings'}',
      excludeSemantics: true,
      child: Text(text, style: BlynkText.body.copyWith(color: BlynkColors.ink, fontWeight: FontWeight.w700)),
    );
  }
}
