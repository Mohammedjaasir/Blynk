import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../Models/dental_clinic_model.dart';
import '../Services/Providers/dental.provider.dart';
import '../Services/app_errors.dart';
import '../UI/Widgets/Atoms/app_skeleton.dart';
import '../UI/Widgets/Atoms/app_state_views.dart';
import '../UI/Widgets/Atoms/blynk_text_field.dart';
import '../UI/Widgets/Atoms/failure_states.dart';
import '../UI/Widgets/Organisms/dental_widgets.dart';
import '../app_responsive.dart';
import '../design/tokens.dart';

/// Discovery entry point (task F2): every active dental clinic, searchable by
/// name/city. `DentalProvider` holds no state of its own (task-F1-report.md
/// "no caching of any kind by design"), so this screen keeps its own list/
/// loading/failure locally and re-fetches on every search change, exactly
/// like `SearchScreen` re-queries the backend rather than filtering a cached
/// list client-side.
///
/// Inactive clinics are never filtered here - the backend already excludes
/// them (task-B2), and a client-side `isActive` check would only mask a
/// backend bug (the brief's explicit instruction).
class DentalClinicsScreen extends StatefulWidget {
  const DentalClinicsScreen({super.key});

  @override
  State<DentalClinicsScreen> createState() => _DentalClinicsScreenState();
}

class _DentalClinicsScreenState extends State<DentalClinicsScreen> {
  // Server-side search (fetchClinics(search:)), same debounce as SearchScreen.
  static const Duration _debounce = Duration(milliseconds: 350);

  final TextEditingController _controller = TextEditingController();
  Timer? _debounceTimer;

  List<ClinicModel> _clinics = const [];
  bool _loading = true;
  CustomerError? _failure;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  @override
  void dispose() {
    _debounceTimer?.cancel();
    _controller.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    if (!mounted) return;
    setState(() {
      _loading = true;
      _failure = null;
    });
    final query = _controller.text.trim();
    try {
      final clinics = await context.read<DentalProvider>().fetchClinics(
            search: query.isEmpty ? null : query,
          );
      if (!mounted) return;
      setState(() {
        _clinics = clinics;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _failure = AppErrors.from(e);
        _loading = false;
      });
    }
  }

  void _onSearchChanged(String value) {
    _debounceTimer?.cancel();
    _debounceTimer = Timer(_debounce, _load);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: BlynkColors.paper,
      appBar: AppBar(
        title: const Text('Channel doctors'),
        // Task F5: gives '/dental/appointments' (F4's list screen) an actual
        // caller so it is reachable in the running app - the Home entry
        // point only ever leads to discovery, never straight to "my
        // appointments" (brief's own scope for the Home tile).
        actions: [
          IconButton(
            key: const Key('my-dental-appointments-action'),
            tooltip: 'My appointments',
            icon: const Icon(BlynkIcons.dental),
            onPressed: () => Navigator.of(context).pushNamed('/dental/appointments'),
          ),
        ],
      ),
      body: ContentFrame(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.only(top: BlynkSpace.s16, bottom: BlynkSpace.s16),
              // The app's one text field, not a dental-only search bar: same
              // well fill, same `lineStrong` boundary, same 48 dp clear
              // button, same focus ring.
              child: BlynkTextField(
                label: 'Search clinics',
                controller: _controller,
                hintText: 'Clinic or city',
                textInputAction: TextInputAction.search,
                prefix: const Icon(BlynkIcons.search, size: BlynkIcons.sm, color: BlynkColors.ink2),
                onChanged: _onSearchChanged,
                onSubmitted: (_) {
                  _debounceTimer?.cancel();
                  _load();
                },
              ),
            ),
            Expanded(child: _body()),
          ],
        ),
      ),
    );
  }

  Widget _body() {
    if (_loading) {
      return SkeletonScope(
        child: ListView.separated(
          key: const Key('clinics-skeleton'),
          padding: const EdgeInsets.only(bottom: BlynkSpace.s24),
          itemCount: 6,
          separatorBuilder: (_, __) => const SizedBox(height: BlynkSpace.s12),
          itemBuilder: (_, __) => const ListRowSkeleton(),
        ),
      );
    }
    if (_failure != null) {
      return FailureState(
        failure: _failure!,
        title: "We couldn't load clinics",
        scrollable: false,
        onRetry: _load,
        retryKey: const Key('clinics-retry'),
      );
    }
    if (_clinics.isEmpty) {
      return const AppStateView.empty(
        title: 'No doctors available yet',
      );
    }
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView.separated(
        padding: const EdgeInsets.only(bottom: BlynkSpace.s24),
        physics: const AlwaysScrollableScrollPhysics(parent: BouncingScrollPhysics()),
        itemCount: _clinics.length,
        separatorBuilder: (_, __) => const SizedBox(height: BlynkSpace.s12),
        itemBuilder: (context, index) => _ClinicRow(clinic: _clinics[index]),
      ),
    );
  }
}

class _ClinicRow extends StatelessWidget {
  const _ClinicRow({required this.clinic});

  final ClinicModel clinic;

  @override
  Widget build(BuildContext context) {
    return DentalCard(
      key: Key('clinic-row-${clinic.id}'),
      semanticLabel: '${clinic.name}, ${clinic.city}, ${clinic.addressLine}',
      onTap: () => Navigator.of(context).pushNamed('/dental/clinic', arguments: clinic.id),
      child: Row(
        children: [
          const DentalGlyphTile(),
          const SizedBox(width: BlynkSpace.s12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(clinic.name, style: BlynkText.heading),
                const SizedBox(height: BlynkSpace.s4),
                Text(clinic.city, style: BlynkText.body.copyWith(color: BlynkColors.ink2)),
                const SizedBox(height: BlynkSpace.s4),
                Text(
                  clinic.addressLine,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: BlynkText.caption.copyWith(color: BlynkColors.ink3),
                ),
              ],
            ),
          ),
          const SizedBox(width: BlynkSpace.s8),
          const Icon(BlynkIcons.chevron, color: BlynkColors.ink2),
        ],
      ),
    );
  }
}
