import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:ecom/Services/Validation/app_validators.dart';
import 'package:ecom/UI/Widgets/Atoms/app_toast.dart';
import 'package:provider/provider.dart';

import '../Models/address_model.dart';
import '../Models/user_model.dart';
import '../Services/Providers/auth.provider.dart';
import '../Services/Location/device_location_source.dart';
import '../Services/Providers/address.provider.dart';
import '../Services/store_info.dart';
import '../UI/Widgets/Atoms/blynk_button.dart';
import '../UI/Widgets/Atoms/blynk_text_field.dart';
import '../UI/Widgets/Organisms/map_provider.dart';
import '../design/tokens.dart';
import 'live_location_picker_screen.dart';

// The simple address form (2026-10-05, owner: "even someone who cannot read
// well must be able to order"): name, phone, an optional second phone, one
// Address box and one big "Use my current location" button. No address
// names (Home/Work), no latitude/longitude boxes, no notes, no default
// switch. Customers can still save as many addresses as they like.
//
// The backend's createAddressSchema requires numeric latitude and longitude
// (backend/api/src/modules/users/address.schema.ts). They are kept in hidden
// controllers defaulted to the Dharga Town hub; the location button opens
// LiveLocationPickerScreen (a real device fix the customer confirms on a
// map) and writes its result there. There is no geocoding.
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

// Digits, separators and a leading + only: a phone keyboard still offers
// letters on desktop, and a name in the phone box is the bug this prevents.
final _phoneFormatter =
    FilteringTextInputFormatter.allow(RegExp(r'[0-9 +()-]'));

/// Tablet/desktop get a centred column, not a stretched form.
/// W8: the number is now [BlynkForm.maxWidth] — same 560, named once.
const double _kFormMaxWidth = BlynkForm.maxWidth;

class _AddEditAddressScreenState extends State<AddEditAddressScreen> {
  final _formKey = GlobalKey<FormState>();
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
  bool _isDefault = false;
  bool _isSaving = false;
  /// True once the coordinates are the customer's own: an edited address,
  /// or a position confirmed in the picker.
  bool _locationSet = false;
  /// Save was tapped before the location: the note under the button turns
  /// red until the customer shares it (2026-10-05, owner: required, so a
  /// rider is never sent to the store's own pin).
  bool _locationMissing = false;

  bool get _isEditing => widget.existing != null;

  @override
  void initState() {
    super.initState();
    final e = widget.existing;
    // A new address starts with the account's own name and number, so most
    // customers only type the address itself.
    final me = e == null ? _signedInUser() : null;
    _nameController = TextEditingController(text: e?.recipientName ?? me?.fullName ?? '');
    _phoneController = TextEditingController(
        text: e?.recipientPhone ?? _localPhone(me?.phone) ?? '');
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
    // Not asked any more: an edited address keeps its default flag, and a
    // customer's first address becomes the default.
    _isDefault = e?.isDefault ?? _hasNoAddresses();
    _locationSet = e != null;
  }

  UserModel? _signedInUser() {
    try {
      return Provider.of<AuthProvider>(context, listen: false).currentUser;
    } on ProviderNotFoundException {
      return null;
    }
  }

  bool _hasNoAddresses() {
    try {
      return Provider.of<AddressProvider>(context, listen: false).addresses.isEmpty;
    } on ProviderNotFoundException {
      return false;
    }
  }

  /// +94771234567 -> 0771234567, the way people write their own number.
  static String? _localPhone(String? phone) {
    if (phone == null || phone.isEmpty) return null;
    return phone.startsWith('+94') ? '0${phone.substring(3)}' : phone;
  }

  @override
  void dispose() {
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
      _locationSet = true;
      _locationMissing = false;
    });
  }

  /// The backend's free-text `label`. The customer no longer names an
  /// address (2026-10-05, owner: no Home/Work/Other): a new one is saved with
  /// the backend's default and an edited one keeps what it had.
  String get _label => widget.existing?.label ?? 'Home';

  Future<void> _save() async {
    final fieldsOk = _formKey.currentState!.validate();
    if (!_locationSet) setState(() => _locationMissing = true);
    if (!fieldsOk || !_locationSet) return;

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
                _FormSection(
                  children: [
                    _AddressField(
                      controller: _nameController,
                      label: 'Name',
                      hint: 'Who will receive the order',
                      textCapitalization: TextCapitalization.words,
                      maxLength: AppValidators.recipientNameMax,
                      validator: AppValidators.recipientName,
                    ),
                    _AddressField(
                      controller: _phoneController,
                      label: 'Phone number',
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
                      label: 'Another phone number (optional)',
                      hint: 'Family or neighbour',
                      keyboardType: TextInputType.phone,
                      maxLength: 16,
                      inputFormatters: [_phoneFormatter],
                      validator: (value) => AppValidators.optionalPhone(
                        value,
                        differentFrom: _phoneController.text,
                      ),
                    ),
                    _AddressField(
                      controller: _line1Controller,
                      label: 'Address',
                      hint: 'House number, street, near which place',
                      textCapitalization: TextCapitalization.words,
                      maxLines: 2,
                      maxLength: AppValidators.addressLineMax,
                      validator: AppValidators.addressLine1,
                    ),
                  ],
                ),
                const SizedBox(height: BlynkSpace.s24),
                // Full width and at least 48 dp tall, growing when a large
                // font wraps the label.
                BlynkButton.secondary(
                  key: const Key('address-use-location'),
                  label: _locationSet ? 'Change my location' : 'Use my current location',
                  leadingIcon: Icons.gps_fixed,
                  expand: true,
                  onPressed: _useCurrentLocation,
                ),
                const SizedBox(height: BlynkSpace.s12),
                _SectionNote(
                  key: const Key('address-location-note'),
                  icon: _locationSet
                      ? Icons.check_circle
                      : _locationMissing
                          ? Icons.location_off_outlined
                          : Icons.my_location,
                  title: _locationSet
                      ? 'Location added'
                      : _locationMissing
                          ? 'Please share your location'
                          : 'Share your location',
                  message: _locationSet
                      ? 'The rider will come to this place.'
                      : 'Stand at your home and tap the button, so the rider can find you.',
                  problem: _locationMissing && !_locationSet,
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
    super.key,
    this.problem = false,
    required this.icon,
    required this.title,
    required this.message,
  });

  /// Shown in the error colour: something the customer still has to do.
  final bool problem;
  final IconData icon;
  final String title;
  final String message;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(icon, size: BlynkIcons.sm, color: problem ? BlynkColors.problem : BlynkColors.ink2),
        const SizedBox(width: BlynkSpace.s12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                title,
                style: problem ? BlynkText.label.copyWith(color: BlynkColors.problem) : BlynkText.label,
              ),
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
