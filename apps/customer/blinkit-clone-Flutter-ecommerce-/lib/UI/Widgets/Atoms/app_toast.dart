import 'package:flutter/foundation.dart' show kIsWeb, TargetPlatform, defaultTargetPlatform;
import 'package:flutter/material.dart';
import 'package:fluttertoast/fluttertoast.dart';

import '../../../main.dart' show rootScaffoldMessengerKey;

// fluttertoast (see its pubspec) only ships android/ and ios/ platform
// implementations - calling it on Windows/macOS/Linux/Web throws
// MissingPluginException and the user sees nothing at all, not even a
// generic error. This routes those platforms through a real SnackBar
// instead so an error/success message is never silently lost.
bool get _supportsNativeToast =>
    !kIsWeb &&
    (defaultTargetPlatform == TargetPlatform.android ||
        defaultTargetPlatform == TargetPlatform.iOS);

void showAppToast({
  required String msg,
  Color? backgroundColor,
  Color? textColor,
}) {
  if (_supportsNativeToast) {
    Fluttertoast.showToast(
      msg: msg,
      backgroundColor: backgroundColor,
      textColor: textColor,
    );
    return;
  }

  rootScaffoldMessengerKey.currentState?.showSnackBar(
    SnackBar(
      content: Text(msg, style: TextStyle(color: textColor ?? Colors.white)),
      backgroundColor: backgroundColor ?? Colors.black87,
    ),
  );
}
