import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../Services/Providers/address.provider.dart';
import '../../../Services/Providers/auth.provider.dart';
import '../../../Services/Providers/cart.provider.dart';
import '../../../Services/Providers/location.provider.dart';
import '../../../Services/Providers/order.provider.dart';
import '../../../Services/app_errors.dart';
import '../../../Services/app_session_cleaner.dart';
import '../../../design/tokens.dart';
import '../Atoms/adaptive_sheet.dart';
import '../Atoms/app_toast.dart';
import '../Atoms/blynk_button.dart';

/// Asks the customer to confirm, deletes the account (DELETE /me) and, once
/// the server has done it, signs out on this device the way a logout does:
/// every piece of user-scoped state is cleared and the login screen replaces
/// the whole stack. A refusal (an open order) or a network failure is shown
/// inside the sheet and the customer stays signed in.
Future<void> showDeleteAccountDialog(BuildContext context) async {
  // Everything the sign-out needs is taken from [context] before any await.
  final auth = context.read<AuthProvider>();
  final addresses = context.read<AddressProvider>();
  final orders = context.read<OrderProvider>();
  final cart = context.read<CartProvider>();
  final location = context.read<LocationProvider>();
  final navigator = Navigator.of(context);
  final deleted = await showAdaptiveSheet<bool>(
    context,
    semanticLabel: 'Delete account',
    builder: (_) => DeleteAccountSheet(onDelete: auth.deleteAccount),
  );
  if (deleted != true) return;

  AppSessionCleaner.clearProviders(
    addresses: addresses,
    orders: orders,
    cart: cart,
    location: location,
  );
  navigator.pushNamedAndRemoveUntil('/login', (_) => false);
  showAppToast(msg: DeleteAccountSheet.doneMessage);
}

/// The delete-account confirmation. Runs [onDelete] when the customer
/// confirms; pops `true` once it succeeds and `false` on "Cancel".
class DeleteAccountSheet extends StatefulWidget {
  const DeleteAccountSheet({super.key, required this.onDelete});

  /// Deletes the account: null on success, otherwise why it did not happen.
  final Future<CustomerError?> Function() onDelete;

  static const String title = 'Delete your account?';
  static const List<String> points = [
    'Your name, phone number, saved addresses and settings are removed, and you are logged out.',
    "Your past orders are kept for the store's records.",
    "This can't be undone.",
  ];
  static const String confirmLabel = 'Delete account';
  static const String doneMessage = 'Your account has been deleted.';

  @override
  State<DeleteAccountSheet> createState() => _DeleteAccountSheetState();
}

class _DeleteAccountSheetState extends State<DeleteAccountSheet> {
  bool _deleting = false;
  String? _error;

  Future<void> _delete() async {
    if (_deleting) return;
    setState(() {
      _deleting = true;
      _error = null;
    });
    final failure = await widget.onDelete();
    if (!mounted) return;
    if (failure == null) {
      Navigator.of(context).pop(true);
      return;
    }
    setState(() {
      _deleting = false;
      _error = failure.message;
    });
  }

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(BlynkSpace.s24, BlynkSpace.s8, BlynkSpace.s24, BlynkSpace.s24),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(DeleteAccountSheet.title, style: BlynkText.heading.copyWith(color: BlynkColors.ink)),
          const SizedBox(height: BlynkSpace.s12),
          for (final point in DeleteAccountSheet.points) ...[
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Padding(
                  padding: EdgeInsets.only(top: BlynkSpace.s4),
                  child: Icon(Icons.circle, size: BlynkSpace.s8, color: BlynkColors.ink2),
                ),
                const SizedBox(width: BlynkSpace.s8),
                Expanded(child: Text(point, style: BlynkText.body.copyWith(color: BlynkColors.ink2))),
              ],
            ),
            const SizedBox(height: BlynkSpace.s8),
          ],
          if (_error != null) ...[
            const SizedBox(height: BlynkSpace.s4),
            Semantics(
              liveRegion: true,
              child: Text(
                _error!,
                key: const Key('delete-account-error'),
                style: BlynkText.label.copyWith(color: BlynkColors.problem),
              ),
            ),
          ],
          const SizedBox(height: BlynkSpace.s16),
          BlynkButtonPair(
            secondary: BlynkButton.secondary(
              label: 'Cancel',
              onPressed: _deleting ? null : () => Navigator.of(context).pop(false),
            ),
            primary: BlynkButton.destructive(
              label: DeleteAccountSheet.confirmLabel,
              loading: _deleting,
              onPressed: _delete,
            ),
          ),
        ],
      ),
    );
  }
}
