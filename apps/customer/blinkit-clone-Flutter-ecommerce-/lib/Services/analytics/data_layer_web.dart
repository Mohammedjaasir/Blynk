import 'dart:js_interop';
import 'dart:js_interop_unsafe';

/// `window.dataLayer.push(payload)` (owner, 2026-10-10). The array exists
/// only when the site was built with a Google Tag Manager container ID
/// (web/index.html, Dockerfile GTM_ID); without one there is no dataLayer and
/// this does nothing - it never creates one, so no tag can ever see the push.
void pushToDataLayer(Map<String, Object?> payload) {
  try {
    final layer = globalContext['dataLayer'];
    if (layer == null || !layer.isA<JSObject>()) return;
    (layer as JSObject).callMethod<JSAny?>('push'.toJS, payload.jsify());
  } catch (_) {
    // Tracking must never break the shop.
  }
}
