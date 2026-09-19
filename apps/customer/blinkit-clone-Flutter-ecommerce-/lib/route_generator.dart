import 'package:flutter/material.dart';

import 'package:ecom/Screens/Auth/login_screen.dart';
import 'package:ecom/Screens/Auth/otp_verification_screen.dart';
import 'package:ecom/Screens/app_about_screen.dart';
import 'package:ecom/Screens/cart_gift_screen.dart';
import 'package:ecom/Screens/categories_screen.dart';
import 'package:ecom/Screens/checkout_screen.dart';
import 'package:ecom/Screens/customer_shell.dart';
import 'package:ecom/Screens/error_screen.dart';
import 'package:ecom/Screens/help_screen.dart';
import 'package:ecom/Screens/search_screen.dart';
import 'package:ecom/Screens/product_details_screen.dart';
import 'package:ecom/Models/product_model.dart';
import 'package:ecom/Screens/order_confirmation_screen.dart';
import 'package:ecom/Screens/order_summary_screen.dart';
import 'package:ecom/Screens/pdf_view_screen.dart';
import 'package:ecom/Screens/products_screen.dart';
import 'package:ecom/Screens/profile_screen.dart';
import 'package:ecom/Screens/user_address_screen.dart';
import 'package:ecom/Screens/user_cart_screen.dart';
import 'package:ecom/Screens/user_orders_screen.dart';
import 'package:ecom/Screens/coupons_screeen.dart';

class AppRouter {
  static Route<dynamic>? generateRoute(RouteSettings settings) {
    switch (settings.name) {
      case '/':
        return MaterialPageRoute(
          settings: settings,
          builder: (_) => const LoginScreen(),
        );
      case '/otp/verify':
        return MaterialPageRoute(
          settings: settings,
          builder: (_) => OTPVerificationScreen(
            data: settings.arguments,
          ),
        );
      // '/home' is the persistent four-tab customer shell (Shop / Orders /
      // Help / Profile), not a bare Home page - every existing
      // pushNamedAndRemoveUntil('/home', ...) call lands on the Shop tab.
      case '/home':
        return MaterialPageRoute(
          settings: settings,
          builder: (_) => const CustomerShell(),
        );
      case '/categories':
        return MaterialPageRoute(
          settings: settings,
          builder: (_) => const CategoriesScreen(),
        );
      case '/search':
        return MaterialPageRoute(
          settings: settings,
          builder: (_) => SearchScreen(
            initialCategorySlug: settings.arguments as String?,
          ),
        );
      // Accepts the tapped ProductModel (renders instantly, then refreshes)
      // or a bare product id.
      case '/product':
        final args = settings.arguments;
        final initial = args is ProductModel ? args : null;
        return MaterialPageRoute(
          settings: settings,
          builder: (_) => ProductDetailsScreen(
            productId: initial?.id ?? (args is String ? args : ''),
            initialProduct: initial,
          ),
        );
      case '/help':
        return MaterialPageRoute(
          settings: settings,
          builder: (_) => const HelpScreen(),
        );
      case '/products':
        return MaterialPageRoute(
          settings: settings,
          builder: (_) => ProductsScreen(
            categorySlug: (settings.arguments as String?) ?? '',
          ),
        );
      case '/coupons':
        return MaterialPageRoute(
          settings: settings,
          builder: (_) => const CouponsSelectionScreen(),
        );

      case "/cart/gift":
        return MaterialPageRoute(
          settings: settings,
          builder: (_) => const CartGiftScreen(),
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
      case "/orders":
        return MaterialPageRoute(
          settings: settings,
          builder: (_) => const OrdersScreen(),
        );
      case "/order":
        return MaterialPageRoute(
          settings: settings,
          builder: (_) => OrderSummaryScreen(
            orderId: (settings.arguments as String?) ?? '',
          ),
        );
      case "/order/invoice":
        return MaterialPageRoute(
          settings: settings,
          builder: (_) => const ViewOrderInvoiceScreen(),
        );
      case "/order/confirm":
        return MaterialPageRoute(
          settings: settings,
          builder: (_) => const OrderConfirmationScreen(),
        );

      case '/profile':
        return MaterialPageRoute(
          settings: settings,
          builder: (_) => const ProfileScreen(),
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
      default:
        return MaterialPageRoute(
          settings: settings,
          builder: (_) => const ErrorScreem(),
        );
    }
  }
}

enum AnimationDirection {
  leftToRight,
  rightToLeft,
  center,
}

class ScalePageRoute extends PageRouteBuilder {
  final WidgetBuilder builder;
  final AnimationDirection animationDirection;

  ScalePageRoute({
    required this.builder,
    this.animationDirection = AnimationDirection.center,
  }) : super(
          transitionDuration: const Duration(milliseconds: 300),
          pageBuilder: (BuildContext context, Animation<double> animation,
              Animation<double> secondaryAnimation) {
            return builder(context);
          },
          transitionsBuilder: (BuildContext context,
              Animation<double> animation,
              Animation<double> secondaryAnimation,
              Widget child) {
            switch (animationDirection) {
              case AnimationDirection.leftToRight:
                return SlideTransition(
                  position: Tween<Offset>(
                    begin: const Offset(-1.0, 0.0),
                    end: Offset.zero,
                  ).animate(animation),
                  child: child,
                );
              case AnimationDirection.rightToLeft:
                return SlideTransition(
                  position: Tween<Offset>(
                    begin: const Offset(1.0, 0.0),
                    end: Offset.zero,
                  ).animate(animation),
                  child: child,
                );
              case AnimationDirection.center:
                return ScaleTransition(
                  scale: Tween<double>(
                    begin: 0.0,
                    end: 1.0,
                  ).animate(
                    CurvedAnimation(
                      parent: animation,
                      curve: Curves.fastOutSlowIn,
                    ),
                  ),
                  child: child,
                );
            }
          },
        );
}
