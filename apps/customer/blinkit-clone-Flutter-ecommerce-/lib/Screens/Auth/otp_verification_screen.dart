import 'dart:async';
import 'package:flutter/foundation.dart' show kDebugMode;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:ecom/Services/Validation/app_validators.dart';
import 'package:ecom/UI/Widgets/Atoms/app_toast.dart';
import 'package:provider/provider.dart';

import 'package:ecom/Infrastructure/LocalStorage/guest_choice_storage.dart';
import 'package:ecom/Services/Providers/auth.provider.dart';
import 'package:ecom/Services/app_errors.dart';
import 'package:ecom/design/tokens.dart';
import 'package:ecom/UI/Widgets/Atoms/blynk_button.dart';
import 'package:ecom/UI/Widgets/Atoms/blynk_text_field.dart';
import 'package:ecom/Screens/Auth/name_capture_screen.dart';

class OTPVerificationScreen extends StatefulWidget {
  const OTPVerificationScreen({super.key, this.data, bool? isDebug})
      : isDebug = isDebug ?? kDebugMode;

  final dynamic data;

  /// The dev code (auto-fill and the "Dev Code" chip) exists only in a debug
  /// build. A parameter so a test can prove a release build ignores it.
  final bool isDebug;

  @override
  State<OTPVerificationScreen> createState() => _OTPVerificationScreenState();
}

class _OTPVerificationScreenState extends State<OTPVerificationScreen> {
  late TextEditingController _otpController;
  int _secondsRemaining = 30;
  Timer? _timer;
  bool _isLoading = false;

  // Shown under the code field (a live region), in the customer's words.
  String? _errorText;

  String get _phoneNumber {
    if (widget.data is Map && widget.data['phoneNumber'] != null) {
      return widget.data['phoneNumber'].toString();
    } else if (widget.data is String) {
      return widget.data.toString();
    }
    return '';
  }

  @override
  void initState() {
    super.initState();
    _otpController = TextEditingController();
    _otpController.addListener(() {
      if (_errorText != null && mounted) setState(() => _errorText = null);
    });
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final auth = Provider.of<AuthProvider>(context, listen: false);
      final devCode = _devCode(auth);
      if (devCode != null) {
        setState(() {
          _otpController.text = devCode;
        });
      }
    });
    _startTimer();
  }

  String? _devCode(AuthProvider auth) {
    if (!widget.isDebug) return null;
    final code = auth.lastDevOtp;
    return code != null && code.isNotEmpty ? code : null;
  }

  Future<void> _verifyOTP(BuildContext context, String otp) async {
    FocusScope.of(context).unfocus();
    final cleanOtp = otp.trim();

    // Same contract as the backend's verifyOtpSchema: exactly 6 digits.
    if (AppValidators.otp(cleanOtp) != null) {
      setState(() => _errorText = 'Enter the 6-digit OTP');
      return;
    }

    setState(() {
      _errorText = null;
      _isLoading = true;
    });

    try {
      final authProvider = Provider.of<AuthProvider>(context, listen: false);
      await authProvider.verifyOtp(_phoneNumber, cleanOtp);

      if (!mounted) return;
      setState(() {
        _isLoading = false;
      });

      if (!context.mounted) return;
      // A new customer (no name on the account) is asked for it first.
      Navigator.of(context).pushNamedAndRemoveUntil(
        authProvider.needsName ? NameCaptureScreen.route : '/home',
        (route) => false,
      );
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _isLoading = false;
        _errorText = AppErrors.from(e).message;
      });
    }
  }

  void _startTimer() {
    const oneSec = Duration(seconds: 1);
    _timer?.cancel();
    _timer = Timer.periodic(
      oneSec,
      (Timer timer) {
        if (_secondsRemaining <= 1) {
          timer.cancel();
          setState(() {
            _secondsRemaining = 0;
          });
        } else {
          setState(() {
            _secondsRemaining--;
          });
        }
      },
    );
  }

  Future<void> _restartTimer() async {
    if (_phoneNumber.isEmpty) return;

    try {
      final authProvider = Provider.of<AuthProvider>(context, listen: false);
      await authProvider.requestOtp(_phoneNumber);

      final devCode = _devCode(authProvider);
      if (devCode != null) {
        setState(() {
          _otpController.text = devCode;
        });
      }

      showAppToast(msg: "A new OTP code has been sent");

      setState(() {
        _secondsRemaining = 30;
      });
      _startTimer();
    } catch (e) {
      if (mounted) setState(() => _errorText = AppErrors.from(e).message);
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    _otpController.dispose();
    super.dispose();
  }

  /// Both skips here: remembered, so the next launch opens on the shop.
  void _skipToShop() {
    unawaited(GuestChoiceStorage.rememberSkippedLogin());
    Navigator.of(context).pushNamedAndRemoveUntil('/home', (route) => false);
  }

  @override
  Widget build(BuildContext context) {
    final displayPhone = _phoneNumber.startsWith('+')
        ? _phoneNumber
        : (_phoneNumber.isNotEmpty ? "+94 $_phoneNumber" : "");

    final auth = Provider.of<AuthProvider>(context);
    final devCode = _devCode(auth);

    return Scaffold(
      backgroundColor: BlynkColors.paper,
      appBar: AppBar(
        title: const Text('OTP verification'),
        actions: [
          BlynkButton.tertiary(
            label: 'Skip',
            onPressed: _skipToShop,
          ),
          const SizedBox(width: BlynkSpace.s8),
        ],
      ),
      body: Align(
        alignment: Alignment.topCenter,
        child: ConstrainedBox(
          // A form, not a stretched phone layout: one centred column.
          constraints: const BoxConstraints(maxWidth: _kColumnMaxWidth),
          child: SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(
              BlynkSpace.s16,
              BlynkSpace.s24,
              BlynkSpace.s16,
              BlynkSpace.s32,
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Semantics(
                  header: true,
                  child: const Text(
                    'Enter your verification code',
                    style: BlynkText.title,
                  ),
                ),
                const SizedBox(height: BlynkSpace.s8),
                Text.rich(
                  TextSpan(
                    text: "We've sent a 6-digit code to ",
                    children: [
                      TextSpan(text: displayPhone, style: BlynkText.label),
                    ],
                  ),
                  style: BlynkText.body.copyWith(color: BlynkColors.ink2),
                ),
                if (devCode != null) ...[
                  const SizedBox(height: BlynkSpace.s12),
                  Align(
                    alignment: Alignment.centerLeft,
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: BlynkSpace.s12,
                        vertical: BlynkSpace.s4,
                      ),
                      decoration: const BoxDecoration(
                        color: BlynkColors.well,
                        borderRadius: BlynkRadius.smAll,
                      ),
                      child: Text(
                        "Dev Code: $devCode (auto-filled)",
                        style: BlynkText.caption,
                      ),
                    ),
                  ),
                ],
                const SizedBox(height: BlynkSpace.s24),
                BlynkTextField(
                  label: 'Verification code',
                  hintText: 'Enter 6-digit OTP',
                  controller: _otpController,
                  maxLength: 6,
                  autofocus: true,
                  keyboardType: TextInputType.number,
                  autofillHints: const [AutofillHints.oneTimeCode],
                  inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                  errorText: _errorText,
                  onSubmitted: (value) {
                    if (value.isNotEmpty) _verifyOTP(context, value);
                  },
                ),
                const SizedBox(height: BlynkSpace.s24),
                BlynkButton.primary(
                  label: 'Verify',
                  expand: true,
                  loading: _isLoading,
                  onPressed: () => _verifyOTP(context, _otpController.text),
                ),
                const SizedBox(height: BlynkSpace.s8),
                // The countdown is a read-out, not a control, so it keeps the
                // resend button's slot instead of shifting the column.
                Align(
                  child: (_timer != null && _timer!.isActive && _secondsRemaining > 0)
                      ? Padding(
                          padding: const EdgeInsets.symmetric(
                            vertical: BlynkSpace.s16,
                          ),
                          child: Text(
                            'Resend OTP in $_secondsRemaining s',
                            style: BlynkText.body.copyWith(color: BlynkColors.ink2),
                          ),
                        )
                      : BlynkButton.tertiary(
                          label: 'Resend OTP',
                          onPressed: _restartTimer,
                        ),
                ),
                const SizedBox(height: BlynkSpace.s8),
                Align(
                  child: BlynkButton.tertiary(
                    label: 'Skip & explore store',
                    onPressed: _skipToShop,
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

/// The OTP column's cap: a code field and one action never need more.
/// W8: the number is now [BlynkForm.narrowMaxWidth] — same 480, named once.
const double _kColumnMaxWidth = BlynkForm.narrowMaxWidth;
