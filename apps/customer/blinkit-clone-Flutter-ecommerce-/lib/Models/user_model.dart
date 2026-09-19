import 'dart:convert';

class UserModel {
  final String id;
  final String phone;
  final String? email;
  final String? fullName;
  final String role;
  final bool isActive;
  final String? createdAt;

  UserModel({
    required this.id,
    required this.phone,
    this.email,
    this.fullName,
    required this.role,
    this.isActive = true,
    this.createdAt,
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
    };
  }

  String toJsonString() => jsonEncode(toJson());

  factory UserModel.fromJsonString(String source) =>
      UserModel.fromJson(jsonDecode(source) as Map<String, dynamic>);

  @override
  String toString() {
    return 'UserModel(id: $id, phone: $phone, fullName: $fullName, role: $role)';
  }
}
