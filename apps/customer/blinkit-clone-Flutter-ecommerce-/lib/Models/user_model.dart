import 'dart:convert';

/// The language a customer gets offer SMS in (GET/PATCH /me `sms_language`).
/// Each label is the language in its own script, with English alongside.
enum SmsLanguage {
  sinhala('si', 'සිංහල (Sinhala)'),
  tamil('ta', 'தமிழ் (Tamil)'),
  english('en', 'English');

  const SmsLanguage(this.wire, this.label);

  /// What the backend stores and accepts.
  final String wire;

  /// What the choice row says.
  final String label;

  /// The language for a wire value, or null when none was picked (or the
  /// value is one this app does not know).
  static SmsLanguage? fromWire(Object? value) {
    for (final language in values) {
      if (language.wire == value) return language;
    }
    return null;
  }
}

class UserModel {
  final String id;
  final String phone;
  final String? email;
  final String? fullName;
  final String role;
  final bool isActive;
  final String? createdAt;

  /// The language offer SMS are sent in; null until the customer picks one.
  final SmsLanguage? smsLanguage;

  /// True while the customer receives offer SMS (the backend's default).
  /// Order-update SMS are not affected.
  final bool smsOffers;

  UserModel({
    required this.id,
    required this.phone,
    this.email,
    this.fullName,
    required this.role,
    this.isActive = true,
    this.createdAt,
    this.smsLanguage,
    this.smsOffers = true,
  });

  factory UserModel.fromJson(Map<String, dynamic> json) {
    return UserModel(
      id: (json['id'] ?? '').toString(),
      phone: (json['phone'] ?? '').toString(),
      email: json['email']?.toString(),
      fullName: (json['full_name'] ?? json['fullName'])?.toString(),
      role: (json['role'] ?? 'CUSTOMER').toString(),
      isActive: json['is_active'] == true || json['isActive'] == true,
      createdAt: (json['created_at'] ?? json['createdAt'])?.toString(),
      smsLanguage: SmsLanguage.fromWire(json['sms_language']),
      // Only an explicit false is an opt-out: a payload without the field
      // (GET /auth/me, an older saved session) keeps the default.
      smsOffers: json['sms_offers'] != false,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'phone': phone,
      'email': email,
      'full_name': fullName,
      'role': role,
      'is_active': isActive,
      'created_at': createdAt,
      'sms_language': smsLanguage?.wire,
      'sms_offers': smsOffers,
    };
  }

  String toJsonString() => jsonEncode(toJson());

  factory UserModel.fromJsonString(String source) =>
      UserModel.fromJson(jsonDecode(source) as Map<String, dynamic>);

  /// This profile with the SMS preferences replaced. [smsLanguage] is only
  /// replaced when given; the backend has no way to clear it.
  UserModel copyWithSms({SmsLanguage? smsLanguage, bool? smsOffers}) => UserModel(
        id: id,
        phone: phone,
        email: email,
        fullName: fullName,
        role: role,
        isActive: isActive,
        createdAt: createdAt,
        smsLanguage: smsLanguage ?? this.smsLanguage,
        smsOffers: smsOffers ?? this.smsOffers,
      );

  @override
  String toString() {
    return 'UserModel(id: $id, phone: $phone, fullName: $fullName, role: $role)';
  }
}
