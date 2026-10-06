import 'dart:async';

import 'package:flutter/material.dart';
import 'package:ecom/Infrastructure/LocalStorage/guest_choice_storage.dart';
import 'package:flutter/services.dart';
import 'package:ecom/Services/Validation/app_validators.dart';
import 'package:provider/provider.dart';

import '../../../constants.dart';
import '../../../design/tokens.dart';
import '../../../Services/Providers/auth.provider.dart';
import '../../../Services/app_errors.dart';
import '../Atoms/blynk_button.dart';
import '../Atoms/blynk_text_field.dart';

class LoginwithMobileWidget extends StatefulWidget {
  const LoginwithMobileWidget({
    super.key,
  });

  @override
  State<LoginwithMobileWidget> createState() => _LoginwithMobileWidgetState();
}

class _LoginwithMobileWidgetState extends State<LoginwithMobileWidget> {
  late TextEditingController _textEditingController;
  final _formKey = GlobalKey<FormState>();
  bool _isLoading = false;

  // Shown inline under the field: a SnackBar on the root messenger would sit
  // behind this modal sheet and its scrim.
  String? _errorText;

  @override
  void initState() {
    super.initState();
    _textEditingController = TextEditingController();
  }

  @override
  void dispose() {
    _textEditingController.dispose();
    super.dispose();
  }

  Future<void> _authorizeWithPhoneNumber(BuildContext context) async {
    FocusScope.of(context).unfocus();

    final input = _textEditingController.text.trim();
    if (AppValidators.phone(input) != null) {
      setState(() => _errorText = "Enter a valid Sri Lankan mobile number");
      return;
    }

    final formattedPhone = formatToE164(input);

    setState(() {
      _errorText = null;
      _isLoading = true;
    });

    try {
      final authProvider = Provider.of<AuthProvider>(context, listen: false);
      await authProvider.requestOtp(formattedPhone);

      if (!mounted) return;
      setState(() {
        _isLoading = false;
      });

      if (!context.mounted) return;
      Navigator.of(context).popAndPushNamed(
        '/otp/verify',
        arguments: {
          "phoneNumber": formattedPhone,
        },
      );
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _isLoading = false;
        _errorText = AppErrors.from(e).message;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      padding: MediaQuery.of(context).viewInsets,
      child: Container(
        padding: const EdgeInsets.symmetric(
          horizontal: 20,
          vertical: 16,
        ),
        decoration: const BoxDecoration(
          color: BlynkColors.paper,
          borderRadius: BlynkRadius.lgTop,
        ),
        child: Center(
          child: Form(
            key: _formKey,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const Text(
                  'Log in or sign up',
                  textAlign: TextAlign.center,
                  style: BlynkText.title,
                ),
                const SizedBox(
                  height: 10,
                ),
                BlynkTextField(
                  label: 'Mobile number',
                  controller: _textEditingController,
                  prefix: const Text('+94', style: BlynkText.label),
                  maxLength: 16,
                  hintText: "07XXXXXXXX",
                  keyboardType: TextInputType.phone,
                  autofillHints: const [AutofillHints.telephoneNumber],
                  autofocus: true,
                  errorText: _errorText,
                  onChanged: (_) {
                    if (_errorText != null) setState(() => _errorText = null);
                  },
                  // One phone rule for the whole app, matching the
                  // backend's normalizeSriLankanPhone.
                  inputFormatters: [
                    FilteringTextInputFormatter.allow(RegExp(r'[0-9 +()-]')),
                  ],
                ),
                const SizedBox(
                  height: 10,
                ),
                BlynkButton.primary(
                  label: 'Continue',
                  expand: true,
                  loading: _isLoading,
                  onPressed: () => _authorizeWithPhoneNumber(context),
                ),
                const SizedBox(
                  height: 6,
                ),
                Center(
                  child: BlynkButton.tertiary(
                    label: 'Skip for now',
                    onPressed: () {
                      // Remembered: the next launch opens on the shop.
                      unawaited(GuestChoiceStorage.rememberSkippedLogin());
                      Navigator.of(context).pushNamedAndRemoveUntil(
                        '/home',
                        (route) => false,
                      );
                    },
                  ),
                ),
                const SizedBox(
                  height: 6,
                ),
                Text(
                  'By continuing, you agree to our terms of service and privacy policy',
                  textAlign: TextAlign.center,
                  style: BlynkText.caption.copyWith(color: BlynkColors.ink2),
                )
              ],
            ),
          ),
        ),
      ),
    );
  }
}
