import 'package:flutter/material.dart';

import 'package:ecom/Infrastructure/HttpMethods/requesting_methods.dart';
import 'package:ecom/Models/address_model.dart';
import 'package:ecom/Services/app_errors.dart';

/// A request against the addresses API. Defaults to the app's ApiService;
/// injectable so tests can supply the customer's addresses without a network.
typedef AddressRequest = Future<dynamic> Function({
  String? methodType,
  String? url,
  dynamic body,
});

class AddressProvider extends ChangeNotifier {
  AddressProvider({AddressRequest? request})
      : _request = request ?? ApiService.requestMethods;

  final AddressRequest _request;

  List<AddressModel> _addresses = [];
  bool _isLoading = false;
  CustomerError? _failure;

  List<AddressModel> get addresses => _addresses;
  bool get isLoading => _isLoading;
  String? get errorMessage => _failure?.message;

  /// The customer-facing reason loading the list failed, or null.
  CustomerError? get failure => _failure;

  /// Why the last save, delete or default change failed, or null. Kept
  /// apart from [failure] so a refused save (say, outside the delivery area)
  /// never replaces the address list with "couldn't load your addresses".
  CustomerError? get saveFailure => _saveFailure;
  CustomerError? _saveFailure;

  AddressModel? get defaultAddress {
    for (final a in _addresses) {
      if (a.isDefault) return a;
    }
    return _addresses.isNotEmpty ? _addresses.first : null;
  }

  /// Forgets the signed-in customer's addresses (logout / session end).
  void clear() {
    _addresses = [];
    _isLoading = false;
    _failure = null;
    _saveFailure = null;
    notifyListeners();
  }

  Future<void> loadAddresses() async {
    _isLoading = true;
    _failure = null;
    notifyListeners();

    try {
      final response = await _request(
        methodType: 'GET',
        url: '/me/addresses',
      );
      final data = (response is Map ? response['data'] : null) as Map?;
      final raw = (data?['addresses'] as List?) ?? const [];
      _addresses =
          raw.map((a) => AddressModel.fromJson(a as Map<String, dynamic>)).toList();
    } catch (e) {
      _failure = AppErrors.from(e);
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  Future<AddressModel?> createAddress(AddressModel address) async {
    _saveFailure = null;
    try {
      final response = await _request(
        methodType: 'POST',
        url: '/me/addresses',
        body: address.toCreatePayload(),
      );
      final data = (response is Map ? response['data'] : null) as Map?;
      final rawAddress = data?['address'] as Map?;
      if (rawAddress == null) return null;
      final created = AddressModel.fromJson(rawAddress.cast<String, dynamic>());
      _addresses = [..._addresses, created];
      notifyListeners();
      return created;
    } catch (e) {
      _saveFailure = AppErrors.from(e);
      notifyListeners();
      rethrow;
    }
  }

  Future<AddressModel?> updateAddress(
    String id,
    Map<String, dynamic> changes,
  ) async {
    _saveFailure = null;
    try {
      final response = await _request(
        methodType: 'PATCH',
        url: '/me/addresses/$id',
        body: changes,
      );
      final data = (response is Map ? response['data'] : null) as Map?;
      final rawAddress = data?['address'] as Map?;
      if (rawAddress == null) return null;
      final updated = AddressModel.fromJson(rawAddress.cast<String, dynamic>());
      _addresses = _addresses.map((a) => a.id == id ? updated : a).toList();
      notifyListeners();
      return updated;
    } catch (e) {
      _saveFailure = AppErrors.from(e);
      notifyListeners();
      rethrow;
    }
  }

  Future<void> deleteAddress(String id) async {
    _saveFailure = null;
    try {
      await _request(
        methodType: 'DELETE',
        url: '/me/addresses/$id',
      );
      _addresses = _addresses.where((a) => a.id != id).toList();
      notifyListeners();
    } catch (e) {
      _saveFailure = AppErrors.from(e);
      notifyListeners();
      rethrow;
    }
  }

  Future<void> setDefaultAddress(String id) async {
    _saveFailure = null;
    try {
      await _request(
        methodType: 'POST',
        url: '/me/addresses/$id/default',
      );
      _addresses = _addresses
          .map((a) => AddressModel(
                id: a.id,
                label: a.label,
                recipientName: a.recipientName,
                recipientPhone: a.recipientPhone,
                alternatePhone: a.alternatePhone,
                addressLine1: a.addressLine1,
                addressLine2: a.addressLine2,
                city: a.city,
                postalCode: a.postalCode,
                latitude: a.latitude,
                longitude: a.longitude,
                deliveryInstructions: a.deliveryInstructions,
                isDefault: a.id == id,
              ))
          .toList();
      notifyListeners();
    } catch (e) {
      _saveFailure = AppErrors.from(e);
      notifyListeners();
      rethrow;
    }
  }
}
