/// The web app's Android back button guard (web/index.html, owner
/// 2026-10-09). While the shop shows "Press back again to exit" the guard is
/// lifted so that press leaves the app; elsewhere it turns back presses into
/// in-app backs. Off the web there is nothing to tell.
library;

import 'web_back_guard_stub.dart' if (dart.library.js_interop) 'web_back_guard_web.dart' as impl;

void setWebBackExitArmed(bool armed) => impl.setWebBackExitArmed(armed);
