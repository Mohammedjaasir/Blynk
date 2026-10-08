/// Opens a `tel:` or `https:` link outside the app. On the web (the customer
/// app is a web app, owner 2026-10-08) the browser handles it; elsewhere it
/// returns false and the caller shows the number instead.
library;

import 'open_link_stub.dart' if (dart.library.js_interop) 'open_link_web.dart' as impl;

bool openExternalLink(String url) => impl.openExternalLink(url);
