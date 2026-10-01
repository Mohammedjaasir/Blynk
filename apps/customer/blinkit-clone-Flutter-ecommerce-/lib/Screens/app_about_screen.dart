import 'package:flutter/material.dart';
import 'package:package_info_plus/package_info_plus.dart';

import '../Services/store_info.dart';
import '../design/tokens.dart';

class AppAboutScreen extends StatefulWidget {
  const AppAboutScreen({super.key});

  @override
  State<AppAboutScreen> createState() => _AppAboutScreenState();
}

class _AppAboutScreenState extends State<AppAboutScreen> {
  late final Future<PackageInfo> _packageInfo = PackageInfo.fromPlatform();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: BlynkColors.paper,
      appBar: AppBar(
        title: const Text('About us'),
      ),
      body: Align(
        alignment: Alignment.topCenter,
        child: ConstrainedBox(
          // A short page of prose: a full-width desktop line is unreadable.
          // W8: the 640 is now [BlynkForm.proseMaxWidth].
          constraints: const BoxConstraints(maxWidth: BlynkForm.proseMaxWidth),
          child: ListView(
            padding: const EdgeInsets.fromLTRB(
              BlynkSpace.s16,
              BlynkSpace.s24,
              BlynkSpace.s16,
              BlynkSpace.s32,
            ),
            children: [
              const Text('Blynk', style: BlynkText.display),
              FutureBuilder<PackageInfo>(
                future: _packageInfo,
                builder: (context, snapshot) {
                  final info = snapshot.data;
                  // Nothing while loading, and nothing (rather than a made-up
                  // number) if the platform cannot report a version.
                  if (info == null) return const SizedBox.shrink();
                  final build =
                      info.buildNumber.isEmpty ? '' : ' (${info.buildNumber})';
                  return Padding(
                    padding: const EdgeInsets.only(top: BlynkSpace.s4),
                    child: Text(
                      'Version ${info.version}$build',
                      style: BlynkText.caption.copyWith(color: BlynkColors.ink2),
                    ),
                  );
                },
              ),
              const SizedBox(height: BlynkSpace.s24),
              const Text(
                'Blynk delivers freshly sourced groceries and quality essentials in '
                '${StoreInfo.hubName}. You place the order in the app and pay '
                'in cash when it arrives. Deliveries go out '
                '${StoreInfo.deliveryHoursLabel}.',
                style: BlynkText.body,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
