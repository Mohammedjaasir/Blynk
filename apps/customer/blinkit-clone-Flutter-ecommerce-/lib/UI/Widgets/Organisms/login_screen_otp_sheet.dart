import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:ecom/Services/Validation/app_validators.dart';
import 'package:ecom/UI/Widgets/Atoms/app_toast.dart';
import 'package:provider/provider.dart';

import '../../../app_colors.dart';
import '../../../constants.dart';
import '../../../Services/Providers/auth.provider.dart';
import '../Atoms/custom_button.dart';
import '../Atoms/custom_text_field.dart';

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
      showAppToast(
        msg: "Enter a valid Sri Lankan mobile number",
        backgroundColor: Colors.redAccent,
        textColor: Colors.white,
      );
      return;
    }

    final formattedPhone = formatToE164(input);

    setState(() {
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
      });

      final message = e.toString().replaceAll('Exception: ', '');
      showAppToast(
        msg: message,
        backgroundColor: Colors.redAccent,
        textColor: Colors.white,
      );
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
          color: Colors.white,
          borderRadius: BorderRadius.only(
            topLeft: Radius.circular(18.0),
            topRight: Radius.circular(18.0),
          ),
        ),
        child: Center(
          child: Form(
            key: _formKey,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const Text(
                  'Log in or Sign up',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontSize: 20,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const SizedBox(
                  height: 10,
                ),
                customTextField(
                  isPhoneNumberField: true,
                  textEditingController: _textEditingController,
                  prefix: "+94  ",
                  maxLength: 16,
                  hintText: "07XXXXXXXX",
                  // One phone rule for the whole app, matching the
                  // backend's normalizeSriLankanPhone.
                  inputFormatters: [
                    FilteringTextInputFormatter.allow(RegExp(r'[0-9 +()-]')),
                  ],
                  validator: AppValidators.phone,
                ),
                const SizedBox(
                  height: 10,
                ),
                _isLoading
                    ? const Center(
                        child: Padding(
                          padding: EdgeInsets.symmetric(vertical: 8.0),
                          child: CircularProgressIndicator(
                            color: AppColors.primaryGreenColor,
                          ),
                        ),
                      )
                    : customTextButton(
                        context,
                        callback: () async {
                          await _authorizeWithPhoneNumber(context);
                        },
                        title: "Continue",
                        padding: const EdgeInsets.symmetric(
                          horizontal: 110,
                          vertical: 8,
                        ),
                        color: AppColors.primaryGreenColor,
                      ),
                const SizedBox(
                  height: 6,
                ),
                Center(
                  child: TextButton(
                    onPressed: () {
                      Navigator.of(context).pushNamedAndRemoveUntil(
                        '/home',
                        (route) => false,
                      );
                    },
                    child: const Text(
                      'Skip for now',
                      style: TextStyle(
                        color: AppColors.primaryGreenColor,
                        fontWeight: FontWeight.bold,
                        fontSize: 14,
                      ),
                    ),
                  ),
                ),
                const SizedBox(
                  height: 6,
                ),
                const Text(
                  'By continuing, you agree to our terms of service and privacy policy',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontSize: 12,
                    color: Colors.grey,
                  ),
                )
              ],
            ),
          ),
        ),
      ),
    );
  }
}
