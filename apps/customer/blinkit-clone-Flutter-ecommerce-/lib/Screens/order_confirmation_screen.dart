import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../Models/order_format.dart';
import '../Models/order_model.dart';
import '../Services/Providers/order.provider.dart';
import '../Services/store_info.dart';
import '../UI/Widgets/Atoms/blynk_button.dart';
import '../app_design.dart';
import '../design/tokens.dart';

/// The moment the order exists. Everything on this screen comes from the
/// order the backend just returned (`OrderProvider.lastPlacedOrder`) — its
/// number, its own `totalAmount`, its payment method, its schedule and the
/// address it will be delivered to. Nothing is estimated, re-summed or
/// predicted here: there is no ETA, no rider and no progress state, because
/// the backend reports none at this point.
class OrderConfirmationScreen extends StatelessWidget {
  const OrderConfirmationScreen({super.key});

  /// The success medallion: Blynk Green is a genuine positive state, which is
  /// exactly what this is. It is static — the order is placed, nothing is
  /// moving.
  static const double _medallion = 128;

  @override
  Widget build(BuildContext context) {
    final order = context.watch<OrderProvider>().lastPlacedOrder;
    final address = order == null
        ? ''
        : [
            order.deliveryAddressLine1,
            order.deliveryAddressLine2 ?? '',
            order.deliveryCity,
          ].where((part) => part.trim().isNotEmpty).join(', ');

    return Scaffold(
      backgroundColor: BlynkColors.well,
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(
              horizontal: BlynkSpace.s24,
              vertical: BlynkSpace.s32,
            ),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 480),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  // The one premium moment checkout is allowed (brief 15):
                  // the medallion settles in once - scale 0.9 to 1 with a
                  // fade, over the emphasized beat - and then is still. No
                  // loop, no confetti; the order details below are what the
                  // customer came to read.
                  const ExcludeSemantics(
                    child: Center(
                      child: _MedallionSettle(
                        child: SizedBox(
                          width: _medallion,
                          height: _medallion,
                          child: DecoratedBox(
                            decoration: BoxDecoration(
                              color: BlynkColors.positiveTint,
                              shape: BoxShape.circle,
                            ),
                            child: Center(
                              child: Icon(
                                BlynkIcons.check,
                                size: _medallion / 2,
                                color: BlynkColors.positive,
                              ),
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(height: BlynkSpace.s24),
                  Semantics(
                    header: true,
                    child: const Text(
                      'Order placed',
                      textAlign: TextAlign.center,
                      style: BlynkText.display,
                    ),
                  ),
                  const SizedBox(height: BlynkSpace.s8),
                  Text(
                    'Your order has been placed successfully.',
                    textAlign: TextAlign.center,
                    style: BlynkText.body.copyWith(color: BlynkColors.ink2),
                  ),
                  if (order != null) ...[
                    const SizedBox(height: BlynkSpace.s24),
                    _OrderFacts(order: order, address: address),
                  ],
                  const SizedBox(height: BlynkSpace.s32),
                  BlynkButton.cta(
                    key: const Key('view-order'),
                    label: 'View order',
                    onPressed: order == null
                        ? null
                        : () => Navigator.of(context)
                            .pushNamed('/order', arguments: order.id),
                  ),
                  const SizedBox(height: BlynkSpace.s12),
                  BlynkButton.secondary(
                    label: 'Back to home',
                    expand: true,
                    onPressed: () => Navigator.of(context)
                        .pushNamedAndRemoveUntil('/home', (route) => false),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// The facts the backend actually returned about this order, stacked so a
/// large system font grows the card instead of squeezing a label against a
/// value.
class _OrderFacts extends StatelessWidget {
  const _OrderFacts({required this.order, required this.address});

  final OrderModel order;
  final String address;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: appCardDecoration(),
      padding: const EdgeInsets.all(BlynkSpace.s16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          const _FactLabel('Order number'),
          Text(order.orderNumber, style: BlynkText.label),
          const SizedBox(height: BlynkSpace.s16),
          const _FactLabel('Amount'),
          Text(
            key: const Key('confirmation-amount'),
            order.paymentMethod == 'COD'
                ? '${formatLkr(order.totalAmount)} · ${StoreInfo.paymentMethodLabel}'
                : formatLkr(order.totalAmount),
            style: BlynkType.priceTotal,
          ),
          if (address.isNotEmpty) ...[
            const SizedBox(height: BlynkSpace.s16),
            const _FactLabel('Delivering to'),
            Text(address, style: BlynkText.body),
          ],
          if (order.isScheduled) ...[
            const SizedBox(height: BlynkSpace.s16),
            Align(
              alignment: Alignment.centerLeft,
              child: Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: BlynkSpace.s12,
                  vertical: BlynkSpace.s8,
                ),
                decoration: BoxDecoration(
                  color: BlynkColors.paper,
                  borderRadius: BlynkRadius.full,
                  border: Border.all(color: BlynkColors.lineStrong),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Padding(
                      padding: EdgeInsets.only(top: 2),
                      child: Icon(
                        Icons.schedule,
                        size: BlynkIcons.xs,
                        color: BlynkColors.ink2,
                      ),
                    ),
                    const SizedBox(width: BlynkSpace.s4),
                    Flexible(
                      child: Text(
                        key: const Key('confirmation-schedule'),
                        'Scheduled — delivery ${formatScheduled(order.scheduledFor!)}',
                        style: BlynkText.label,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _FactLabel extends StatelessWidget {
  const _FactLabel(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: BlynkSpace.s4),
      child: Text(
        text,
        style: BlynkText.caption.copyWith(color: BlynkColors.ink2),
      ),
    );
  }
}

/// Scales and fades [child] into place once. Deliberately begins at 0.9, not
/// 0: the medallion is already recognisable on its first frame and simply
/// finishes arriving, which reads as confirmation rather than as an effect.
/// Under reduced motion it is shown at rest.
class _MedallionSettle extends StatelessWidget {
  const _MedallionSettle({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    if (BlynkMotion.reduced(context)) return child;
    return TweenAnimationBuilder<double>(
      tween: Tween<double>(begin: 0, end: 1),
      duration: BlynkMotion.entrance,
      curve: BlynkMotion.easeOut,
      child: child,
      builder: (context, t, child) => Opacity(
        opacity: t,
        child: Transform.scale(scale: 0.75 + 0.25 * t, child: child),
      ),
    );
  }
}
