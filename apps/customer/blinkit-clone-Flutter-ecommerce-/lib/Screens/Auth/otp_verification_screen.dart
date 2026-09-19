import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:ecom/Services/Validation/app_validators.dart';
import 'package:ecom/UI/Widgets/Atoms/app_toast.dart';
import 'package:provider/provider.dart';

import 'package:ecom/Services/Providers/auth.provider.dart';
import 'package:ecom/UI/Widgets/Atoms/custom_button.dart';
import 'package:ecom/UI/Widgets/Atoms/custom_text_field.dart';
import 'package:ecom/app_colors.dart';

class OTPVerificationScreen extends StatefulWidget {
  const OTPVerificationScreen({super.key, this.data});

  final dynamic data;

  @override
  State<OTPVerificationScreen> createState() => _OTPVerificationScreenState();
}

class _OTPVerificationScreenState extends State<OTPVerificationScreen> {
  late TextEditingController _otpController;
  int _secondsRemaining = 30;
  Timer? _timer;
  bool _isLoading = false;

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
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final auth = Provider.of<AuthProvider>(context, listen: false);
      if (auth.lastDevOtp != null && auth.lastDevOtp!.isNotEmpty) {
        setState(() {
          _otpController.text = auth.lastDevOtp!;
        });
      }
    });
    _startTimer();
  }

  Future<void> _verifyOTP(BuildContext context, String otp) async {
    FocusScope.of(context).unfocus();
    final cleanOtp = otp.trim();

    // Same contract as the backend's verifyOtpSchema: exactly 6 digits.
    if (AppValidators.otp(cleanOtp) != null) {
      showAppToast(
        msg: "Enter the 6-digit OTP",
        backgroundColor: Colors.redAccent,
        textColor: Colors.white,
      );
      return;
    }

    setState(() {
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
      Navigator.of(context).pushNamedAndRemoveUntil(
        '/home',
        (route) => false,
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

      if (authProvider.lastDevOtp != null && authProvider.lastDevOtp!.isNotEmpty) {
        setState(() {
          _otpController.text = authProvider.lastDevOtp!;
        });
      }

      showAppToast(
        msg: "A new OTP code has been sent",
        backgroundColor: AppColors.primaryGreenColor,
        textColor: Colors.white,
      );

      setState(() {
        _secondsRemaining = 30;
      });
      _startTimer();
    } catch (e) {
      final message = e.toString().replaceAll('Exception: ', '');
      showAppToast(
        msg: message,
        backgroundColor: Colors.redAccent,
        textColor: Colors.white,
      );
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    _otpController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    SystemChrome.setSystemUIOverlayStyle(
      const SystemUiOverlayStyle(
        statusBarColor: Colors.transparent,
        statusBarIconBrightness: Brightness.light,
      ),
    );

    final displayPhone = _phoneNumber.startsWith('+')
        ? _phoneNumber
        : (_phoneNumber.isNotEmpty ? "+94 $_phoneNumber" : "");

    final auth = Provider.of<AuthProvider>(context);
    final devCode = auth.lastDevOtp;

    return Scaffold(
      appBar: AppBar(
        title: const Text('OTP verification'),
        actions: [
          TextButton(
            onPressed: () {
              Navigator.of(context).pushNamedAndRemoveUntil(
                '/home',
                (route) => false,
              );
            },
            child: const Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  'Skip',
                  style: TextStyle(
                    color: AppColors.primaryGreenColor,
                    fontWeight: FontWeight.bold,
                    fontSize: 16,
                  ),
                ),
                Icon(
                  Icons.chevron_right,
                  color: AppColors.primaryGreenColor,
                  size: 20,
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
        ],
      ),
      body: Container(
        padding: const EdgeInsets.symmetric(
          horizontal: 20,
          vertical: 16,
        ),
        child: Center(
          child: SingleChildScrollView(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.center,
              children: [
                const Text("We've sent a verification code to "),
                Text(
                  displayPhone,
                  style: const TextStyle(
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const SizedBox(
                  height: 10,
                ),
                const Text("Enter the code below to verify your account"),
                if (devCode != null && devCode.isNotEmpty) ...[
                  const SizedBox(height: 6),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                    decoration: BoxDecoration(
                      color: AppColors.primaryGreenColor.withValues(alpha: 0.12),
                      borderRadius: BorderRadius.circular(6),
                    ),
                    child: Text(
                      "Dev Code: $devCode (auto-filled)",
                      style: const TextStyle(
                        color: AppColors.primaryGreenColor,
                        fontWeight: FontWeight.bold,
                        fontSize: 12,
                      ),
                    ),
                  ),
                ],
                const SizedBox(
                  height: 10,
                ),
                customTextField(
                  hintText: "Enter 6-digit OTP",
                  isPhoneNumberField: true,
                  maxLength: 6,
                  inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                  validator: AppValidators.otp,
                  textEditingController: _otpController,
                  prefix: "",
                  onFieldSubmitted: (value) {
                    if (value != null && value.isNotEmpty) {
                      _verifyOTP(context, value);
                    }
                    return null;
                  },
                ),
                const SizedBox(
                  height: 15,
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
                        title: "Verify & Continue",
                        color: AppColors.primaryGreenColor,
                        padding: const EdgeInsets.symmetric(
                          horizontal: 60,
                          vertical: 12,
                        ),
                        callback: () {
                          _verifyOTP(context, _otpController.text);
                        },
                      ),
                const SizedBox(
                  height: 8,
                ),
                TextButton(
                  onPressed: () {
                    Navigator.of(context).pushNamedAndRemoveUntil(
                      '/home',
                      (route) => false,
                    );
                  },
                  child: const Text(
                    "Skip & Explore Store",
                    style: TextStyle(
                      color: Colors.grey,
                      fontWeight: FontWeight.w600,
                      fontSize: 14,
                    ),
                  ),
                ),
                const SizedBox(
                  height: 10,
                ),
                (_timer != null && _timer!.isActive && _secondsRemaining > 0)
                    ? Text(
                        'Resend OTP in $_secondsRemaining s',
                        style: const TextStyle(
                          fontWeight: FontWeight.bold,
                        ),
                      )
                    : TextButton(
                        onPressed: _restartTimer,
                        child: const Text(
                          "Resend OTP",
                          style: TextStyle(
                            color: AppColors.primaryGreenColor,
                            fontWeight: FontWeight.bold,
                            fontSize: 14,
                          ),
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
