import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:ecom/Services/Validation/app_validators.dart';
import 'package:ecom/UI/Widgets/Atoms/app_toast.dart';
import 'package:provider/provider.dart';

import '../Models/address_model.dart';
import '../Services/Providers/address.provider.dart';
import '../app_colors.dart';
import '../app_design.dart';

// The backend's createAddressSchema requires explicit numeric latitude and
// longitude (see backend/api/src/modules/users/address.schema.ts) - there's
// no map-picker or geocoding library in this project, so these stay plain
// editable fields defaulted to the real Dharga Town hub coordinates rather
// than faking a location picker that doesn't exist.
class AddEditAddressScreen extends StatefulWidget {
  const AddEditAddressScreen({super.key, this.existing});

  final AddressModel? existing;

  @override
  State<AddEditAddressScreen> createState() => _AddEditAddressScreenState();
}

/// The quick presets for the address name. The backend stores `label` as
/// free text, so these are just shortcuts into that one existing field -
/// "Other" reveals the text input for anything else.
// Digits, separators and a leading + only: a phone keyboard still offers
// letters on desktop, and a name in the phone box is the bug this prevents.
final _phoneFormatter =
    FilteringTextInputFormatter.allow(RegExp(r'[0-9 +()-]'));

/// Digits, a sign and a decimal point for the coordinate fields.
final _coordinateFormatter =
    FilteringTextInputFormatter.allow(RegExp(r'[0-9.-]'));

const List<String> _kLabelPresets = ['Home', 'Work'];
const String _kOtherLabel = 'Other';

class _AddEditAddressScreenState extends State<AddEditAddressScreen> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _labelController;
  late final TextEditingController _nameController;
  late final TextEditingController _phoneController;
  late final TextEditingController _line1Controller;
  late final TextEditingController _line2Controller;
  late final TextEditingController _cityController;
  late final TextEditingController _postalController;
  late final TextEditingController _latController;
  late final TextEditingController _lngController;
  late final TextEditingController _instructionsController;
  late String _selectedPreset;
  bool _isDefault = false;
  bool _isSaving = false;

  bool get _isEditing => widget.existing != null;
  bool get _isCustomLabel => _selectedPreset == _kOtherLabel;

  @override
  void initState() {
    super.initState();
    final e = widget.existing;
    final label = e?.label ?? 'Home';
    _selectedPreset = _kLabelPresets.contains(label) ? label : _kOtherLabel;
    _labelController = TextEditingController(
      text: _selectedPreset == _kOtherLabel ? label : '',
    );
    _nameController = TextEditingController(text: e?.recipientName ?? '');
    _phoneController = TextEditingController(text: e?.recipientPhone ?? '');
    _line1Controller = TextEditingController(text: e?.addressLine1 ?? '');
    _line2Controller = TextEditingController(text: e?.addressLine2 ?? '');
    _cityController = TextEditingController(text: e?.city ?? 'Dharga Town');
    _postalController = TextEditingController(text: e?.postalCode ?? '');
    _latController =
        TextEditingController(text: (e?.latitude ?? 6.4382).toString());
    _lngController =
        TextEditingController(text: (e?.longitude ?? 80.0274).toString());
    _instructionsController =
        TextEditingController(text: e?.deliveryInstructions ?? '');
    _isDefault = e?.isDefault ?? false;
  }

  @override
  void dispose() {
    _labelController.dispose();
    _nameController.dispose();
    _phoneController.dispose();
    _line1Controller.dispose();
    _line2Controller.dispose();
    _cityController.dispose();
    _postalController.dispose();
    _latController.dispose();
    _lngController.dispose();
    _instructionsController.dispose();
    super.dispose();
  }

  /// What goes into the backend's existing free-text `label`.
  String get _label => _isCustomLabel
      ? AppValidators.normalizeText(_labelController.text)
      : _selectedPreset;

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;

    setState(() => _isSaving = true);
    final addressProvider = context.read<AddressProvider>();

    final address = AddressModel(
      id: widget.existing?.id ?? '',
      label: _label,
      // Normalized on the way out: collapsed whitespace, an E.164 phone,
      // and null (not '') for the fields the backend treats as optional.
      recipientName: AppValidators.normalizeText(_nameController.text),
      recipientPhone: AppValidators.normalizePhone(_phoneController.text) ??
          AppValidators.normalizeText(_phoneController.text),
      addressLine1: AppValidators.normalizeText(_line1Controller.text),
      addressLine2: AppValidators.optionalText(_line2Controller.text),
      city: AppValidators.normalizeText(_cityController.text),
      postalCode: AppValidators.optionalText(_postalController.text),
      latitude: double.tryParse(_latController.text.trim()) ?? 6.4382,
      longitude: double.tryParse(_lngController.text.trim()) ?? 80.0274,
      deliveryInstructions:
          AppValidators.optionalText(_instructionsController.text),
      isDefault: _isDefault,
    );

    try {
      if (_isEditing) {
        await addressProvider.updateAddress(
          address.id,
          address.toCreatePayload(),
        );
      } else {
        await addressProvider.createAddress(address);
      }
      if (mounted) Navigator.of(context).pop();
    } catch (_) {
      if (mounted) {
        // The backend also verifies the delivery geofence server-side on
        // checkout - a saved address outside it isn't rejected here, only
        // surfaced honestly if the backend itself reports the failure.
        showAppToast(
          msg: addressProvider.errorMessage ?? 'Could not save this address.',
        );
      }
    } finally {
      if (mounted) setState(() => _isSaving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppSurfaces.subtle,
      appBar: AppBar(
        title: Text(_isEditing ? 'Edit Address' : 'Add Address'),
        backgroundColor: Colors.white,
        surfaceTintColor: Colors.white,
        elevation: 0,
        // Hairline separation only once the form scrolls under it.
        scrolledUnderElevation: 0.5,
      ),
      body: Align(
        alignment: Alignment.topCenter,
        child: ConstrainedBox(
          // Tablet/desktop get a centred column, not a stretched form.
          constraints: const BoxConstraints(maxWidth: 560),
          child: Form(
            key: _formKey,
            // After the first interaction a corrected field clears its own
            // error as you type, instead of waiting for the next Save.
            autovalidateMode: AutovalidateMode.onUserInteraction,
            child: ListView(
              padding: const EdgeInsets.fromLTRB(
                AppSpacing.lg,
                AppSpacing.lg,
                AppSpacing.lg,
                AppSpacing.xxl,
              ),
              children: [
                _LabelPicker(
                  selected: _selectedPreset,
                  onChanged: (value) =>
                      setState(() => _selectedPreset = value),
                ),
                if (_isCustomLabel) ...[
                  const SizedBox(height: AppSpacing.md),
                  _FormSection(
                    children: [
                      _AddressField(
                        controller: _labelController,
                        label: 'Address name',
                        hint: 'e.g. Parents, Hostel',
                        icon: Icons.bookmark_outline_rounded,
                        textCapitalization: TextCapitalization.words,
                        maxLength: AppValidators.addressNameMax,
                        validator: AppValidators.addressName,
                      ),
                    ],
                  ),
                ],
                const _SectionLabel('CONTACT'),
                _FormSection(
                  children: [
                    _AddressField(
                      controller: _nameController,
                      label: 'Recipient name',
                      hint: 'Who receives the order',
                      icon: Icons.person_outline_rounded,
                      textCapitalization: TextCapitalization.words,
                      maxLength: AppValidators.recipientNameMax,
                      validator: AppValidators.recipientName,
                    ),
                    _AddressField(
                      controller: _phoneController,
                      label: 'Recipient phone',
                      hint: '07XXXXXXXX',
                      icon: Icons.phone_outlined,
                      keyboardType: TextInputType.phone,
                      maxLength: 16,
                      // Keeps letters out while typing; a pasted number with
                      // spaces or +94 still normalizes on save.
                      inputFormatters: [_phoneFormatter],
                      validator: AppValidators.phone,
                    ),
                  ],
                ),
                const _SectionLabel('DELIVERY ADDRESS'),
                _FormSection(
                  children: [
                    _AddressField(
                      controller: _line1Controller,
                      label: 'Address line 1',
                      hint: 'House / street',
                      icon: Icons.location_on_outlined,
                      textCapitalization: TextCapitalization.words,
                      maxLength: AppValidators.addressLineMax,
                      validator: AppValidators.addressLine1,
                    ),
                    _AddressField(
                      controller: _line2Controller,
                      label: 'Address line 2',
                      hint: 'Apartment, landmark (optional)',
                      textCapitalization: TextCapitalization.words,
                      maxLength: AppValidators.addressLineMax,
                      validator: AppValidators.addressLine2,
                    ),
                    _AddressField(
                      controller: _cityController,
                      label: 'City',
                      icon: Icons.location_city_outlined,
                      textCapitalization: TextCapitalization.words,
                      maxLength: AppValidators.cityMax,
                      validator: AppValidators.city,
                    ),
                    _AddressField(
                      controller: _postalController,
                      label: 'Postal code',
                      hint: 'Optional',
                      keyboardType: TextInputType.number,
                      maxLength: AppValidators.postalCodeLength,
                      inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                      validator: AppValidators.postalCode,
                    ),
                  ],
                ),
                const _SectionLabel('LOCATION'),
                _FormSection(
                  children: [
                    // No GPS, geocoding or map picker exists in this build,
                    // so this says what the numbers are for and nothing
                    // more - it never implies a detected position.
                    const _SectionNote(
                      icon: Icons.my_location_rounded,
                      title: 'Delivery location',
                      message:
                          'Your delivery location helps us confirm service '
                          'availability.',
                    ),
                    Row(
                      children: [
                        Expanded(
                          child: _AddressField(
                            controller: _latController,
                            label: 'Latitude',
                            keyboardType: const TextInputType.numberWithOptions(
                              decimal: true,
                              signed: true,
                            ),
                            inputFormatters: [_coordinateFormatter],
                            validator: AppValidators.latitude,
                          ),
                        ),
                        const _FieldDivider(),
                        Expanded(
                          child: _AddressField(
                            controller: _lngController,
                            label: 'Longitude',
                            keyboardType: const TextInputType.numberWithOptions(
                              decimal: true,
                              signed: true,
                            ),
                            inputFormatters: [_coordinateFormatter],
                            validator: AppValidators.longitude,
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
                const _SectionLabel('DELIVERY NOTES'),
                _FormSection(
                  children: [
                    _AddressField(
                      controller: _instructionsController,
                      label: 'Delivery instructions',
                      hint: 'Gate code, landmark, when to call (optional)',
                      icon: Icons.sticky_note_2_outlined,
                      maxLines: 2,
                      maxLength: AppValidators.instructionsMax,
                      textCapitalization: TextCapitalization.sentences,
                      validator: AppValidators.deliveryInstructions,
                    ),
                  ],
                ),
                const SizedBox(height: AppSpacing.lg),
                _DefaultAddressTile(
                  value: _isDefault,
                  onChanged: (value) => setState(() => _isDefault = value),
                ),
              ],
            ),
          ),
        ),
      ),
      // Pinned rather than the last row of the scrolling form: this form is
      // taller than a phone viewport, and a primary action you have to
      // scroll to find is a poor one.
      bottomNavigationBar: _ActionBar(
        isSaving: _isSaving,
        onCancel: () => Navigator.of(context).pop(),
        onSave: _save,
      ),
    );
  }
}

/// Home / Work / Other, writing into the backend's existing free-text
/// label field - no new API field was added for this.
class _LabelPicker extends StatelessWidget {
  const _LabelPicker({required this.selected, required this.onChanged});

  final String selected;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    const options = [..._kLabelPresets, _kOtherLabel];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Padding(
          padding: EdgeInsets.only(bottom: AppSpacing.sm),
          child: Text(
            'Save address as',
            style: TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w700,
              color: AppTextColors.secondary,
            ),
          ),
        ),
        // Wraps rather than overflowing when the type scale is large or
        // the phone is narrow.
        Wrap(
          spacing: AppSpacing.sm,
          runSpacing: AppSpacing.sm,
          children: [
            for (final option in options)
              _LabelChip(
                label: option,
                isSelected: option == selected,
                onTap: () => onChanged(option),
              ),
          ],
        ),
      ],
    );
  }
}

class _LabelChip extends StatelessWidget {
  const _LabelChip({
    required this.label,
    required this.isSelected,
    required this.onTap,
  });

  final String label;
  final bool isSelected;
  final VoidCallback onTap;

  static const _icons = {
    'Home': Icons.home_outlined,
    'Work': Icons.work_outline_rounded,
    _kOtherLabel: Icons.place_outlined,
  };

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      selected: isSelected,
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          borderRadius: BorderRadius.circular(AppRadius.chip),
          onTap: onTap,
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 180),
            curve: Curves.easeOut,
            padding: const EdgeInsets.symmetric(
              horizontal: AppSpacing.lg,
              vertical: AppSpacing.sm + 2,
            ),
            decoration: BoxDecoration(
              color: isSelected
                  ? AppColors.primaryYellowColor
                  : Colors.white,
              borderRadius: BorderRadius.circular(AppRadius.chip),
              border: Border.all(
                color: isSelected
                    ? AppColors.primaryYellowColor
                    : AppSurfaces.border,
              ),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(
                  _icons[label] ?? Icons.place_outlined,
                  size: 16,
                  color: isSelected
                      ? AppTextColors.onYellow
                      : AppTextColors.secondary,
                ),
                const SizedBox(width: AppSpacing.xs + 2),
                Text(
                  label,
                  style: TextStyle(
                    fontSize: 13.5,
                    fontWeight: FontWeight.w700,
                    color: isSelected
                        ? AppTextColors.onYellow
                        : AppTextColors.primary,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _SectionLabel extends StatelessWidget {
  const _SectionLabel(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.xs,
        AppSpacing.xl,
        AppSpacing.xs,
        AppSpacing.sm,
      ),
      child: Semantics(
        header: true,
        child: Text(
          text,
          style: const TextStyle(
            fontSize: 11,
            fontWeight: FontWeight.w800,
            letterSpacing: 1,
            color: AppTextColors.secondary,
          ),
        ),
      ),
    );
  }
}

/// One card per section with hairline dividers between its fields, so a
/// section reads as a single grouped block instead of loose white boxes.
class _FormSection extends StatelessWidget {
  const _FormSection({required this.children});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: AppRadius.cardBorder,
        border: Border.all(color: AppSurfaces.border),
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        children: [
          for (var i = 0; i < children.length; i++) ...[
            if (i > 0)
              const Divider(
                height: 1,
                thickness: 1,
                color: AppSurfaces.subtle,
              ),
            children[i],
          ],
        ],
      ),
    );
  }
}

class _FieldDivider extends StatelessWidget {
  const _FieldDivider();

  @override
  Widget build(BuildContext context) {
    return const SizedBox(
      height: 56,
      child: VerticalDivider(width: 1, thickness: 1, color: AppSurfaces.subtle),
    );
  }
}

/// A borderless field inside a section card: compact height, a floating
/// label once it has a value or focus, and an icon only where one actually
/// helps scanning.
class _AddressField extends StatelessWidget {
  const _AddressField({
    required this.controller,
    required this.label,
    this.hint,
    this.icon,
    this.keyboardType,
    this.validator,
    this.maxLines = 1,
    this.maxLength,
    this.inputFormatters,
    this.textCapitalization = TextCapitalization.none,
  });

  final TextEditingController controller;
  final String label;
  final String? hint;
  final IconData? icon;
  final TextInputType? keyboardType;
  final FormFieldValidator<String>? validator;
  final int maxLines;
  final int? maxLength;
  final List<TextInputFormatter>? inputFormatters;
  final TextCapitalization textCapitalization;

  @override
  Widget build(BuildContext context) {
    return TextFormField(
      controller: controller,
      keyboardType: keyboardType,
      maxLines: maxLines,
      maxLength: maxLength,
      // The limit is enforced, but no "12/80" counter clutters the form.
      buildCounter: (_, {required currentLength, required isFocused, maxLength}) =>
          null,
      inputFormatters: inputFormatters,
      textCapitalization: textCapitalization,
      textInputAction:
          maxLines > 1 ? TextInputAction.newline : TextInputAction.next,
      style: const TextStyle(
        fontSize: 15,
        fontWeight: FontWeight.w600,
        color: AppTextColors.primary,
      ),
      decoration: InputDecoration(
        labelText: label,
        hintText: hint,
        // Fields without an icon keep the same text inset, so a section
        // reads as one aligned column instead of a ragged edge.
        prefixIcon: Padding(
          padding: const EdgeInsets.only(
            left: AppSpacing.md,
            right: AppSpacing.sm,
          ),
          child: icon == null
              ? const SizedBox(width: 19)
              : Icon(icon, size: 19, color: AppTextColors.muted),
        ),
        prefixIconConstraints: const BoxConstraints(minWidth: 0, minHeight: 0),
        filled: true,
        fillColor: Colors.white,
        isDense: true,
        contentPadding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.lg,
          vertical: AppSpacing.md + 2,
        ),
        // The card draws the outline; the field only shows state.
        border: InputBorder.none,
        enabledBorder: InputBorder.none,
        errorBorder: InputBorder.none,
        focusedErrorBorder: InputBorder.none,
        // Focus reads as a yellow underline rather than a heavy box.
        focusedBorder: const UnderlineInputBorder(
          borderSide: BorderSide(
            color: AppColors.primaryYellowColor,
            width: 2,
          ),
        ),
        labelStyle: const TextStyle(fontSize: 14, color: AppTextColors.secondary),
        floatingLabelStyle: const TextStyle(
          fontSize: 12,
          fontWeight: FontWeight.w700,
          color: AppTextColors.secondary,
        ),
        hintStyle: const TextStyle(fontSize: 14, color: AppTextColors.muted),
      ),
      validator: validator,
    );
  }
}

class _SectionNote extends StatelessWidget {
  const _SectionNote({
    required this.icon,
    required this.title,
    required this.message,
  });

  final IconData icon;
  final String title;
  final String message;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.lg,
        AppSpacing.md + 2,
        AppSpacing.lg,
        AppSpacing.md,
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 18, color: AppColors.primaryGreenColor),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: const TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                    color: AppTextColors.primary,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  message,
                  style: const TextStyle(
                    fontSize: 12.5,
                    height: 1.35,
                    color: AppTextColors.secondary,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _DefaultAddressTile extends StatelessWidget {
  const _DefaultAddressTile({required this.value, required this.onChanged});

  final bool value;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: AppRadius.cardBorder,
        border: Border.all(color: AppSurfaces.border),
      ),
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.lg,
        AppSpacing.md,
        AppSpacing.md,
        AppSpacing.md,
      ),
      child: Row(
        children: [
          const Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Default delivery address',
                  style: TextStyle(
                    fontSize: 14.5,
                    fontWeight: FontWeight.w700,
                    color: AppTextColors.primary,
                  ),
                ),
                SizedBox(height: 2),
                Text(
                  'Use this address automatically at checkout',
                  style: TextStyle(
                    fontSize: 12.5,
                    color: AppTextColors.secondary,
                  ),
                ),
              ],
            ),
          ),
          Switch(
            value: value,
            onChanged: onChanged,
            activeThumbColor: AppTextColors.onYellow,
            activeTrackColor: AppColors.primaryYellowColor,
          ),
        ],
      ),
    );
  }
}

class _ActionBar extends StatelessWidget {
  const _ActionBar({
    required this.isSaving,
    required this.onCancel,
    required this.onSave,
  });

  final bool isSaving;
  final VoidCallback onCancel;
  final VoidCallback onSave;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: const BoxDecoration(
        color: Colors.white,
        border: Border(top: BorderSide(color: AppSurfaces.border)),
      ),
      child: SafeArea(
        top: false,
        child: Center(
          heightFactor: 1,
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 560),
            child: Padding(
              padding: const EdgeInsets.fromLTRB(
                AppSpacing.lg,
                AppSpacing.md,
                AppSpacing.lg,
                AppSpacing.md,
              ),
              child: Row(
                children: [
                  Expanded(
                    child: SizedBox(
                      height: 50,
                      child: OutlinedButton(
                        onPressed: isSaving ? null : onCancel,
                        child: const Text('Cancel'),
                      ),
                    ),
                  ),
                  const SizedBox(width: AppSpacing.md),
                  Expanded(
                    flex: 2,
                    child: SizedBox(
                      height: 50,
                      child: ElevatedButton(
                        onPressed: isSaving ? null : onSave,
                        child: isSaving
                            ? const SizedBox(
                                width: 18,
                                height: 18,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                  color: AppTextColors.onYellow,
                                ),
                              )
                            : const FittedBox(
                                child: Text('Save Address'),
                              ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
