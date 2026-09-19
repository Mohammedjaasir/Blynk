import 'package:flutter/material.dart';

import 'package:ecom/app_colors.dart';
import 'package:ecom/app_design.dart';

class AppTheme {
  static final ThemeData appTHeme = ThemeData(
    primaryColor: AppColors.primaryYellowColor,
    scaffoldBackgroundColor: AppColors.scaffoldBackgroundColor,
    fontFamily: 'Catamaran',
    colorScheme: ColorScheme.fromSeed(
      seedColor: AppColors.primaryYellowColor,
      primary: AppColors.primaryYellowColor,
      onPrimary: AppTextColors.onYellow,
      secondary: AppColors.primaryGreenColor,
      onSecondary: Colors.white,
      surface: Colors.white,
      onSurface: AppTextColors.primary,
    ),
    textTheme: const TextTheme(
      labelLarge: TextStyle(
        color: AppTextColors.primary,
        fontWeight: FontWeight.bold,
        fontSize: 18,
      ),
      displaySmall: TextStyle(
        color: AppTextColors.secondary,
        fontWeight: FontWeight.w500,
        fontSize: 13,
      ),
      displayMedium: TextStyle(
        color: AppTextColors.primary,
        fontWeight: FontWeight.bold,
        fontSize: 20,
      ),
      titleLarge: TextStyle(
        color: AppTextColors.primary,
        fontWeight: FontWeight.w800,
        fontSize: 22,
      ),
      titleMedium: TextStyle(
        color: AppTextColors.primary,
        fontWeight: FontWeight.w700,
        fontSize: 16,
      ),
      bodyMedium: TextStyle(
        color: AppTextColors.primary,
        fontSize: 14,
      ),
      bodySmall: TextStyle(
        color: AppTextColors.secondary,
        fontSize: 12,
      ),
    ),
    iconTheme: const IconThemeData(
      color: AppTextColors.primary,
    ),
    appBarTheme: const AppBarTheme(
      backgroundColor: Colors.white,
      surfaceTintColor: Colors.transparent,
      titleTextStyle: TextStyle(
        fontFamily: 'Catamaran',
        fontWeight: FontWeight.w800,
        color: AppTextColors.primary,
        fontSize: 18,
      ),
      iconTheme: IconThemeData(color: AppTextColors.primary),
      elevation: 0,
      scrolledUnderElevation: 0.5,
    ),
    floatingActionButtonTheme: const FloatingActionButtonThemeData(
      backgroundColor: AppColors.primaryYellowColor,
      foregroundColor: AppTextColors.onYellow,
    ),
    elevatedButtonTheme: ElevatedButtonThemeData(
      style: appPrimaryButtonStyle(),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: AppTextColors.primary,
        side: const BorderSide(color: AppSurfaces.border),
        padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.xl,
          vertical: AppSpacing.md,
        ),
        textStyle: const TextStyle(
          fontFamily: 'Catamaran',
          fontWeight: FontWeight.w700,
          fontSize: 15,
        ),
        shape: RoundedRectangleBorder(borderRadius: AppRadius.buttonBorder),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        foregroundColor: AppColors.primaryGreenColor,
        textStyle: const TextStyle(
          fontFamily: 'Catamaran',
          fontWeight: FontWeight.bold,
          fontSize: 15,
        ),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: AppSurfaces.subtle,
      contentPadding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.lg,
        vertical: AppSpacing.md + 2,
      ),
      hintStyle: const TextStyle(color: AppTextColors.muted, fontSize: 14),
      border: OutlineInputBorder(
        borderRadius: AppRadius.fieldBorder,
        borderSide: const BorderSide(color: AppSurfaces.border),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: AppRadius.fieldBorder,
        borderSide: const BorderSide(color: AppSurfaces.border),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: AppRadius.fieldBorder,
        borderSide: const BorderSide(
          color: AppColors.primaryGreenColor,
          width: 1.4,
        ),
      ),
    ),
    chipTheme: const ChipThemeData(
      backgroundColor: AppSurfaces.subtle,
      selectedColor: AppColors.primaryYellowColor,
      labelStyle: TextStyle(
        color: AppTextColors.primary,
        fontWeight: FontWeight.w600,
        fontSize: 13,
      ),
      side: BorderSide(color: AppSurfaces.border),
      shape: StadiumBorder(),
      padding: EdgeInsets.symmetric(
        horizontal: AppSpacing.md,
        vertical: AppSpacing.sm,
      ),
    ),
    bottomSheetTheme: BottomSheetThemeData(
      backgroundColor: Colors.white,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(borderRadius: AppRadius.sheetBorder),
    ),
    dividerTheme: const DividerThemeData(
      color: AppSurfaces.border,
      thickness: 1,
      space: 1,
    ),
    snackBarTheme: SnackBarThemeData(
      behavior: SnackBarBehavior.floating,
      backgroundColor: AppTextColors.primary,
      contentTextStyle: const TextStyle(
        fontFamily: 'Catamaran',
        color: Colors.white,
        fontSize: 14,
      ),
      shape: RoundedRectangleBorder(borderRadius: AppRadius.buttonBorder),
    ),
  );
}
