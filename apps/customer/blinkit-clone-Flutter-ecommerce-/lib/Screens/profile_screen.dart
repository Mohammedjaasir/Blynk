import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:share_plus/share_plus.dart';

import 'package:ecom/Services/Providers/auth.provider.dart';
import 'package:ecom/design/tokens.dart';
import '../UI/Widgets/Atoms/list_tile.dart';
import '../UI/Widgets/Atoms/blynk_button.dart';
import '../UI/Widgets/Organisms/logout_dialog.dart';
import 'customer_shell.dart';
import 'feedback_screen.dart';
import 'sms_preferences_screen.dart';
import '../app_responsive.dart';

class ProfileScreen extends StatelessWidget {
  const ProfileScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final signedIn = context.select<AuthProvider, bool>((a) => a.isAuthenticated);

    return Scaffold(
      backgroundColor: BlynkColors.paper,
      appBar: AppBar(
        automaticallyImplyLeading: true,
        title: const Text('Profile'),
      ),
      body: ContentFrame(
        maxWidth: 720,
        gutter: false,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(
            BlynkSpace.s8,
            BlynkSpace.s4,
            BlynkSpace.s8,
            BlynkSpace.s32,
          ),
          children: [
            const _AccountHeader(),
            const SizedBox(height: BlynkSpace.s24),
            // A guest browses freely; logging in is one clear step, not a wall.
            if (!signedIn) ...[
              BlynkButton.primary(
                label: 'Log in',
                expand: true,
                onPressed: () => Navigator.of(context).pushNamed('/login'),
              ),
              const SizedBox(height: BlynkSpace.s16),
            ],
            customListTile(
              icon: BlynkIcons.orders,
              title: 'Your orders',
              callback: () => CustomerShell.selectTab(context, 1),
            ),
            customListTile(
              icon: BlynkIcons.addressBook,
              title: 'Address book',
              callback: () {
                Navigator.of(context).pushNamed('/user/address');
              },
            ),
            // Offer SMS end with "Blynk app > Profile > SMS & offers", so the
            // switch lives one tap from here. A guest is sent to log in first.
            customListTile(
              icon: BlynkIcons.sms,
              title: 'SMS & offers',
              callback: () => SmsPreferencesScreen.open(context),
            ),
            // The appointment list is the customer's own and the backend
            // scopes it to them, so it is offered only once they are signed
            // in rather than opening onto a 401.
            if (signedIn)
              customListTile(
                icon: BlynkIcons.dental,
                title: 'My appointments',
                callback: () {
                  Navigator.of(context).pushNamed('/dental/appointments');
                },
              ),
            // Offered to guests too: FeedbackScreen.open sends them to log
            // in first, like the app's other signed-in-only actions.
            customListTile(
              icon: BlynkIcons.feedback,
              title: 'Send feedback',
              callback: () => FeedbackScreen.open(context),
            ),
            customListTile(
              icon: BlynkIcons.share,
              title: 'Share the app',
              callback: () {
                Share.share(
                  'Blynk Quick-Commerce App',
                  subject: "Blynk App",
                );
              },
            ),
            customListTile(
              icon: BlynkIcons.info,
              title: 'About us',
              callback: () {
                Navigator.of(context).pushNamed('/app/about');
              },
            ),
            if (signedIn)
              customListTile(
                icon: BlynkIcons.logout,
                title: 'Log out',
                // The one logout confirmation in the app; this screen does
                // not put up a second one.
                callback: () => showLogoutDialog(context),
              ),
          ],
        ),
      ),
    );
  }
}

/// Who is signed in. Nothing here is invented: a customer with no name on
/// their account sees the neutral heading, and a missing phone renders
/// nothing rather than a placeholder.
class _AccountHeader extends StatelessWidget {
  const _AccountHeader();

  @override
  Widget build(BuildContext context) {
    return Consumer<AuthProvider>(
      builder: (context, auth, _) {
        final user = auth.currentUser;
        final displayName = (user?.fullName != null && user!.fullName!.isNotEmpty)
            ? user.fullName!
            : 'My Account';
        final displayPhone = user?.phone ?? '';

        return Container(
          width: double.infinity,
          padding: const EdgeInsets.all(BlynkSpace.s16),
          decoration: const BoxDecoration(
            color: BlynkColors.well,
            borderRadius: BlynkRadius.lgAll,
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(displayName, style: BlynkText.title),
              if (displayPhone.isNotEmpty) ...[
                const SizedBox(height: BlynkSpace.s4),
                Text(
                  displayPhone,
                  style: BlynkText.body.copyWith(color: BlynkColors.ink2),
                ),
              ],
            ],
          ),
        );
      },
    );
  }
}
