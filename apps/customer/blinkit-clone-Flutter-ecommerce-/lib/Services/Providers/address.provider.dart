import 'package:flutter/material.dart';

import 'package:ecom/Infrastructure/HttpMethods/requesting_methods.dart';
import 'package:ecom/Models/address_model.dart';
import 'package:ecom/Services/Exceptions/api_exception.dart';

class AddressProvider extends ChangeNotifier {
  List<AddressModel> _addresses = [];
  bool _isLoading = false;
  String? _errorMessage;

  List<AddressModel> get addresses => _addresses;
  bool get isLoading => _isLoading;
  String? get errorMessage => _errorMessage;

  AddressModel? get defaultAddress {
    for (final a in _addresses) {
      if (a.isDefault) return a;
    }
    return _addresses.isNotEmpty ? _addresses.first : null;
  }

  Future<void> loadAddresses() async {
    _isLoading = true;
    _errorMessage = null;
    notifyListeners();

    try {
      final response = await ApiService.requestMethods(
        methodType: 'GET',
        url: '/me/addresses',
      );
      final data = (response is Map ? response['data'] : null) as Map?;
      final raw = (data?['addresses'] as List?) ?? const [];
      _addresses =
          raw.map((a) => AddressModel.fromJson(a as Map<String, dynamic>)).toList();
    } catch (e) {
      _errorMessage = e is ApiException ? e.message : e.toString();
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  Future<AddressModel?> createAddress(AddressModel address) async {
    _errorMessage = null;
    try {
      final response = await ApiService.requestMethods(
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
      _errorMessage = e is ApiException ? e.message : e.toString();
      notifyListeners();
      rethrow;
    }
  }

  Future<AddressModel?> updateAddress(
    String id,
    Map<String, dynamic> changes,
  ) async {
    _errorMessage = null;
    try {
      final response = await ApiService.requestMethods(
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
      _errorMessage = e is ApiException ? e.message : e.toString();
      notifyListeners();
      rethrow;
    }
  }

  Future<void> deleteAddress(String id) async {
    _errorMessage = null;
    try {
      await ApiService.requestMethods(
        methodType: 'DELETE',
        url: '/me/addresses/$id',
      );
      _addresses = _addresses.where((a) => a.id != id).toList();
      notifyListeners();
    } catch (e) {
      _errorMessage = e is ApiException ? e.message : e.toString();
      notifyListeners();
      rethrow;
    }
  }

  Future<void> setDefaultAddress(String id) async {
    _errorMessage = null;
    try {
      await ApiService.requestMethods(
        methodType: 'POST',
        url: '/me/addresses/$id/default',
      );
      _addresses = _addresses
          .map((a) => AddressModel(
                id: a.id,
                label: a.label,
                recipientName: a.recipientName,
                recipientPhone: a.recipientPhone,
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
      _errorMessage = e is ApiException ? e.message : e.toString();
      notifyListeners();
      rethrow;
    }
  }
}
