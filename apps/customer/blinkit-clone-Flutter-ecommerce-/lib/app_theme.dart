import 'package:flutter/material.dart';

import 'package:ecom/design/tokens.dart';
import 'UI/Widgets/Atoms/blynk_page_transition.dart';

/// The Blynk theme, built entirely from `lib/design/` tokens. The colour
/// scheme is ink-primary so no Material default can fall back to yellow;
/// yellow appears only where a component theme below asks for it.
class AppTheme {
  AppTheme._();

  static final ThemeData theme = _build();

  /// Historical name (typo kept so existing callers compile).
  static final ThemeData appTHeme = theme;

  static const ColorScheme _scheme = ColorScheme.light(
    primary: BlynkColors.ink,
    onPrimary: BlynkColors.paper,
    primaryContainer: BlynkColors.well,
    onPrimaryContainer: BlynkColors.ink,
    secondary: BlynkColors.signal,
    onSecondary: BlynkColors.onSignal,
    // Not yellow: M3 widgets (SegmentedButton, filledTonal, Slider) default to this role.
    secondaryContainer: BlynkColors.well,
    onSecondaryContainer: BlynkColors.ink,
    tertiary: BlynkColors.positive,
    onTertiary: BlynkColors.onPositive,
    tertiaryContainer: BlynkColors.positiveTint,
    onTertiaryContainer: BlynkColors.positiveInk,
    error: BlynkColors.problem,
    onError: BlynkColors.paper,
    errorContainer: BlynkColors.problemTint,
    onErrorContainer: BlynkColors.problem,
    surface: BlynkColors.paper,
    onSurface: BlynkColors.ink,
    onSurfaceVariant: BlynkColors.ink2,
    surfaceDim: BlynkColors.well,
    surfaceBright: BlynkColors.paper,
    surfaceContainerLowest: BlynkColors.paper,
    surfaceContainerLow: BlynkColors.paper,
    surfaceContainer: BlynkColors.well,
    surfaceContainerHigh: BlynkColors.well,
    surfaceContainerHighest: BlynkColors.well,
    outline: BlynkColors.lineStrong,
    outlineVariant: BlynkColors.line,
    inverseSurface: BlynkColors.ink,
    onInverseSurface: BlynkColors.paper,
    inversePrimary: BlynkColors.ink3,
    scrim: BlynkColors.scrim,
    surfaceTint: BlynkColors.clear,
  );

  static const Size _minButton = Size(64, 48);
  static const EdgeInsets _buttonPadding =
      EdgeInsets.symmetric(horizontal: BlynkSpace.s24, vertical: BlynkSpace.s12);
  static const RoundedRectangleBorder _buttonShape =
      RoundedRectangleBorder(borderRadius: BlynkRadius.mdAll);

  // Focus is a thicker ink outline, never colour alone.
  static const BorderSide _focusRing = BorderSide(color: BlynkColors.ink, width: 2);

  static ButtonStyle _primaryButton() => ButtonStyle(
        minimumSize: const WidgetStatePropertyAll(_minButton),
        padding: const WidgetStatePropertyAll(_buttonPadding),
        shape: const WidgetStatePropertyAll(_buttonShape),
        elevation: const WidgetStatePropertyAll(0),
        shadowColor: const WidgetStatePropertyAll(BlynkColors.clear),
        surfaceTintColor: const WidgetStatePropertyAll(BlynkColors.clear),
        overlayColor: const WidgetStatePropertyAll(BlynkColors.clear),
        textStyle: const WidgetStatePropertyAll(BlynkText.label),
        // W9: one disabled recipe app-wide. `BlynkButton` moved to
        // `BlynkDisabled` (`line`/`ink3`, 6.21:1); the THEME still greyed out
        // to `well`/`ink2` (4.54:1), so every button that is a plain Material
        // button rather than a `BlynkButton` - the whole live-location picker
        // - kept the weaker of the two. Same token, higher contrast.
        backgroundColor: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.disabled)) return BlynkDisabled.fill;
          if (states.contains(WidgetState.pressed)) return BlynkColors.signalPressed;
          return BlynkColors.signal;
        }),
        foregroundColor: WidgetStateProperty.resolveWith((states) {
          return states.contains(WidgetState.disabled) ? BlynkDisabled.label : BlynkColors.onSignal;
        }),
        side: WidgetStateProperty.resolveWith((states) {
          return states.contains(WidgetState.focused) ? _focusRing : null;
        }),
      );

  static ButtonStyle _outlinedButton() => ButtonStyle(
        minimumSize: const WidgetStatePropertyAll(_minButton),
        padding: const WidgetStatePropertyAll(_buttonPadding),
        shape: const WidgetStatePropertyAll(_buttonShape),
        elevation: const WidgetStatePropertyAll(0),
        textStyle: const WidgetStatePropertyAll(BlynkText.label),
        foregroundColor: WidgetStateProperty.resolveWith((states) {
          return states.contains(WidgetState.disabled) ? BlynkDisabled.label : BlynkColors.ink;
        }),
        side: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.focused)) return _focusRing;
          if (states.contains(WidgetState.disabled)) {
            return const BorderSide(color: BlynkColors.line, width: 1.5);
          }
          return const BorderSide(color: BlynkColors.lineStrong, width: 1.5);
        }),
      );

  static ButtonStyle _textButton() => ButtonStyle(
        minimumSize: const WidgetStatePropertyAll(_minButton),
        shape: const WidgetStatePropertyAll(_buttonShape),
        foregroundColor: WidgetStateProperty.resolveWith((states) {
          return states.contains(WidgetState.disabled) ? BlynkDisabled.label : BlynkColors.ink;
        }),
        textStyle: WidgetStateProperty.resolveWith((states) {
          return states.contains(WidgetState.focused)
              ? BlynkText.label.copyWith(decoration: TextDecoration.underline)
              : BlynkText.label;
        }),
      );

  static OutlineInputBorder _inputBorder(Color color, double width) => OutlineInputBorder(
        borderRadius: BlynkRadius.mdAll,
        borderSide: BorderSide(color: color, width: width),
      );

  static ThemeData _build() {
    final textTheme = BlynkText.textTheme;
    final ink30 = BlynkColors.ink.withValues(alpha: 0.30);

    return ThemeData(
      useMaterial3: true,
      // One route transition for all 21 routes: a short fade-through that
      // sits under the product image's Hero instead of fighting it.
      pageTransitionsTheme: blynkPageTransitions,
      colorScheme: _scheme,
      fontFamily: BlynkText.family,
      textTheme: textTheme,
      primaryColor: BlynkColors.ink,
      // The page is `paper` (plan §5). A previous pass introduced a cream
      // `canvas` neutral; Blynk's palette has exactly one page surface and
      // one tint (`well`), so that fifth neutral family is gone.
      scaffoldBackgroundColor: BlynkColors.paper,
      canvasColor: BlynkColors.paper,
      cardColor: BlynkColors.paper,
      dividerColor: BlynkColors.line,
      // Desktop defaults would shrink tap targets and density; the floor is 48.
      materialTapTargetSize: MaterialTapTargetSize.padded,
      visualDensity: VisualDensity.standard,
      splashFactory: InkRipple.splashFactory,
      splashColor: BlynkColors.ink.withValues(alpha: 0.10),
      highlightColor: BlynkColors.ink.withValues(alpha: 0.06),
      hoverColor: BlynkColors.ink.withValues(alpha: 0.06),
      focusColor: BlynkColors.ink.withValues(alpha: 0.12),
      iconTheme: const IconThemeData(color: BlynkColors.ink, size: BlynkIcons.md),
      primaryIconTheme: const IconThemeData(color: BlynkColors.ink, size: BlynkIcons.md),
      appBarTheme: const AppBarTheme(
        backgroundColor: BlynkColors.paper,
        foregroundColor: BlynkColors.ink,
        surfaceTintColor: BlynkColors.clear,
        shadowColor: BlynkColors.line,
        elevation: 0,
        scrolledUnderElevation: 0.5,
        titleTextStyle: BlynkText.heading,
        iconTheme: IconThemeData(color: BlynkColors.ink, size: BlynkIcons.md),
        actionsIconTheme: IconThemeData(color: BlynkColors.ink, size: BlynkIcons.md),
      ),
      floatingActionButtonTheme: const FloatingActionButtonThemeData(
        backgroundColor: BlynkColors.signal,
        foregroundColor: BlynkColors.onSignal,
        elevation: 0,
        focusElevation: 0,
        hoverElevation: 0,
        highlightElevation: 0,
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(style: _primaryButton()),
      filledButtonTheme: FilledButtonThemeData(style: _primaryButton()),
      outlinedButtonTheme: OutlinedButtonThemeData(style: _outlinedButton()),
      textButtonTheme: TextButtonThemeData(style: _textButton()),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: BlynkColors.well,
        constraints: const BoxConstraints(minHeight: 48),
        contentPadding: const EdgeInsets.symmetric(
          horizontal: BlynkSpace.s16,
          vertical: BlynkSpace.s12,
        ),
        floatingLabelBehavior: FloatingLabelBehavior.always,
        labelStyle: BlynkText.label,
        floatingLabelStyle: BlynkText.label,
        hintStyle: BlynkText.body.copyWith(color: BlynkColors.ink2),
        helperStyle: BlynkText.caption.copyWith(color: BlynkColors.ink2),
        errorStyle: BlynkText.caption.copyWith(color: BlynkColors.problem),
        prefixIconColor: BlynkColors.ink,
        suffixIconColor: BlynkColors.ink,
        border: _inputBorder(BlynkColors.lineStrong, 1),
        enabledBorder: _inputBorder(BlynkColors.lineStrong, 1),
        disabledBorder: _inputBorder(BlynkColors.line, 1),
        focusedBorder: _inputBorder(BlynkColors.ink, 2),
        errorBorder: _inputBorder(BlynkColors.problem, 2),
        focusedErrorBorder: _inputBorder(BlynkColors.problem, 2),
      ),
      chipTheme: ChipThemeData(
        backgroundColor: BlynkColors.paper,
        selectedColor: BlynkColors.ink,
        disabledColor: BlynkColors.well,
        checkmarkColor: BlynkColors.paper,
        surfaceTintColor: BlynkColors.clear,
        elevation: 0,
        pressElevation: 0,
        showCheckmark: true,
        labelStyle: BlynkText.label.copyWith(
          color: WidgetStateColor.resolveWith((states) {
            return states.contains(WidgetState.selected) ? BlynkColors.paper : BlynkColors.ink;
          }),
        ),
        side: WidgetStateBorderSide.resolveWith((states) {
          return BorderSide(
            color: states.contains(WidgetState.selected) ? BlynkColors.ink : BlynkColors.lineStrong,
          );
        }),
        shape: const RoundedRectangleBorder(borderRadius: BlynkRadius.smAll),
        padding: const EdgeInsets.symmetric(horizontal: BlynkSpace.s12, vertical: BlynkSpace.s12),
      ),
      bottomSheetTheme: const BottomSheetThemeData(
        backgroundColor: BlynkColors.paper,
        surfaceTintColor: BlynkColors.clear,
        shadowColor: BlynkElevation.overlayShadow,
        elevation: BlynkElevation.overlayDp,
        modalBackgroundColor: BlynkColors.paper,
        modalBarrierColor: BlynkColors.scrim,
        modalElevation: BlynkElevation.overlayDp,
        dragHandleColor: BlynkColors.lineStrong,
        dragHandleSize: Size(BlynkSpace.s32, BlynkSpace.s4),
        shape: RoundedRectangleBorder(borderRadius: BlynkRadius.lgTop),
      ),
      dialogTheme: const DialogThemeData(
        backgroundColor: BlynkColors.paper,
        surfaceTintColor: BlynkColors.clear,
        barrierColor: BlynkColors.scrim,
        shadowColor: BlynkElevation.overlayShadow,
        elevation: BlynkElevation.overlayDp,
        titleTextStyle: BlynkText.title,
        contentTextStyle: BlynkText.body,
        shape: RoundedRectangleBorder(borderRadius: BlynkRadius.lgAll),
      ),
      cardTheme: const CardThemeData(
        color: BlynkColors.paper,
        surfaceTintColor: BlynkColors.clear,
        shadowColor: BlynkColors.clear,
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BlynkRadius.mdAll,
          side: BorderSide(color: BlynkColors.line),
        ),
      ),
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: BlynkColors.paper,
        surfaceTintColor: BlynkColors.clear,
        shadowColor: BlynkColors.clear,
        elevation: 0,
        height: 64,
        indicatorColor: BlynkColors.signal,
        labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
        labelTextStyle: WidgetStatePropertyAll(
          BlynkText.caption.copyWith(fontWeight: FontWeight.w700),
        ),
        iconTheme: const WidgetStatePropertyAll(
          IconThemeData(color: BlynkColors.ink, size: BlynkIcons.md),
        ),
      ),
      navigationRailTheme: NavigationRailThemeData(
        backgroundColor: BlynkColors.paper,
        elevation: 0,
        indicatorColor: BlynkColors.signal,
        selectedIconTheme: const IconThemeData(color: BlynkColors.ink, size: BlynkIcons.md),
        unselectedIconTheme: const IconThemeData(color: BlynkColors.ink, size: BlynkIcons.md),
        selectedLabelTextStyle: BlynkText.caption.copyWith(fontWeight: FontWeight.w700),
        unselectedLabelTextStyle: BlynkText.caption.copyWith(fontWeight: FontWeight.w700),
      ),
      listTileTheme: const ListTileThemeData(
        iconColor: BlynkColors.ink,
        textColor: BlynkColors.ink,
        selectedColor: BlynkColors.ink,
        selectedTileColor: BlynkColors.well,
        minTileHeight: 48,
        titleTextStyle: BlynkText.label,
        subtitleTextStyle: BlynkText.body,
        leadingAndTrailingTextStyle: BlynkText.caption,
      ),
      dividerTheme: const DividerThemeData(
        color: BlynkColors.line,
        thickness: 1,
        space: 1,
      ),
      progressIndicatorTheme: const ProgressIndicatorThemeData(
        color: BlynkColors.ink,
        linearTrackColor: BlynkColors.line,
        refreshBackgroundColor: BlynkColors.paper,
      ),
      snackBarTheme: SnackBarThemeData(
        behavior: SnackBarBehavior.floating,
        backgroundColor: BlynkColors.ink,
        contentTextStyle: BlynkText.body.copyWith(color: BlynkColors.paper),
        actionTextColor: BlynkColors.paper,
        disabledActionTextColor: BlynkColors.lineStrong,
        elevation: 0,
        shape: const RoundedRectangleBorder(borderRadius: BlynkRadius.mdAll),
      ),
      tooltipTheme: TooltipThemeData(
        decoration: const BoxDecoration(
          color: BlynkColors.ink,
          borderRadius: BlynkRadius.smAll,
        ),
        textStyle: BlynkText.caption.copyWith(color: BlynkColors.paper),
        padding: const EdgeInsets.symmetric(horizontal: BlynkSpace.s12, vertical: BlynkSpace.s8),
      ),
      textSelectionTheme: TextSelectionThemeData(
        cursorColor: BlynkColors.ink,
        selectionColor: ink30,
        selectionHandleColor: BlynkColors.ink,
      ),
    );
  }
}
