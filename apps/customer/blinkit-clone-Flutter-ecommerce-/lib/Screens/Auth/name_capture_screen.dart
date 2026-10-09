import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'package:ecom/Screens/Auth/birthday_prompt_screen.dart';
import 'package:ecom/Services/Providers/auth.provider.dart';
import 'package:ecom/Services/app_errors.dart';
import 'package:ecom/UI/Widgets/Atoms/blynk_button.dart';
import 'package:ecom/UI/Widgets/Atoms/blynk_text_field.dart';
import 'package:ecom/design/tokens.dart';

/// "What's your name?" - shown once, right after the SMS code, to a customer
/// whose account has no name yet (owner, 2026-10-08). The rider sees it on
/// the order and staff in Admin; it is saved to the account (PATCH /me).
class NameCaptureScreen extends StatefulWidget {
  const NameCaptureScreen({super.key});

  static const String route = '/auth/name';
  static const Key fieldKey = Key('name-capture-field');

  @override
  State<NameCaptureScreen> createState() => _NameCaptureScreenState();
}

class _NameCaptureScreenState extends State<NameCaptureScreen> {
  final _controller = TextEditingController();
  String? _error;
  bool _saving = false;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final name = _controller.text.trim();
    if (name.length < AuthProvider.nameMinLength) {
      setState(() => _error = 'Enter your name (at least ${AuthProvider.nameMinLength} letters).');
      return;
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await context.read<AuthProvider>().saveName(name);
      if (!mounted) return;
      // First sign-up only: one skippable birthday prompt, then the shop
      // (owner, 2026-10-09). Nothing else ever leads to it.
      Navigator.of(context).pushNamedAndRemoveUntil(BirthdayPromptScreen.route, (route) => false);
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _saving = false;
        _error = AppErrors.from(e).message;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: BlynkColors.paper,
      appBar: AppBar(automaticallyImplyLeading: false, title: const Text('Welcome to Blynk')),
      body: Align(
        alignment: Alignment.topCenter,
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 480),
          child: SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(BlynkSpace.s16, BlynkSpace.s24, BlynkSpace.s16, BlynkSpace.s32),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const Text("What's your name?", style: BlynkText.title),
                const SizedBox(height: BlynkSpace.s8),
                Text(
                  'So your rider knows who to hand your order to.',
                  style: BlynkText.body.copyWith(color: BlynkColors.ink2),
                ),
                const SizedBox(height: BlynkSpace.s24),
                BlynkTextField(
                  key: NameCaptureScreen.fieldKey,
                  label: 'Your name',
                  hintText: 'e.g. Nimal Perera',
                  controller: _controller,
                  autofocus: true,
                  maxLength: 60,
                  keyboardType: TextInputType.name,
                  textCapitalization: TextCapitalization.words,
                  textInputAction: TextInputAction.done,
                  autofillHints: const [AutofillHints.name],
                  errorText: _error,
                  onSubmitted: (_) => _save(),
                ),
                const SizedBox(height: BlynkSpace.s24),
                BlynkButton.primary(
                  label: 'Continue',
                  expand: true,
                  loading: _saving,
                  onPressed: _save,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
