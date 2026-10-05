import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:ecom/Services/Validation/app_validators.dart';
import 'package:ecom/UI/Widgets/Atoms/app_toast.dart';
import 'package:provider/provider.dart';

import '../Models/address_model.dart';
import '../Services/Location/device_location_source.dart';
import '../Services/Providers/address.provider.dart';
import '../Services/store_info.dart';
import '../UI/Widgets/Atoms/blynk_button.dart';
import '../UI/Widgets/Atoms/blynk_text_field.dart';
import '../UI/Widgets/Organisms/map_provider.dart';
import '../design/tokens.dart';
import 'live_location_picker_screen.dart';

// The backend's createAddressSchema requires explicit numeric latitude and
// longitude (see backend/api/src/modules/users/address.schema.ts). They stay
// plain editable fields defaulted to the real Dharga Town hub coordinates:
// "Use my current location" opens LiveLocationPickerScreen (a real device fix
// the customer confirms on a map) and writes its result into these same
// fields, which remain as the fallback and for corrections. There is no
// geocoding: nothing turns coordinates into an address or the reverse.
class AddEditAddressScreen extends StatefulWidget {
  const AddEditAddressScreen({
    super.key,
    this.existing,
    this.locationSource,
    this.pickerMapBuilder,
  });

  final AddressModel? existing;

  /// Test seams, passed straight to [LiveLocationPickerScreen]: fake device
  /// location and a fake map, so widget tests touch no plugin or platform
  /// view. Production callers leave both null.
  final DeviceLocationSource? locationSource;
  final LocationPickerMapBuilder? pickerMapBuilder;

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

/// Tablet/desktop get a centred column, not a stretched form.
/// W8: the number is now [BlynkForm.maxWidth] — same 560, named once.
const double _kFormMaxWidth = BlynkForm.maxWidth;

class _AddEditAddressScreenState extends State<AddEditAddressScreen> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _labelController;
  late final TextEditingController _nameController;
  late final TextEditingController _phoneController;
  /// Optional second number for the rider (backend migration 024).
  late final TextEditingController _altPhoneController;
  /// One "Address" box (2026-10-04, owner: fewer fields). Line 2, city and
  /// postal code are no longer asked: the city is always the hub's, and an
  /// old address's second line is folded into this box when it is edited.
  late final TextEditingController _line1Controller;
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
    _altPhoneController = TextEditingController(text: e?.alternatePhone ?? '');
    _line1Controller = TextEditingController(
      text: [e?.addressLine1, e?.addressLine2]
          .whereType<String>()
          .map((v) => v.trim())
          .where((v) => v.isNotEmpty)
          .join(', '),
    );
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
    _altPhoneController.dispose();
    _line1Controller.dispose();
    _latController.dispose();
    _lngController.dispose();
    _instructionsController.dispose();
    super.dispose();
  }

  /// Opens the picker; a confirmed position replaces both coordinate fields
  /// (6 decimals, about 0.1 m). Backing out returns null and changes nothing.
  Future<void> _useCurrentLocation() async {
    final picked = await Navigator.of(context).push<GeoPoint>(
      MaterialPageRoute(
        builder: (_) => LiveLocationPickerScreen(
          locationSource: widget.locationSource,
          mapBuilder: widget.pickerMapBuilder,
        ),
      ),
    );
    if (picked == null || !mounted) return;
    setState(() {
      _latController.text = picked.latitude.toStringAsFixed(6);
      _lngController.text = picked.longitude.toStringAsFixed(6);
    });
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
      // Optional: null (not '') when left empty, which also clears it on edit.
      alternatePhone: AppValidators.normalizePhone(_altPhoneController.text),
      addressLine1: AppValidators.normalizeText(_line1Controller.text),
      addressLine2: null,
      // Not asked any more: the city is the hub's; an edited address keeps
      // its saved city and postal code.
      city: widget.existing?.city ?? StoreInfo.hubName,
      postalCode: widget.existing?.postalCode,
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
      backgroundColor: BlynkColors.paper,
      appBar: AppBar(
        title: Text(_isEditing ? 'Edit Address' : 'Add Address'),
        backgroundColor: BlynkColors.paper,
        surfaceTintColor: BlynkColors.paper,
        elevation: 0,
        // Hairline separation only once the form scrolls under it.
        scrolledUnderElevation: 0.5,
      ),
      body: Align(
        alignment: Alignment.topCenter,
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: _kFormMaxWidth),
          child: Form(
            key: _formKey,
            // After the first interaction a corrected field clears its own
            // error as you type, instead of waiting for the next Save.
            autovalidateMode: AutovalidateMode.onUserInteraction,
            child: ListView(
              padding: const EdgeInsets.fromLTRB(
                BlynkSpace.s16,
                BlynkSpace.s16,
                BlynkSpace.s16,
                BlynkSpace.s32,
              ),
              children: [
                _LabelPicker(
                  selected: _selectedPreset,
                  onChanged: (value) =>
                      setState(() => _selectedPreset = value),
                ),
                if (_isCustomLabel) ...[
                  const SizedBox(height: BlynkSpace.s16),
                  _FormSection(
                    children: [
                      _AddressField(
                        controller: _labelController,
                        label: 'Address name',
                        hint: 'e.g. Parents, Hostel',
                        textCapitalization: TextCapitalization.words,
                        maxLength: AppValidators.addressNameMax,
                        validator: AppValidators.addressName,
                      ),
                    ],
                  ),
                ],
                const _SectionLabel('Contact'),
                _FormSection(
                  children: [
                    _AddressField(
                      controller: _nameController,
                      label: 'Recipient name',
                      hint: 'Who receives the order',
                      textCapitalization: TextCapitalization.words,
                      maxLength: AppValidators.recipientNameMax,
                      validator: AppValidators.recipientName,
                    ),
                    _AddressField(
                      controller: _phoneController,
                      label: 'Recipient phone',
                      hint: '07XXXXXXXX',
                      keyboardType: TextInputType.phone,
                      maxLength: 16,
                      // Keeps letters out while typing; a pasted number with
                      // spaces or +94 still normalizes on save.
                      inputFormatters: [_phoneFormatter],
                      validator: AppValidators.phone,
                    ),
                    _AddressField(
                      controller: _altPhoneController,
                      label: 'Additional phone (optional)',
                      hint: 'Another number we can call',
                      keyboardType: TextInputType.phone,
                      maxLength: 16,
                      inputFormatters: [_phoneFormatter],
                      validator: (value) => AppValidators.optionalPhone(
                        value,
                        differentFrom: _phoneController.text,
                      ),
                    ),
                  ],
                ),
                const _SectionLabel('Delivery address'),
                _FormSection(
                  children: [
                    _AddressField(
                      controller: _line1Controller,
                      label: 'Address',
                      hint: 'House no., street, landmark',
                      textCapitalization: TextCapitalization.words,
                      maxLength: AppValidators.addressLineMax,
                      validator: AppValidators.addressLine1,
                    ),
                  ],
                ),
                const _SectionLabel('Location'),
                _FormSection(
                  children: [
                    // Says what the numbers are for and nothing more - it
                    // never implies a detected position; only the picker
                    // below detects one, and only when tapped.
                    const _SectionNote(
                      icon: Icons.my_location,
                      title: 'Delivery location',
                      message:
                          'Your delivery location helps us confirm service '
                          'availability.',
                    ),
                    // Full width and at least 48 dp tall, growing when a large
                    // font wraps the label (a fixed height clipped it at 1.6x).
                    BlynkButton.secondary(
                      label: 'Use my current location',
                      leadingIcon: Icons.gps_fixed,
                      expand: true,
                      onPressed: _useCurrentLocation,
                    ),
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Expanded(
                          child: _AddressField(
                            controller: _latController,
                            label: 'Latitude',
                            showClear: false,
                            keyboardType: const TextInputType.numberWithOptions(
                              decimal: true,
                              signed: true,
                            ),
                            inputFormatters: [_coordinateFormatter],
                            validator: AppValidators.latitude,
                          ),
                        ),
                        const SizedBox(width: BlynkSpace.s12),
                        Expanded(
                          child: _AddressField(
                            controller: _lngController,
                            label: 'Longitude',
                            showClear: false,
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
                const _SectionLabel('Delivery notes'),
                _FormSection(
                  children: [
                    _AddressField(
                      controller: _instructionsController,
                      label: 'Delivery instructions',
                      hint: 'Gate code, landmark, when to call (optional)',
                      maxLines: 2,
                      maxLength: AppValidators.instructionsMax,
                      textCapitalization: TextCapitalization.sentences,
                      validator: AppValidators.deliveryInstructions,
                    ),
                  ],
                ),
                const SizedBox(height: BlynkSpace.s24),
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
        Padding(
          padding: const EdgeInsets.only(bottom: BlynkSpace.s8),
          child: Semantics(
            header: true,
            child: Text(
              'Save address as',
              style: BlynkText.caption.copyWith(color: BlynkColors.ink2),
            ),
          ),
        ),
        // Wraps rather than overflowing when the type scale is large or
        // the phone is narrow.
        Wrap(
          spacing: BlynkSpace.s8,
          runSpacing: BlynkSpace.s8,
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

/// Selection chrome, not an action: a selected chip wears the `signal` fill
/// the nav's selected tile does, so it does not consume the screen's one
/// yellow *action* (plan §4.3, T2 report §8 A).
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
    'Home': BlynkIcons.addressHome,
    'Work': BlynkIcons.addressWork,
    _kOtherLabel: BlynkIcons.addressOther,
  };

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      selected: isSelected,
      child: Material(
        color: BlynkColors.clear,
        child: InkWell(
          borderRadius: BlynkRadius.full,
          onTap: onTap,
          child: AnimatedContainer(
            duration: BlynkMotion.resolve(context, BlynkMotion.fast),
            curve: BlynkMotion.easeOut,
            constraints: const BoxConstraints(minHeight: BlynkControl.minHeight),
            alignment: Alignment.center,
            padding: const EdgeInsets.symmetric(
              horizontal: BlynkSpace.s16,
              vertical: BlynkSpace.s8,
            ),
            decoration: BoxDecoration(
              color: isSelected ? BlynkNav.selectedTile : BlynkColors.paper,
              borderRadius: BlynkRadius.full,
              border: Border.all(
                color: isSelected ? BlynkNav.selectedTile : BlynkColors.lineStrong,
                width: BlynkControl.outlineWidth,
              ),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(
                  _icons[label] ?? BlynkIcons.addressOther,
                  size: BlynkIcons.xs,
                  color: isSelected ? BlynkColors.onSignal : BlynkColors.ink2,
                ),
                const SizedBox(width: BlynkSpace.s8),
                Text(
                  label,
                  style: BlynkText.label.copyWith(
                    color: isSelected ? BlynkColors.onSignal : BlynkColors.ink,
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
        BlynkSpace.s4,
        BlynkSpace.s24,
        BlynkSpace.s4,
        BlynkSpace.s8,
      ),
      child: Semantics(
        header: true,
        child: Text(
          text,
          style: BlynkText.caption.copyWith(color: BlynkColors.ink2),
        ),
      ),
    );
  }
}

/// A section's fields, separated by space rather than by hairlines or a box.
/// Each field already carries its own `well` fill and label, so the grouping
/// needs no rule and no card around it.
class _FormSection extends StatelessWidget {
  const _FormSection({required this.children});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (var i = 0; i < children.length; i++) ...[
          if (i > 0) const SizedBox(height: BlynkSpace.s16),
          children[i],
        ],
      ],
    );
  }
}

/// A [BlynkTextField] that still takes part in the [Form]: the validator, the
/// `Form.validate()` gate on Save and the on-interaction re-validation are
/// exactly what they were, and the message is presented by the shared field
/// (2 dp problem border, inline glyph, live region) instead of Material's
/// default decoration.
class _AddressField extends StatefulWidget {
  const _AddressField({
    required this.controller,
    required this.label,
    this.hint,
    this.keyboardType,
    this.validator,
    this.maxLines = 1,
    this.maxLength,
    this.inputFormatters,
    this.textCapitalization = TextCapitalization.none,
    this.showClear = true,
  });

  final TextEditingController controller;
  final String label;
  final String? hint;
  final TextInputType? keyboardType;
  final FormFieldValidator<String>? validator;
  final int maxLines;
  final int? maxLength;
  final List<TextInputFormatter>? inputFormatters;
  final TextCapitalization textCapitalization;
  final bool showClear;

  @override
  State<_AddressField> createState() => _AddressFieldState();
}

class _AddressFieldState extends State<_AddressField> {
  FormFieldState<String>? _field;

  @override
  void initState() {
    super.initState();
    widget.controller.addListener(_syncFromController);
  }

  @override
  void dispose() {
    widget.controller.removeListener(_syncFromController);
    super.dispose();
  }

  /// The picker writes straight into the coordinate controllers, so the form
  /// field has to hear about a change it did not originate - otherwise the
  /// validator would still be judging the previous text.
  void _syncFromController() {
    final field = _field;
    if (field == null) return;
    if (field.value != widget.controller.text) {
      field.didChange(widget.controller.text);
    }
  }

  @override
  Widget build(BuildContext context) {
    return FormField<String>(
      initialValue: widget.controller.text,
      validator: widget.validator,
      builder: (field) {
        _field = field;
        return BlynkTextField(
          label: widget.label,
          controller: widget.controller,
          hintText: widget.hint,
          errorText: field.errorText,
          keyboardType: widget.keyboardType,
          textCapitalization: widget.textCapitalization,
          inputFormatters: widget.inputFormatters,
          maxLength: widget.maxLength,
          maxLines: widget.maxLines,
          showClear: widget.showClear,
          textInputAction: widget.maxLines > 1
              ? TextInputAction.newline
              : TextInputAction.next,
          onChanged: field.didChange,
        );
      },
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
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(icon, size: BlynkIcons.sm, color: BlynkColors.ink2),
        const SizedBox(width: BlynkSpace.s12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(title, style: BlynkText.label),
              const SizedBox(height: BlynkSpace.s4),
              Text(
                message,
                style: BlynkText.caption.copyWith(color: BlynkColors.ink2),
              ),
            ],
          ),
        ),
      ],
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
      // A setting, not a form field: a soft tinted well, no border.
      decoration: const BoxDecoration(
        color: BlynkColors.well,
        borderRadius: BlynkRadius.lgAll,
      ),
      padding: const EdgeInsets.fromLTRB(
        BlynkSpace.s16,
        BlynkSpace.s12,
        BlynkSpace.s12,
        BlynkSpace.s12,
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('Default delivery address', style: BlynkText.label),
                const SizedBox(height: BlynkSpace.s4),
                Text(
                  'Use this address automatically at checkout',
                  style: BlynkText.caption.copyWith(color: BlynkColors.ink2),
                ),
              ],
            ),
          ),
          Switch(
            value: value,
            onChanged: onChanged,
            // Selection state, not the screen's action: the same `signal`
            // treatment the nav's selected tile uses.
            activeThumbColor: BlynkColors.onSignal,
            activeTrackColor: BlynkColors.signal,
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
        color: BlynkColors.paper,
        border: Border(top: BorderSide(color: BlynkColors.line)),
      ),
      child: SafeArea(
        top: false,
        child: Center(
          heightFactor: 1,
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: _kFormMaxWidth),
            child: Padding(
              padding: const EdgeInsets.fromLTRB(
                BlynkSpace.s16,
                BlynkSpace.s12,
                BlynkSpace.s16,
                BlynkSpace.s12,
              ),
              // The pair shares one height and stacks (primary on top) at a
              // large text scale or on a very narrow column, so neither label
              // is squeezed or clipped.
              child: BlynkButtonPair(
                secondary: BlynkButton.secondary(
                  label: 'Cancel',
                  expand: true,
                  onPressed: isSaving ? null : onCancel,
                ),
                primary: BlynkButton.cta(
                  label: 'Save address',
                  loading: isSaving,
                  onPressed: onSave,
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
