import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'package:ecom/app_colors.dart';
import '../../../Models/order_model.dart';
import '../../../Services/Exceptions/api_exception.dart';
import '../../../Services/Providers/order.provider.dart';
import '../../../app_design.dart';

/// What to tell the customer when the backend refuses (or we never heard
/// back about) a cancellation.
///
/// A refusal is the backend's final word - the order was already on its way,
/// already cancelled, or otherwise not cancellable - and is worded as such.
/// A timeout/network failure is deliberately *not* worded as a failure: the
/// request may well have succeeded, so the screen says it is checking and
/// then refetches the order to show whatever actually happened.
String cancelRefusalMessage(ApiException e) {
  switch (e.code) {
    case 'ORDER_ALREADY_OUT_FOR_DELIVERY':
      return "Your order is already on its way, so it can't be cancelled.";
    case 'ORDER_ALREADY_CANCELLED':
      return 'This order is already cancelled.';
    case 'ORDER_CANNOT_BE_CANCELLED':
      return "This order can't be cancelled now.";
    case 'ORDER_NOT_FOUND':
      return 'This order could not be found.';
    case 'TIMEOUT':
    case 'NETWORK_ERROR':
      return "We couldn't confirm the cancellation. Checking your order…";
  }
  if (e.statusCode == 408 || e.statusCode == 503) {
    return "We couldn't confirm the cancellation. Checking your order…";
  }
  return e.message;
}

/// Section 6 of the order detail: the cancellation policy line and the
/// cancel action.
///
/// The section is only ever built when the backend said `can_cancel: true` -
/// there is no client-side list of cancellable statuses anywhere. The
/// backend's cancel endpoint stays the authority: a stale `true` comes back
/// as a refusal, which is shown as a message, and either way [onChanged]
/// refetches the order so the screen shows the backend's truth (including
/// the new history row on success).
class OrderCancelSection extends StatefulWidget {
  const OrderCancelSection({
    super.key,
    required this.order,
    required this.onChanged,
  });

  final OrderModel order;

  /// The screen's own reload. Awaited after every cancel attempt.
  final Future<void> Function() onChanged;

  @override
  State<OrderCancelSection> createState() => _OrderCancelSectionState();
}

class _OrderCancelSectionState extends State<OrderCancelSection> {
  // Guards the whole attempt (sheet included) so a second tap can never
  // send a second POST while the first one is still in flight.
  bool _busy = false;

  Future<void> _openSheet() async {
    if (_busy) return;

    final confirmed = await showModalBottomSheet<bool>(
      context: context,
      backgroundColor: Colors.white,
      shape: RoundedRectangleBorder(borderRadius: AppRadius.sheetBorder),
      builder: (sheetContext) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(
            AppSpacing.xl,
            AppSpacing.xl,
            AppSpacing.xl,
            AppSpacing.lg,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Center(
                child: Container(
                  width: 40,
                  height: 4,
                  margin: const EdgeInsets.only(bottom: AppSpacing.lg),
                  decoration: BoxDecoration(
                    color: AppSurfaces.border,
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),
              const Text(
                'Cancel this order?',
                style: TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.w800,
                  color: AppTextColors.primary,
                ),
              ),
              const SizedBox(height: AppSpacing.sm),
              const Text(
                "This can't be undone.",
                style: TextStyle(fontSize: 14, color: AppTextColors.secondary),
              ),
              const SizedBox(height: AppSpacing.xl),
              ElevatedButton(
                key: const Key('keep-order'),
                onPressed: () => Navigator.of(sheetContext).pop(false),
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppColors.primaryYellowColor,
                  foregroundColor: AppTextColors.onYellow,
                  elevation: 0,
                  minimumSize: const Size.fromHeight(48),
                  shape: RoundedRectangleBorder(borderRadius: AppRadius.buttonBorder),
                ),
                child: const Text('Keep order'),
              ),
              const SizedBox(height: AppSpacing.lg),
              TextButton(
                key: const Key('confirm-cancel'),
                onPressed: () => Navigator.of(sheetContext).pop(true),
                style: TextButton.styleFrom(
                  foregroundColor: AppTextColors.problem,
                  side: const BorderSide(color: AppSurfaces.border),
                  minimumSize: const Size.fromHeight(48),
                  shape: RoundedRectangleBorder(borderRadius: AppRadius.buttonBorder),
                ),
                child: const Text('Cancel order'),
              ),
            ],
          ),
        ),
      ),
    );

    if (confirmed != true || !mounted) return;
    await _cancel();
  }

  Future<void> _cancel() async {
    if (_busy) return;
    setState(() => _busy = true);

    // Captured before the await: the section itself may be gone from the
    // tree by the time the refetched order comes back.
    final messenger = ScaffoldMessenger.of(context);
    final provider = context.read<OrderProvider>();

    final outcome = await provider.cancelOrder(widget.order.id);
    if (!mounted) return;

    if (!outcome.ok) {
      messenger.showSnackBar(
        SnackBar(content: Text(cancelRefusalMessage(outcome.error!))),
      );
    }

    // Always - on a refusal, on a timeout and on success. The screen then
    // shows whatever the backend says, rather than what this widget hoped.
    await widget.onChanged();
    if (!mounted) return;
    setState(() => _busy = false);
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const Text(
          'You can cancel until your order is out for delivery.',
          style: TextStyle(fontSize: 13, color: AppTextColors.onBackground),
        ),
        const SizedBox(height: AppSpacing.md),
        OutlinedButton(
          key: const Key('cancel-order-button'),
          onPressed: _busy ? null : _openSheet,
          style: OutlinedButton.styleFrom(
            foregroundColor: AppTextColors.problem,
            side: const BorderSide(color: AppTextColors.problem),
            minimumSize: const Size.fromHeight(48),
            shape: RoundedRectangleBorder(borderRadius: AppRadius.buttonBorder),
          ),
          child: _busy
              ? const SizedBox(
                  height: 18,
                  width: 18,
                  child: CircularProgressIndicator(strokeWidth: 2.2, color: AppTextColors.problem),
                )
              : const Text('Cancel order'),
        ),
      ],
    );
  }
}
