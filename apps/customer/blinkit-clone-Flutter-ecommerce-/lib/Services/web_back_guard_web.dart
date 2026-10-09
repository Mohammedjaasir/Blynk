import 'dart:js_interop';

@JS('blynkBackGuard')
external _BackGuard? get _guard;

extension type _BackGuard._(JSObject _) implements JSObject {
  external void setExitArmed(bool on);
}

// No guard (a browser without CloseWatcher): nothing to tell.
void setWebBackExitArmed(bool armed) => _guard?.setExitArmed(armed);
