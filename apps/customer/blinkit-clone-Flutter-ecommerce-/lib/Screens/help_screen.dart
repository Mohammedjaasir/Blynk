import 'package:flutter/material.dart';

import '../app_colors.dart';
import '../app_design.dart';
import '../app_responsive.dart';

/// Customer help. Everything here is static, factual Blynk service
/// information (delivery area, hours, fee, payment method, cancellation
/// rules) that matches the backend's actual business rules.
///
/// There is no support-ticket or chat module in the backend, so this screen
/// does not pretend to offer one - it answers what it can and points to the
/// order screens for anything order-specific.
class HelpScreen extends StatelessWidget {
  const HelpScreen({super.key});

  static const List<_Faq> _faqs = [
    _Faq(
      question: 'Where do you deliver?',
      answer:
          'We deliver within 4 km of our Dharga Town hub. If your address '
          'falls outside that range, checkout will let you know before your '
          'order is placed.',
    ),
    _Faq(
      question: 'What are your delivery hours?',
      answer:
          'You can place an order any time, day or night. Deliveries go out '
          'between 8:00 AM and 9:00 PM.',
    ),
    _Faq(
      question: 'How much is delivery?',
      answer: 'Delivery is a flat Rs. 70 per order.',
    ),
    _Faq(
      question: 'How can I pay?',
      answer:
          'Cash on Delivery. Pay the rider when your groceries arrive - no '
          'card or online payment needed.',
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
          'Open the order from the Orders tab and check the item list first. '
          'If something still looks wrong, contact us on the number below '
          'with your order number ready.',
    ),
  ];

  @override
  Widget build(BuildContext context) {
    final responsive = Responsive.of(context);

    return Scaffold(
      appBar: AppBar(title: const Text('Help')),
      body: Center(
        child: ConstrainedBox(
          constraints: BoxConstraints(maxWidth: responsive.contentMaxWidth),
          child: ListView(
            padding: const EdgeInsets.all(AppSpacing.lg),
            physics: const BouncingScrollPhysics(),
            children: [
              Container(
                padding: const EdgeInsets.all(AppSpacing.lg),
                decoration: BoxDecoration(
                  color: AppColors.primaryYellowColor.withValues(alpha: 0.25),
                  borderRadius: AppRadius.cardBorder,
                ),
                child: const Row(
                  children: [
                    Icon(Icons.support_agent_rounded, size: 30),
                    SizedBox(width: AppSpacing.md),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Need a hand?',
                            style: TextStyle(
                              fontWeight: FontWeight.w800,
                              fontSize: 16,
                              color: AppTextColors.primary,
                            ),
                          ),
                          SizedBox(height: 2),
                          Text(
                            'Answers to the questions we get most.',
                            style: TextStyle(
                              fontSize: 13,
                              color: AppTextColors.secondary,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: AppSpacing.xl),
              ..._faqs.map((faq) => _FaqTile(faq: faq)),
              const SizedBox(height: AppSpacing.xl),
              Container(
                padding: const EdgeInsets.all(AppSpacing.lg),
                decoration: appCardDecoration(),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'Still need help?',
                      style: TextStyle(
                        fontWeight: FontWeight.w800,
                        fontSize: 16,
                        color: AppTextColors.primary,
                      ),
                    ),
                    const SizedBox(height: AppSpacing.sm),
                    const Text(
                      'Reach the Blynk team during delivery hours '
                      '(8:00 AM - 9:00 PM) and keep your order number handy.',
                      style: TextStyle(
                        fontSize: 13,
                        height: 1.4,
                        color: AppTextColors.secondary,
                      ),
                    ),
                    const SizedBox(height: AppSpacing.md),
                    Row(
                      children: [
                        const Icon(
                          Icons.place_outlined,
                          size: 18,
                          color: AppColors.primaryGreenColor,
                        ),
                        const SizedBox(width: AppSpacing.sm),
                        Text(
                          'Dharga Town, Sri Lanka',
                          style: TextStyle(
                            fontSize: 13,
                            color: Colors.grey.shade700,
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
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
    return Container(
      margin: const EdgeInsets.only(bottom: AppSpacing.md),
      decoration: BoxDecoration(
        borderRadius: AppRadius.cardBorder,
        boxShadow: AppElevation.card,
      ),
      child: Material(
        color: Colors.white,
        borderRadius: AppRadius.cardBorder,
        clipBehavior: Clip.antiAlias,
        child: Theme(
          // The default divider lines read as clutter against the card edge.
          data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
          child: ExpansionTile(
            title: Text(
              faq.question,
              style: const TextStyle(
                fontWeight: FontWeight.w700,
                fontSize: 15,
                color: AppTextColors.primary,
              ),
            ),
            iconColor: AppColors.primaryGreenColor,
            childrenPadding: const EdgeInsets.fromLTRB(
              AppSpacing.lg,
              0,
              AppSpacing.lg,
              AppSpacing.lg,
            ),
            children: [
              Align(
                alignment: Alignment.centerLeft,
                child: Text(
                  faq.answer,
                  style: const TextStyle(
                    fontSize: 14,
                    height: 1.45,
                    color: AppTextColors.secondary,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
