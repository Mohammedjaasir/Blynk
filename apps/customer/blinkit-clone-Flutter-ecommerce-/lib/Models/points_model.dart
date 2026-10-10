import 'package:flutter/foundation.dart';

import 'birthday_offer_model.dart' show monthNames;
import 'order_format.dart';

/// Blynk Points (owner, 2026-10-10). Points are earned on delivered orders
/// and can pay for part of a later one. The server keeps the balance and
/// prices every order; the app words it and shows estimates.

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

/// The programme's numbers, as Ops / Admin set them.
@immutable
class PointsProgram {
  const PointsProgram({
    required this.earnPoints,
    required this.earnPerLkr,
    required this.lkrPerPoint,
    required this.minRedeemPoints,
    required this.maxRedeemPercent,
    this.expiryMonths = 0,
  });

  /// [earnPoints] points for every [earnPerLkr] LKR of items.
  final int earnPoints;
  final double earnPerLkr;

  /// What one point is worth at checkout.
  final double lkrPerPoint;

  /// The fewest points that can be used on an order.
  final int minRedeemPoints;

  /// The most of an order's amount points may pay, in percent.
  final double maxRedeemPercent;

  /// Months until earned points expire; 0 when they do not.
  final int expiryMonths;

  static PointsProgram fromMap(Map raw) => PointsProgram(
        earnPoints: _int(raw['earn_points']),
        earnPerLkr: _num(raw['earn_per_lkr']),
        lkrPerPoint: _num(raw['lkr_per_point']),
        minRedeemPoints: _int(raw['min_redeem_points']),
        maxRedeemPercent: _num(raw['max_redeem_percent']),
        expiryMonths: _int(raw['expiry_months']),
      );

  /// Points an order with [itemsAfterDiscount] of items would earn:
  /// floor(items / earn_per_lkr) * earn_points. An estimate; the server
  /// awards them when the order is delivered.
  int earnEstimate(double itemsAfterDiscount) {
    if (earnPerLkr <= 0 || earnPoints <= 0 || itemsAfterDiscount <= 0) return 0;
    return (itemsAfterDiscount / earnPerLkr).floor() * earnPoints;
  }

  /// The points [balance] could pay on an order of [due] (subtotal +
  /// delivery fee - discount): min(balance, floor(due * max% / lkr_per_point)).
  int usablePoints({required int balance, required double due}) {
    if (balance < minRedeemPoints || balance <= 0 || lkrPerPoint <= 0 || due <= 0) return 0;
    final cap = ((due * maxRedeemPercent / 100) / lkrPerPoint).floor();
    final usable = balance < cap ? balance : cap;
    return usable < 0 ? 0 : usable;
  }

  /// What [points] are worth, to the cent.
  double valueOf(int points) => (points * lkrPerPoint * 100).round() / 100;

  /// "How it works", from the numbers.
  List<String> get howItWorks => [
        if (earnPoints > 0 && earnPerLkr > 0)
          'Earn $earnPoints ${earnPoints == 1 ? 'point' : 'points'} for every ${formatLkr(earnPerLkr)} you spend on items, once your order is delivered.',
        if (lkrPerPoint > 0) 'Each point is worth ${formatLkr(lkrPerPoint, alwaysShowCents: lkrPerPoint % 1 != 0)} at checkout.',
        if (minRedeemPoints > 0) 'Use points once you have $minRedeemPoints or more.',
        if (maxRedeemPercent > 0) 'Points can pay up to ${_percent(maxRedeemPercent)} of an order.',
        if (expiryMonths > 0)
          'Points expire $expiryMonths ${expiryMonths == 1 ? 'month' : 'months'} after you earn them.',
      ];

  static String _percent(double v) => '${v.toStringAsFixed(2).replaceFirst(RegExp(r'\.?0+$'), '')}%';
}

/// The points block on `GET /orders/checkout-info`.
@immutable
class CheckoutPoints {
  const CheckoutPoints({required this.enabled, required this.balance, required this.valueLkr, required this.program});

  final bool enabled;
  final int balance;
  final double valueLkr;
  final PointsProgram program;

  static CheckoutPoints? tryParse(Object? raw) {
    if (raw is! Map || raw['enabled'] is! bool) return null;
    return CheckoutPoints(
      enabled: raw['enabled'] as bool,
      balance: _int(raw['balance']),
      valueLkr: _num(raw['value_lkr']),
      program: PointsProgram.fromMap(raw),
    );
  }

  /// Checkout offers "Use points".
  bool get canRedeem => enabled && balance > 0 && balance >= program.minRedeemPoints;

  @override
  bool operator ==(Object other) =>
      other is CheckoutPoints && other.enabled == enabled && other.balance == balance && other.valueLkr == valueLkr;

  @override
  int get hashCode => Object.hash(enabled, balance, valueLkr);
}

enum PointsEntryKind { earn, redeem, refund, expire, adjust }

/// One line of the points history.
@immutable
class PointsEntry {
  const PointsEntry({
    required this.id,
    required this.kind,
    required this.points,
    this.orderNumber,
    this.expiresAt,
    this.createdAt,
  });

  final String id;
  final PointsEntryKind kind;

  /// Signed: + earned / returned, - used / expired.
  final int points;
  final String? orderNumber;
  final DateTime? expiresAt;
  final DateTime? createdAt;

  static PointsEntry? tryParse(Object? raw) {
    if (raw is! Map) return null;
    final kind = switch (raw['kind']?.toString().toUpperCase()) {
      'EARN' => PointsEntryKind.earn,
      'REDEEM' => PointsEntryKind.redeem,
      'REFUND' => PointsEntryKind.refund,
      'EXPIRE' => PointsEntryKind.expire,
      'ADJUST' => PointsEntryKind.adjust,
      _ => null,
    };
    if (kind == null) return null;
    final order = raw['order_number']?.toString().trim();
    return PointsEntry(
      id: (raw['id'] ?? '').toString(),
      kind: kind,
      points: _int(raw['points']),
      orderNumber: order == null || order.isEmpty ? null : order,
      expiresAt: raw['expires_at'] is String ? DateTime.tryParse(raw['expires_at'] as String)?.toLocal() : null,
      createdAt: raw['created_at'] is String ? DateTime.tryParse(raw['created_at'] as String)?.toLocal() : null,
    );
  }

  /// "Earned on order BL-1001", "Used on order BL-1002", ...
  String get label => switch (kind) {
        PointsEntryKind.earn => orderNumber == null ? 'Earned' : 'Earned on order $orderNumber',
        PointsEntryKind.redeem => orderNumber == null ? 'Used on an order' : 'Used on order $orderNumber',
        PointsEntryKind.refund => 'Returned (order cancelled)',
        PointsEntryKind.expire => 'Expired',
        PointsEntryKind.adjust => 'Adjusted by Blynk',
      };

  /// "+40" / "-120".
  String get pointsLabel => points > 0 ? '+$points' : '$points';
}

/// `GET /me/points`'s `data`.
@immutable
class PointsInfo {
  const PointsInfo({
    required this.enabled,
    required this.balance,
    required this.valueLkr,
    this.program,
    this.history = const [],
  });

  final bool enabled;
  final int balance;
  final double valueLkr;
  final PointsProgram? program;
  final List<PointsEntry> history;

  static PointsInfo? tryParse(Object? raw) {
    if (raw is! Map || raw['enabled'] is! bool) return null;
    final history = raw['history'] is List ? raw['history'] as List : const [];
    return PointsInfo(
      enabled: raw['enabled'] as bool,
      balance: _int(raw['balance']),
      valueLkr: _num(raw['value_lkr']),
      program: raw['program'] is Map ? PointsProgram.fromMap(raw['program'] as Map) : null,
      history: history.map(PointsEntry.tryParse).whereType<PointsEntry>().toList(),
    );
  }

  /// "120 Blynk Points = LKR 120".
  String get balanceText => pointsBalanceText(balance, valueLkr);
}

/// "120 Blynk Points = LKR 120" ("1 Blynk Point = ...").
String pointsBalanceText(int balance, double valueLkr) =>
    '$balance Blynk ${balance == 1 ? 'Point' : 'Points'} = ${formatLkr(valueLkr)}';

/// "14 March 2027".
String formatPointsDate(DateTime d) => '${d.day} ${monthNames[d.month - 1]} ${d.year}';
