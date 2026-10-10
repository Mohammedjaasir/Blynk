import 'package:flutter/foundation.dart';

import 'order_format.dart';

/// Refer a friend (owner, 2026-10-10). The server decides every reward; the
/// app only words what `GET /me/referral` and `GET /orders/checkout-info`
/// say.

double _num(Object? v) => switch (v) {
      num n => n.toDouble(),
      String s => double.tryParse(s.trim()) ?? 0,
      _ => 0,
    };

int _int(Object? v) => switch (v) {
      int n => n,
      num n => n.toInt(),
      String s => int.tryParse(s.trim()) ?? 0,
      _ => 0,
    };

/// The two reward kinds the store can run.
enum ReferralRewardMode { lkrOff, freeDelivery }

ReferralRewardMode? _mode(Object? raw) => switch (raw?.toString().toUpperCase()) {
      'LKR_OFF' => ReferralRewardMode.lkrOff,
      'FREE_DELIVERY' => ReferralRewardMode.freeDelivery,
      _ => null,
    };

/// The programme's reward: what the friend and the inviter get.
@immutable
class ReferralRewardTerms {
  const ReferralRewardTerms({required this.mode, required this.friendAmountLkr, required this.inviterAmountLkr});

  final ReferralRewardMode mode;
  final double friendAmountLkr;
  final double inviterAmountLkr;

  static ReferralRewardTerms? tryParse(Object? raw) {
    if (raw is! Map) return null;
    final mode = _mode(raw['mode']);
    if (mode == null) return null;
    return ReferralRewardTerms(
      mode: mode,
      friendAmountLkr: _num(raw['friend_amount_lkr']),
      inviterAmountLkr: _num(raw['inviter_amount_lkr']),
    );
  }

  /// The one sentence the Refer screen shows.
  String get description => switch (mode) {
        ReferralRewardMode.lkrOff => 'Your friend gets ${formatLkr(friendAmountLkr)} off their first order. '
            'You get ${formatLkr(inviterAmountLkr)} off your next order after their first order is delivered.',
        ReferralRewardMode.freeDelivery =>
          "Your friend gets a free delivery on their first order; you get a free delivery after it's delivered.",
      };
}

/// A reward waiting for this customer's next order.
@immutable
class ReferralCredit {
  const ReferralCredit({required this.mode, required this.amountLkr});

  final ReferralRewardMode mode;
  final double amountLkr;

  static ReferralCredit? tryParse(Object? raw) {
    if (raw is! Map) return null;
    final mode = _mode(raw['mode']);
    if (mode == null) return null;
    return ReferralCredit(mode: mode, amountLkr: _num(raw['amount_lkr']));
  }

  String get label => mode == ReferralRewardMode.freeDelivery ? 'A free delivery' : '${formatLkr(amountLkr)} off';
}

/// Who invited this customer, when someone did.
@immutable
class ReferredBy {
  const ReferredBy({this.firstName, required this.status});

  final String? firstName;
  final String status;

  static ReferredBy? tryParse(Object? raw) {
    if (raw is! Map) return null;
    final name = raw['first_name']?.toString().trim();
    return ReferredBy(
      firstName: name == null || name.isEmpty ? null : name,
      status: (raw['status'] ?? '').toString().toUpperCase(),
    );
  }
}

/// `GET /me/referral`'s `data`.
@immutable
class ReferralInfo {
  const ReferralInfo({
    required this.enabled,
    required this.code,
    this.reward,
    this.invitedCount = 0,
    this.rewardedCount = 0,
    this.credits = const [],
    this.referredBy,
    this.canApplyCode = false,
  });

  /// The store switch (Ops / Admin). Off: nothing about referrals shows.
  final bool enabled;

  /// This customer's own code ('' when the server sent none).
  final String code;
  final ReferralRewardTerms? reward;
  final int invitedCount;
  final int rewardedCount;
  final List<ReferralCredit> credits;
  final ReferredBy? referredBy;

  /// The customer may still enter a friend's code (new customer, none yet).
  final bool canApplyCode;

  static ReferralInfo? tryParse(Object? raw) {
    if (raw is! Map || raw['enabled'] is! bool) return null;
    final credits = raw['credits'] is List ? raw['credits'] as List : const [];
    return ReferralInfo(
      enabled: raw['enabled'] as bool,
      code: (raw['code'] ?? '').toString().trim(),
      reward: ReferralRewardTerms.tryParse(raw['reward']),
      invitedCount: _int(raw['invited_count']),
      rewardedCount: _int(raw['rewarded_count']),
      credits: credits.map(ReferralCredit.tryParse).whereType<ReferralCredit>().toList(),
      referredBy: ReferredBy.tryParse(raw['referred_by']),
      canApplyCode: raw['can_apply_code'] == true,
    );
  }
}

/// `referral_reward` on `GET /orders/checkout-info`: a referral reward the
/// next order can take.
@immutable
class CheckoutReferralReward {
  const CheckoutReferralReward({required this.available, this.side, this.mode, this.amountLkr = 0});

  final bool available;

  /// 'FRIEND' (their first order) or 'INVITER' (a reward they earned).
  final String? side;
  final ReferralRewardMode? mode;
  final double amountLkr;

  static CheckoutReferralReward? tryParse(Object? raw) {
    if (raw is! Map || raw['available'] is! bool) return null;
    final mode = _mode(raw['mode']);
    final amount = _num(raw['amount_lkr']);
    final usable = mode == ReferralRewardMode.freeDelivery || (mode == ReferralRewardMode.lkrOff && amount > 0);
    return CheckoutReferralReward(
      available: (raw['available'] as bool) && usable,
      side: raw['side']?.toString().toUpperCase(),
      mode: mode,
      amountLkr: amount,
    );
  }

  /// "Referral reward: LKR 150 off this order".
  String get lineText => mode == ReferralRewardMode.freeDelivery
      ? 'Referral reward: free delivery on this order'
      : 'Referral reward: ${formatLkr(amountLkr)} off this order';

  /// What it would take off a cart of [subtotal] with [deliveryFee]: an
  /// estimate only, the server prices the order.
  double estimateOn({required double subtotal, required double deliveryFee}) {
    if (!available) return 0;
    if (mode == ReferralRewardMode.freeDelivery) return deliveryFee < 0 ? 0 : deliveryFee;
    return amountLkr > subtotal ? subtotal : amountLkr;
  }

  @override
  bool operator ==(Object other) =>
      other is CheckoutReferralReward &&
      other.available == available &&
      other.side == side &&
      other.mode == mode &&
      other.amountLkr == amountLkr;

  @override
  int get hashCode => Object.hash(available, side, mode, amountLkr);
}

/// A friend's code: letters and digits (lenient; the server is the judge), typed in any case, sent upper-case.
final RegExp referralCodePattern = RegExp(r'^[A-Z0-9]{3,32}$');

String normaliseReferralCode(String raw) => raw.trim().toUpperCase();
