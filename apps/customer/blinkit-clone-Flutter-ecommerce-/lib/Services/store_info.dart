/// Blynk's single-hub business facts, in one place.
///
/// The backend owns every value here, so each one mirrors its authority below;
/// nothing else should hard-code these facts. The delivery fee is live: the
/// public `GET /store` feeds `StoreInfoProvider`, and [defaultDeliveryFee] is
/// only its fallback. The other facts here are still constants.
abstract final class StoreInfo {
  /// The one dark-store hub; also the default city of a new address.
  static const String hubName = 'Dharga Town';

  static const String country = 'Sri Lanka';

  /// Mirrors the delivery window constant in the backend `utils/time.ts`.
  static const String deliveryHoursLabel = '8 AM – 9 PM';

  /// When ordering opens each morning (the start of [deliveryHoursLabel]).
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

  /// No customer support channel exists yet (decision D5), so this is
  /// deliberately null: callers must not show a contact line.
  static const String? supportContact = null;
}
