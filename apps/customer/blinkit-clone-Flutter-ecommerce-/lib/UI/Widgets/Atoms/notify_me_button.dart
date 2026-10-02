import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'package:ecom/Services/Providers/auth.provider.dart';
import 'package:ecom/Services/Providers/product.provider.dart';
import 'package:ecom/Services/app_errors.dart';
import 'package:ecom/Services/push/push_notifications.dart';
import 'package:ecom/UI/Widgets/Atoms/app_toast.dart';
import 'package:ecom/UI/Widgets/Atoms/blynk_button.dart';
import 'package:ecom/design/tokens.dart';

/// Label before the customer asks.
const String kNotifyMeLabel = "Notify me when it's back";

/// Label once they have asked (tapping it again cancels).
const String kNotifyMeOnLabel = "We'll tell you when it's back";

/// "Notify me when it's back", on a sold-out product's page (phase 6).
///
/// A guest is sent to log in first: the alert is a push to the customer's
/// own phone. Asking turns notifications on (the system prompt, at a moment
/// that explains itself). Tapping again cancels the alert.
class NotifyMeButton extends StatelessWidget {
  const NotifyMeButton({super.key, required this.productId});

  final String productId;

  @override
  Widget build(BuildContext context) {
    final signedIn = context.select<AuthProvider, bool>((a) => a.isAuthenticated);
    final products = context.watch<ProductProvider>();
    final subscribed = signedIn && products.isNotifyMeSubscribed(productId);
    final busy = products.isNotifyMeBusy(productId);

    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        BlynkButton.secondary(
          key: const ValueKey('notify-me'),
          label: subscribed ? kNotifyMeOnLabel : kNotifyMeLabel,
          semanticLabel: subscribed ? '$kNotifyMeOnLabel. Tap to cancel.' : kNotifyMeLabel,
          leadingIcon: subscribed ? BlynkIcons.notifyMeOn : BlynkIcons.notifyMe,
          loading: busy,
          expand: true,
          onPressed: busy ? null : () => _toggle(context, signedIn: signedIn, subscribed: subscribed),
        ),
        if (subscribed) ...[
          const SizedBox(height: BlynkSpace.s4),
          Text(
            'Tap again if you no longer want the alert.',
            style: BlynkText.caption.copyWith(color: BlynkColors.ink2),
          ),
        ],
      ],
    );
  }

  Future<void> _toggle(BuildContext context, {required bool signedIn, required bool subscribed}) async {
    if (!signedIn) {
      unawaited(Navigator.of(context).pushNamed('/login'));
      return;
    }
    final products = context.read<ProductProvider>();
    try {
      await products.setNotifyMe(productId, !subscribed);
      if (!subscribed) unawaited(PushNotifications.instance.requestPermission());
    } catch (e) {
      showAppToast(msg: AppErrors.from(e).message);
    }
  }
}
