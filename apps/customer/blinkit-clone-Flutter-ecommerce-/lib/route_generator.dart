import 'package:flutter/material.dart';

import 'package:ecom/Screens/Auth/login_screen.dart';
import 'package:ecom/Screens/Auth/otp_verification_screen.dart';
import 'package:ecom/Screens/app_about_screen.dart';
import 'package:ecom/Screens/categories_screen.dart';
import 'package:ecom/Screens/checkout_screen.dart';
import 'package:ecom/Screens/customer_shell.dart';
import 'package:ecom/Screens/dental_appointment_detail_screen.dart';
import 'package:ecom/Screens/dental_clinic_detail_screen.dart';
import 'package:ecom/Screens/dental_clinics_screen.dart';
import 'package:ecom/Screens/dental_doctor_profile_screen.dart';
import 'package:ecom/Screens/dental_my_appointments_screen.dart';
import 'package:ecom/Screens/dental_slot_picker_screen.dart';
import 'package:ecom/Screens/not_found_screen.dart';
import 'package:ecom/Screens/search_screen.dart';
import 'package:ecom/Screens/session_gate.dart';
import 'package:ecom/Screens/product_details_screen.dart';
import 'package:ecom/Models/product_model.dart';
import 'package:ecom/Services/share_links.dart';
import 'package:ecom/Screens/order_confirmation_screen.dart';
import 'package:ecom/Screens/order_summary_screen.dart';
import 'package:ecom/Screens/products_screen.dart';
import 'package:ecom/Screens/user_address_screen.dart';
import 'package:ecom/Screens/user_cart_screen.dart';
import 'package:ecom/Screens/Auth/name_capture_screen.dart';

class AppRouter {
  static Route<dynamic>? generateRoute(RouteSettings settings) {
    switch (settings.name) {
      // The start route decides local-first between the shop and the login
      // screen; '/login' is the login screen itself (a guest logging in later,
      // or a session that ended).
      case '/':
        return MaterialPageRoute(
          settings: settings,
          builder: (_) => const SessionGate(),
        );
      case '/login':
        return MaterialPageRoute(
          settings: settings,
          builder: (_) => const LoginScreen(),
        );
      case NameCaptureScreen.route:
        return MaterialPageRoute(settings: settings, builder: (_) => const NameCaptureScreen());
      case '/otp/verify':
        return MaterialPageRoute(
          settings: settings,
          builder: (_) => OTPVerificationScreen(
            data: settings.arguments,
          ),
        );
      // '/home' is the persistent four-tab customer shell (Shop / Orders /
      // Help / Profile), not a bare Home page - it lands on the Shop tab
      // unless the tab index is passed as the argument. Orders, Help and
      // Profile are tabs only: CustomerShell.selectTab opens them.
      case '/home':
        final tab = settings.arguments;
        return MaterialPageRoute(
          settings: settings,
          builder: (_) => CustomerShell(initialTab: tab is int ? tab : 0),
        );
      case '/categories':
        return MaterialPageRoute(
          settings: settings,
          builder: (_) => const CategoriesScreen(),
        );
      case '/search':
        final searchArg = settings.arguments;
        if (searchArg != null && searchArg is! String) return _notFound(settings);
        return MaterialPageRoute(
          settings: settings,
          builder: (_) => SearchScreen(
            initialCategorySlug: searchArg as String?,
          ),
        );
      // Accepts the tapped ProductModel (renders instantly, then refreshes)
      // or a bare product id. Neither, or an empty id, is not-found at once
      // instead of a skeleton that never resolves.
      case '/product':
        final args = settings.arguments;
        final initial = args is ProductModel ? args : null;
        final productId = initial?.id ?? (args is String ? args : '');
        if (productId.trim().isEmpty) return _notFound(settings);
        return MaterialPageRoute(
          settings: settings,
          builder: (_) => ProductDetailsScreen(
            productId: productId,
            initialProduct: initial,
          ),
        );
      case '/products':
        // No argument means "all products"; any other type is not-found.
        final slug = settings.arguments;
        if (slug != null && slug is! String) return _notFound(settings);
        return MaterialPageRoute(
          settings: settings,
          builder: (_) => ProductsScreen(
            categorySlug: (slug as String?) ?? '',
          ),
        );
      case "/cart":
        return MaterialPageRoute(
          settings: settings,
          builder: (_) => const CartScreen(),
        );
      case '/checkout':
        return MaterialPageRoute(
          settings: settings,
          builder: (_) => const CheckoutScreen(),
        );
      case "/order":
        final orderId = settings.arguments;
        if (orderId is! String || orderId.trim().isEmpty) return _notFound(settings);
        return MaterialPageRoute(
          settings: settings,
          builder: (_) => OrderSummaryScreen(orderId: orderId),
        );
      case "/order/confirm":
        return MaterialPageRoute(
          settings: settings,
          builder: (_) => const OrderConfirmationScreen(),
        );
      case '/user/address':
        return MaterialPageRoute(
          settings: settings,
          builder: (_) => const UserAddressScreen(),
        );
      case '/app/about':
        return MaterialPageRoute(
          settings: settings,
          builder: (_) => const AppAboutScreen(),
        );
      // --- Dental clinic appointments (task F5) ---------------------------
      case '/dental/clinics':
        return MaterialPageRoute(
          settings: settings,
          builder: (_) => const DentalClinicsScreen(),
        );
      // Bare clinic id, mirroring '/order's argument style exactly. The
      // route string itself is '/dental/clinic' (singular) - the exact
      // spelling F2's clinic-list row already pushes
      // (dental_clinics_screen.dart), kept as-is rather than renamed to the
      // brief's sketched '/dental/clinics/detail', so no F2 call site needs
      // touching; see task-F5-report.md for the full reconciliation note.
      case '/dental/clinic':
        final clinicId = settings.arguments;
        if (clinicId is! String || clinicId.trim().isEmpty) return _notFound(settings);
        return MaterialPageRoute(
          settings: settings,
          builder: (_) => DentalClinicDetailScreen(clinicId: clinicId),
        );
      // {doctorId, clinicId} map, exactly what dental_clinic_detail_screen.dart's
      // doctor row and DentalDoctorProfileScreen's constructor already agree on.
      case '/dental/doctor':
        final args = _dentalPairArgs(settings.arguments);
        if (args == null) return _notFound(settings);
        return MaterialPageRoute(
          settings: settings,
          builder: (_) => DentalDoctorProfileScreen(
            doctorId: args.doctorId,
            clinicId: args.clinicId,
          ),
        );
      // Same {doctorId, clinicId} shape - dental_doctor_profile_screen.dart's
      // "Book appointment" CTA and DentalSlotPickerScreen's constructor both
      // use it (task-F2-report.md / task-F3-report.md).
      case '/dental/book':
        final args = _dentalPairArgs(settings.arguments);
        if (args == null) return _notFound(settings);
        return MaterialPageRoute(
          settings: settings,
          builder: (_) => DentalSlotPickerScreen(
            doctorId: args.doctorId,
            clinicId: args.clinicId,
          ),
        );
      case '/dental/appointments':
        return MaterialPageRoute(
          settings: settings,
          builder: (_) => const DentalMyAppointmentsScreen(),
        );
      // Bare appointment id, mirroring '/order's argument style exactly
      // (including the empty-string check) - the shape
      // dental_booking_confirmation_screen.dart's "View appointment" CTA and
      // dental_my_appointments_screen.dart's row tap both already push.
      case '/dental/appointments/detail':
        final appointmentId = settings.arguments;
        if (appointmentId is! String || appointmentId.trim().isEmpty) {
          return _notFound(settings);
        }
        return MaterialPageRoute(
          settings: settings,
          builder: (_) => DentalAppointmentDetailScreen(appointmentId: appointmentId),
        );
      default:
        // A shared product link, `/p/<id>` (see ShareLinks).
        final sharedId = ShareLinks.productIdFromRoute(settings.name);
        if (sharedId != null) {
          return MaterialPageRoute(
            settings: settings,
            builder: (_) => ProductDetailsScreen(productId: sharedId),
          );
        }
        return _notFound(settings);
    }
  }

  /// The first screen of a launch. A launch from a shared product link still
  /// starts at the start route (intro, then shop or login) and opens the
  /// product on top of it; every other launch is the start route as before.
  static List<Route<dynamic>> generateInitialRoutes(String initialRoute) {
    final sharedId = ShareLinks.productIdFromRoute(initialRoute);
    return [
      MaterialPageRoute(
        settings: const RouteSettings(name: '/'),
        builder: (_) => SessionGate(pendingProductId: sharedId),
      ),
    ];
  }

  /// Shared {doctorId, clinicId} argument shape for '/dental/doctor' and
  /// '/dental/book' - both present and non-empty, or null (caller returns
  /// not-found). A record, not a class, since this is purely internal.
  static ({String doctorId, String clinicId})? _dentalPairArgs(Object? arguments) {
    if (arguments is! Map) return null;
    final doctorId = arguments['doctorId'];
    final clinicId = arguments['clinicId'];
    if (doctorId is! String || doctorId.trim().isEmpty) return null;
    if (clinicId is! String || clinicId.trim().isEmpty) return null;
    return (doctorId: doctorId, clinicId: clinicId);
  }

  static Route<dynamic> _notFound(RouteSettings settings) => MaterialPageRoute(
        settings: settings,
        builder: (_) => const NotFoundScreen(),
      );
}
