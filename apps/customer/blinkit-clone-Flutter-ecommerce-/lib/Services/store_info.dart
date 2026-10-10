/// Blynk's single-hub business facts, in one place.
///
/// The backend owns every value here, so each one mirrors its authority below;
/// nothing else should hard-code these facts. The delivery fee is live: the
/// public `GET /store` feeds `StoreInfoProvider`, and [defaultDeliveryFee] is
/// only its fallback. The store hours are live too since the timing became
/// Ops/Admin's to decide: [deliveryHoursLabel] and [opensAtLabel] are only
/// the fallback for `StoreInfoProvider.hoursLabel` / `opensAtLabel` (owner,
/// 2026-10-10). The other facts here are still constants.
abstract final class StoreInfo {
  /// The one dark-store hub; also the default city of a new address.
  static const String hubName = 'Dharga Town';

  static const String country = 'Sri Lanka';

  /// FALLBACK ONLY: the store's default hours. Ops/Admin now set the hours,
  /// so screens show the live label from `StoreInfoProvider.hoursLabel`
  /// (`delivery_hours` on GET /store) and use this only until /store has
  /// answered or when it cannot be reached (owner, 2026-10-10). This and
  /// [opensAtLabel] are the only hour literals allowed in lib/
  /// (test/store_info_test.dart).
  static const String deliveryHoursLabel = '8 AM – 9 PM';

  /// FALLBACK ONLY: when ordering opens (the start of [deliveryHoursLabel]);
  /// the live one is `StoreInfoProvider.opensAtLabel` (owner, 2026-10-10).
  static const String opensAtLabel = '8 AM';

  /// Mirrors `dark_stores.radius_km` (default 4.00).
  static const int serviceRadiusKm = 4;

  /// The fallback delivery fee, used until `GET /store` (or its cached last
  /// good answer) says otherwise. Mirrors `system_configurations.delivery_fee`
  /// (fee_lkr 100). Screens read the live fee from `StoreInfoProvider`, never
  /// this directly; the order's own `deliveryFee` is authoritative once an
  /// order exists.
  static const double defaultDeliveryFee = 100.0;

  /// The backend accepts cash on delivery only (`payment_method` is hard-coded COD).
  static const String paymentMethodLabel = 'Cash on delivery';

  /// Customer support, by phone and WhatsApp (owner, 2026-10-08).
  static const String supportPhone = '+94717107374';
  static const String supportPhoneLabel = '+94 71 710 7374';
  static const String supportWhatsAppUrl = 'https://wa.me/94717107374';
}
