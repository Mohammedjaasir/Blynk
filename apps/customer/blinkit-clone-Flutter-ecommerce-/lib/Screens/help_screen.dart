import 'package:flutter/material.dart';

import '../design/tokens.dart';
import '../app_responsive.dart';
import '../Services/store_info.dart';
import '../UI/Widgets/Atoms/list_tile.dart';
import 'feedback_screen.dart';

/// Customer help. Everything here is static, factual Blynk service
/// information (delivery area, hours, fee, payment method, cancellation
/// rules) that matches the backend's actual business rules.
///
/// There is no support-ticket or chat module in the backend, so this screen
/// does not pretend to offer one - it answers what it can and points to the
/// order screens for anything order-specific. Below the answers, "Send
/// feedback" opens the one-way feedback form (read by the store in Blynk
/// Admin, not a conversation).
class HelpScreen extends StatelessWidget {
  const HelpScreen({super.key});

  /// The answers. The delivery fee is not quoted: it can change, and the
  /// cart always shows the one that applies (owner, 2026-10-06).
  static const List<_Faq> _faqs = [
    _Faq(
      question: 'Where do you deliver?',
      answer:
          'We deliver within ${StoreInfo.serviceRadiusKm} km of our '
          '${StoreInfo.hubName} hub. If your address falls outside that '
          'range, checkout will let you know before your order is placed.',
    ),
    _Faq(
      question: 'What are your delivery hours?',
      answer:
          'You can place an order any time, day or night. Deliveries go out '
          '${StoreInfo.deliveryHoursLabel}.',
    ),
    _Faq(
      question: 'How much is delivery?',
      answer: 'The delivery fee is shown in your cart before you place your order.',
    ),
    _Faq(
      question: 'How can I pay?',
      answer:
          '${StoreInfo.paymentMethodLabel}. Pay the rider when your groceries '
          'arrive - no card or online payment needed.',
    ),
    _Faq(
      question: 'Can I cancel my order?',
      answer:
          'Yes, while your order is still Placed or Packed. Once it is out '
          'for delivery we can no longer cancel it. Open the order from '
          'Orders to cancel.',
    ),
    _Faq(
      question: 'Something was missing or wrong',
      answer:
          'Open the order from the Orders tab and check the item list first.',
    ),
  ];

  @override
  Widget build(BuildContext context) {
    final responsive = Responsive.of(context);

    return Scaffold(
      backgroundColor: BlynkColors.paper,
      appBar: AppBar(title: const Text('Help')),
      body: Center(
        child: ConstrainedBox(
          constraints: BoxConstraints(maxWidth: responsive.contentMaxWidth),
          child: ListView(
            padding: const EdgeInsets.fromLTRB(
              BlynkSpace.s16,
              BlynkSpace.s8,
              BlynkSpace.s16,
              BlynkSpace.s32,
            ),
            children: [
              // The page's own heading: a soft well, no border, no rule
              // under it - the space below is the separation.
              Container(
                padding: const EdgeInsets.all(BlynkSpace.s16),
                decoration: const BoxDecoration(
                  color: BlynkColors.well,
                  borderRadius: BlynkRadius.lgAll,
                ),
                child: Row(
                  children: [
                    const Icon(
                      Icons.support_agent,
                      size: BlynkIcons.lg,
                      color: BlynkColors.ink,
                    ),
                    const SizedBox(width: BlynkSpace.s12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text('Need a hand?', style: BlynkText.title),
                          const SizedBox(height: BlynkSpace.s4),
                          Text(
                            'Answers to the questions we get most.',
                            style: BlynkText.body.copyWith(color: BlynkColors.ink2),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: BlynkSpace.s24),
              ..._faqs.map((faq) => _FaqTile(faq: faq)),
              const SizedBox(height: BlynkSpace.s8),
              customListTile(
                icon: BlynkIcons.feedback,
                title: 'Send feedback',
                callback: () => FeedbackScreen.open(context),
              ),
              const SizedBox(height: BlynkSpace.s24),
              Semantics(
                header: true,
                child: Text(
                  'Our store',
                  style: BlynkText.caption.copyWith(color: BlynkColors.ink2),
                ),
              ),
              const SizedBox(height: BlynkSpace.s8),
              Text(
                'Deliveries go out ${StoreInfo.deliveryHoursLabel}.',
                style: BlynkText.body.copyWith(color: BlynkColors.ink2),
              ),
              const SizedBox(height: BlynkSpace.s8),
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Icon(
                    Icons.place_outlined,
                    size: BlynkIcons.sm,
                    color: BlynkColors.ink2,
                  ),
                  const SizedBox(width: BlynkSpace.s8),
                  Expanded(
                    child: Text(
                      '${StoreInfo.hubName}, ${StoreInfo.country}',
                      style: BlynkText.body.copyWith(color: BlynkColors.ink2),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _Faq {
  const _Faq({required this.question, required this.answer});
  final String question;
  final String answer;
}

class _FaqTile extends StatelessWidget {
  const _FaqTile({required this.faq});

  final _Faq faq;

  @override
  Widget build(BuildContext context) {
    // Material (not a decorated Container) so the ExpansionTile's ListTile
    // can paint its own background and ink splash - a DecoratedBox in
    // between silently swallows them.
    return Padding(
      padding: const EdgeInsets.only(bottom: BlynkSpace.s8),
      child: Material(
        color: BlynkColors.well,
        borderRadius: BlynkRadius.lgAll,
        clipBehavior: Clip.antiAlias,
        child: Theme(
          // The default divider lines read as clutter against the card edge.
          data: Theme.of(context).copyWith(dividerColor: BlynkColors.clear),
          child: ExpansionTile(
            title: Text(faq.question, style: BlynkText.rowLabel),
            iconColor: BlynkColors.ink,
            collapsedIconColor: BlynkColors.ink2,
            childrenPadding: const EdgeInsets.fromLTRB(
              BlynkSpace.s16,
              0,
              BlynkSpace.s16,
              BlynkSpace.s16,
            ),
            children: [
              Align(
                alignment: Alignment.centerLeft,
                child: Text(
                  faq.answer,
                  style: BlynkText.body.copyWith(color: BlynkColors.ink2),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
