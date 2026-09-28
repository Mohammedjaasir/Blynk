import 'package:flutter/foundation.dart' show TargetPlatform, defaultTargetPlatform;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../design/tokens.dart';
import 'blynk_crossfade.dart';
import 'blynk_press.dart';

/// "- n +" for a cart line. The pill is 40 dp tall but each button's hit area
/// is [BlynkStepper.minTapSize] (48 x 48), and pressing changes colour only,
/// never layout, so it can sit where an ADD button morphs into it.
///
/// Every value comes from [BlynkStepper] (plan §8: a pill on
/// [BlynkStepper.surface] with a [BlynkStepper.borderStrong] boundary) — the
/// pill never carries the yellow, and nothing here can drift from the token
/// layer.
///
/// Decrement is offered while [quantity] is above [min]; increment while it is
/// below [max] (no upper limit when [max] is null). [busy] is the in-flight
/// state for a cart write that has not come back yet: both controls stop
/// responding and say so to a screen reader, while the count keeps showing
/// the quantity the customer can see.
///
/// **Cart behaviour is the caller's**, unchanged: this widget only reports
/// taps. A screen that removes a line when the count reaches zero keeps doing
/// exactly that by passing `min: 0`.
class QuantityStepper extends StatelessWidget {
  const QuantityStepper({
    super.key,
    required this.quantity,
    required this.onIncrement,
    required this.onDecrement,
    required this.productName,
    this.min = 0,
    this.max,
    this.busy = false,
  });

  final int quantity;
  final VoidCallback? onIncrement;
  final VoidCallback? onDecrement;
  final String productName;
  final int min;
  final int? max;

  /// A cart write is in flight: both controls are inert and announced as
  /// disabled, so a second tap cannot queue a duplicate change.
  final bool busy;

  static const double _hit = BlynkStepper.minTapSize;
  static const double _visual = BlynkStepper.visualHeight;

  void _haptic() {
    // Selection click is the Android convention; iOS/desktop stay quiet.
    if (defaultTargetPlatform == TargetPlatform.android) {
      HapticFeedback.selectionClick();
    }
  }

  @override
  Widget build(BuildContext context) {
    final canAdd = !busy && onIncrement != null && (max == null || quantity < max!);
    final canRemove = !busy && onDecrement != null && quantity > min;

    return SizedBox(
      height: _hit,
      child: Stack(
        alignment: Alignment.center,
        children: [
          const Positioned.fill(
            top: (_hit - _visual) / 2,
            bottom: (_hit - _visual) / 2,
            child: DecoratedBox(
              decoration: BoxDecoration(
                color: BlynkStepper.surface,
                borderRadius: BlynkStepper.radius,
                // plan §8: a `line-strong` control boundary. `line` on `paper`
                // measures 1.19:1 — the hairline the control-outline guard
                // exists to keep off real controls.
                border: Border.fromBorderSide(BorderSide(color: BlynkStepper.borderStrong)),
              ),
            ),
          ),
          Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              _StepButton(
                icon: Icons.remove,
                label: busy ? 'Remove one $productName, updating' : 'Remove one $productName',
                onTap: canRemove
                    ? () {
                        _haptic();
                        onDecrement!();
                      }
                    : null,
              ),
              // Flexible + scaleDown: in a very narrow slot the count gives way
              // before the two 48 dp buttons do.
              Flexible(
                child: ConstrainedBox(
                  constraints: const BoxConstraints(minWidth: 28),
                  child: Semantics(
                    label: '$quantity $productName in cart',
                    liveRegion: true,
                    excludeSemantics: true,
                    child: FittedBox(
                      fit: BoxFit.scaleDown,
                      // The count ticks over on a fast crossfade, keyed by
                      // value, so a tap is seen to change the number rather
                      // than the number simply being different.
                      child: BlynkCrossfade(
                        duration: BlynkMotion.base,
                        alignment: Alignment.center,
                        child: Text(
                          '$quantity',
                          key: ValueKey<int>(quantity),
                          textAlign: TextAlign.center,
                          style: BlynkStepper.count.copyWith(color: BlynkStepper.countColor),
                        ),
                      ),
                    ),
                  ),
                ),
              ),
              _StepButton(
                icon: Icons.add,
                label: busy ? 'Add one more $productName, updating' : 'Add one more $productName',
                onTap: canAdd
                    ? () {
                        _haptic();
                        onIncrement!();
                      }
                    : null,
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _StepButton extends StatefulWidget {
  const _StepButton({required this.icon, required this.label, required this.onTap});

  final IconData icon;
  final String label;
  final VoidCallback? onTap;

  @override
  State<_StepButton> createState() => _StepButtonState();
}

class _StepButtonState extends State<_StepButton> {
  bool _focused = false;

  @override
  Widget build(BuildContext context) {
    final enabled = widget.onTap != null;
    return Semantics(
      button: true,
      enabled: enabled,
      label: widget.label,
      onTap: widget.onTap,
      excludeSemantics: true,
      child: Material(
        type: MaterialType.transparency,
        // Press response on each half of the stepper: the control settles
        // under the thumb the instant it is touched, before the count moves.
        child: BlynkPress(
          enabled: enabled,
          child: InkResponse(
          onTap: widget.onTap,
          onFocusChange: (focused) => setState(() => _focused = focused),
          radius: QuantityStepper._visual / 2,
          highlightShape: BoxShape.circle,
          containedInkWell: false,
          child: SizedBox(
            width: QuantityStepper._hit,
            height: QuantityStepper._hit,
            child: Center(
              child: Container(
                width: QuantityStepper._visual - 8,
                height: QuantityStepper._visual - 8,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  // Focus is a 2 dp ink ring, never colour alone.
                  border: _focused ? Border.all(color: BlynkColors.ink, width: 2) : null,
                ),
                child: Icon(
                  widget.icon,
                  size: BlynkStepper.iconSize,
                  color: enabled ? BlynkStepper.icon : BlynkStepper.iconDisabled,
                ),
              ),
            ),
          ),
        ),
        ),
      ),
    );
  }
}
