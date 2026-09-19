import 'package:flutter/material.dart';

import '../../../app_design.dart';
import '../../../app_responsive.dart';

/// Home's search entry. It's a button styled as a field - typing happens on
/// the dedicated search screen, so Home never rebuilds per keystroke.
class HomeScreenSearchBar extends StatelessWidget {
  const HomeScreenSearchBar({super.key});

  @override
  Widget build(BuildContext context) {
    final responsive = Responsive.of(context);
    return SliverToBoxAdapter(
      child: Container(
        color: Colors.white,
        width: double.infinity,
        alignment: Alignment.center,
        padding: const EdgeInsets.fromLTRB(
          AppSpacing.lg,
          AppSpacing.xs,
          AppSpacing.lg,
          AppSpacing.md,
        ),
        // A search bar stretched across a desktop browser stops reading as a
        // search field - cap it like a typical desktop search bar.
        child: ConstrainedBox(
          constraints: BoxConstraints(
            maxWidth: responsive.isDesktop
                ? 640.0
                : (responsive.isTablet ? 520.0 : double.infinity),
          ),
          child: Semantics(
            button: true,
            label: 'Search groceries and essentials',
            excludeSemantics: true,
            child: Material(
              color: AppSurfaces.subtle,
              shape: RoundedRectangleBorder(
                borderRadius: AppRadius.fieldBorder,
                side: const BorderSide(color: AppSurfaces.border),
              ),
              child: InkWell(
                borderRadius: AppRadius.fieldBorder,
                onTap: () => Navigator.of(context).pushNamed('/search'),
                child: const SizedBox(
                  height: 48,
                  child: Row(
                    children: [
                      SizedBox(width: AppSpacing.md),
                      Icon(
                        Icons.search_rounded,
                        color: AppTextColors.primary,
                        size: 22,
                      ),
                      SizedBox(width: AppSpacing.md),
                      Expanded(
                        child: Text(
                          'Search groceries & essentials',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            fontSize: 15,
                            color: AppTextColors.muted,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
