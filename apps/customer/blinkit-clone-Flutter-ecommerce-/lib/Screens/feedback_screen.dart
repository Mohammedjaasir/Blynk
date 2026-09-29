import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../app_responsive.dart';
import '../design/tokens.dart';
import '../Services/Providers/auth.provider.dart';
import '../Services/Providers/feedback.provider.dart';
import '../UI/Widgets/Atoms/blynk_button.dart';
import '../UI/Widgets/Atoms/blynk_text_field.dart';
import '../UI/Widgets/Atoms/snackbar_helper.dart';

/// Send feedback to the store (Profile / Help -> Send feedback). The message
/// lands in Blynk Admin's Feedback inbox (migration 013).
///
/// A category and a message are required; the star rating is optional and
/// tapping the chosen star again clears it. The backend allows 5 messages an
/// hour per customer and says so with FEEDBACK_RATE_LIMITED, which AppErrors
/// turns into its own sentence.
class FeedbackScreen extends StatefulWidget {
  const FeedbackScreen({super.key, this.provider});

  /// Injectable for tests; the screen makes its own otherwise.
  final FeedbackProvider? provider;

  /// Opens the screen, or sends a guest to log in first - feedback is stored
  /// against the customer's account, so it is a signed-in action.
  static void open(BuildContext context) {
    final navigator = Navigator.of(context);
    if (!context.read<AuthProvider>().isAuthenticated) {
      navigator.pushNamed('/login');
      return;
    }
    navigator.push(MaterialPageRoute(builder: (_) => const FeedbackScreen()));
  }

  @override
  State<FeedbackScreen> createState() => _FeedbackScreenState();
}

class _FeedbackScreenState extends State<FeedbackScreen> {
  late final FeedbackProvider _feedback = widget.provider ?? FeedbackProvider();
  final TextEditingController _message = TextEditingController();

  int? _rating;
  FeedbackCategory? _category;
  String? _messageError;
  String? _categoryError;

  @override
  void dispose() {
    _message.dispose();
    // Only dispose what this screen made; an injected provider is the caller's.
    if (widget.provider == null) _feedback.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final text = _message.text.trim();
    setState(() {
      _categoryError = _category == null ? 'Choose what your feedback is about.' : null;
      _messageError = text.isEmpty ? 'Write a message first.' : null;
    });
    if (_category == null || text.isEmpty) return;

    final sent = await _feedback.send(category: _category!, message: text, rating: _rating);
    if (!mounted) return;

    if (sent) {
      showBlynkSnackBar(
        context: context,
        message: 'Thanks - your feedback was sent',
        tone: SnackTone.success,
      );
      Navigator.of(context).pop();
      return;
    }

    final failure = _feedback.failure;
    showBlynkSnackBar(
      context: context,
      message: failure?.message ?? 'Something went wrong. Try again.',
      tone: SnackTone.error,
      actionLabel: failure?.needsLogin == true ? 'Log in' : null,
      onAction: failure?.needsLogin == true ? () => Navigator.of(context).pushNamed('/login') : null,
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: BlynkColors.paper,
      appBar: AppBar(title: const Text('Send feedback')),
      body: ContentFrame(
        maxWidth: 720,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(0, BlynkSpace.s8, 0, BlynkSpace.s32),
          children: [
            Text(
              'Tell us what went well or what we can do better. '
              'The Blynk team reads every message.',
              style: BlynkText.body.copyWith(color: BlynkColors.ink2),
            ),
            const SizedBox(height: BlynkSpace.s24),
            const Text('How was your experience? (optional)', style: BlynkText.label),
            const SizedBox(height: BlynkSpace.s8),
            _StarRating(
              value: _rating,
              onChanged: (value) => setState(() => _rating = value),
            ),
            const SizedBox(height: BlynkSpace.s24),
            const Text('What is it about?', style: BlynkText.label),
            const SizedBox(height: BlynkSpace.s8),
            Wrap(
              spacing: BlynkSpace.s8,
              runSpacing: BlynkSpace.s8,
              children: [
                for (final category in FeedbackCategory.values)
                  _CategoryChip(
                    label: category.label,
                    selected: _category == category,
                    onTap: () => setState(() {
                      _category = category;
                      _categoryError = null;
                    }),
                  ),
              ],
            ),
            if (_categoryError != null) _InlineError(_categoryError!),
            const SizedBox(height: BlynkSpace.s24),
            BlynkTextField(
              label: 'Your message',
              controller: _message,
              hintText: 'Write your feedback here',
              errorText: _messageError,
              keyboardType: TextInputType.multiline,
              textInputAction: TextInputAction.newline,
              textCapitalization: TextCapitalization.sentences,
              maxLength: FeedbackProvider.maxMessageLength,
              maxLines: 6,
              showClear: false,
              onChanged: (_) {
                if (_messageError != null) setState(() => _messageError = null);
              },
            ),
            const SizedBox(height: BlynkSpace.s4),
            // BlynkTextField hides the stock counter; a long message is the
            // one place a customer needs to see how much room is left.
            ListenableBuilder(
              listenable: _message,
              builder: (context, _) => Align(
                alignment: Alignment.centerRight,
                child: Text(
                  '${_message.text.length} / ${FeedbackProvider.maxMessageLength}',
                  style: BlynkText.caption.copyWith(color: BlynkColors.ink2),
                ),
              ),
            ),
            const SizedBox(height: BlynkSpace.s24),
            ListenableBuilder(
              listenable: _feedback,
              builder: (context, _) => BlynkButton.cta(
                label: 'Send feedback',
                loading: _feedback.isSending,
                onPressed: _submit,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Five 48 dp star targets. Tapping the chosen star again clears the rating,
/// since the rating is optional.
class _StarRating extends StatelessWidget {
  const _StarRating({required this.value, required this.onChanged});

  final int? value;
  final ValueChanged<int?> onChanged;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        for (var star = 1; star <= 5; star++)
          Semantics(
            button: true,
            selected: value == star,
            label: star == 1 ? '1 star' : '$star stars',
            excludeSemantics: true,
            onTap: () => onChanged(value == star ? null : star),
            child: IconButton(
              constraints: const BoxConstraints.tightFor(width: 48, height: 48),
              padding: EdgeInsets.zero,
              icon: Icon(
                (value ?? 0) >= star ? Icons.star_rounded : Icons.star_outline_rounded,
                size: BlynkIcons.lg,
                // Filled vs outline carries the meaning; ink keeps it off
                // the yellow reserved for the forward action.
                color: (value ?? 0) >= star ? BlynkColors.ink : BlynkColors.ink3,
              ),
              onPressed: () => onChanged(value == star ? null : star),
            ),
          ),
      ],
    );
  }
}

/// The search screen's filter chip: selected is ink, not yellow.
class _CategoryChip extends StatelessWidget {
  const _CategoryChip({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return ChoiceChip(
      label: Text(label),
      selected: selected,
      showCheckmark: false,
      onSelected: (_) => onTap(),
      selectedColor: BlynkColors.ink,
      backgroundColor: BlynkColors.well,
      side: const BorderSide(color: BlynkColors.lineStrong),
      labelStyle: BlynkText.label.copyWith(
        color: selected ? BlynkColors.paper : BlynkColors.ink,
      ),
    );
  }
}

/// Same shape as BlynkTextField's inline error: icon + words, a live region.
class _InlineError extends StatelessWidget {
  const _InlineError(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: BlynkSpace.s8),
      child: Semantics(
        liveRegion: true,
        container: true,
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Padding(
              padding: EdgeInsets.only(top: 2),
              child: Icon(BlynkIcons.error, size: BlynkIcons.xs, color: BlynkColors.problem),
            ),
            const SizedBox(width: BlynkSpace.s4),
            Expanded(
              child: Text(text, style: BlynkText.caption.copyWith(color: BlynkColors.problem)),
            ),
          ],
        ),
      ),
    );
  }
}
