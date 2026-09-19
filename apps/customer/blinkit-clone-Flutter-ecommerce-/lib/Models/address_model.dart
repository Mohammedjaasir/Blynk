class AddressModel {
  final String id;
  final String label;
  final String recipientName;
  final String recipientPhone;
  final String addressLine1;
  final String? addressLine2;
  final String city;
  final String? postalCode;
  final double latitude;
  final double longitude;
  final String? deliveryInstructions;
  final bool isDefault;

  const AddressModel({
    required this.id,
    required this.label,
    required this.recipientName,
    required this.recipientPhone,
    required this.addressLine1,
    this.addressLine2,
    required this.city,
    this.postalCode,
    required this.latitude,
    required this.longitude,
    this.deliveryInstructions,
    this.isDefault = false,
  });

  factory AddressModel.fromJson(Map<String, dynamic> json) {
    return AddressModel(
      id: (json['id'] ?? '').toString(),
      label: (json['label'] ?? 'Home').toString(),
      recipientName: (json['recipient_name'] ?? json['recipientName'] ?? '').toString(),
      recipientPhone: (json['recipient_phone'] ?? json['recipientPhone'] ?? '').toString(),
      addressLine1: (json['address_line1'] ?? json['addressLine1'] ?? '').toString(),
      addressLine2: (json['address_line2'] ?? json['addressLine2'])?.toString(),
      city: (json['city'] ?? '').toString(),
      postalCode: (json['postal_code'] ?? json['postalCode'])?.toString(),
      latitude: double.tryParse((json['latitude'] ?? 0).toString()) ?? 0.0,
      longitude: double.tryParse((json['longitude'] ?? 0).toString()) ?? 0.0,
      deliveryInstructions:
          (json['delivery_instructions'] ?? json['deliveryInstructions'])?.toString(),
      isDefault: json['is_default'] == true || json['isDefault'] == true,
    );
  }

  Map<String, dynamic> toCreatePayload() => {
        'label': label,
        'recipient_name': recipientName,
        'recipient_phone': recipientPhone,
        'address_line1': addressLine1,
        'address_line2': addressLine2,
        'city': city,
        'postal_code': postalCode,
        'latitude': latitude,
        'longitude': longitude,
        'delivery_instructions': deliveryInstructions,
        'is_default': isDefault,
      };

  String get displaySummary =>
      [addressLine1, if (addressLine2 != null && addressLine2!.isNotEmpty) addressLine2, city]
          .join(', ');
}
