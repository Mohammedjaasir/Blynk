import 'package:web/web.dart' as web;

// tel: opens the dialler in place; a web link opens in a new tab (WhatsApp
// hands over to its app from there).
bool openExternalLink(String url) {
  if (url.startsWith('tel:')) {
    web.window.location.href = url;
  } else {
    web.window.open(url, '_blank');
  }
  return true;
}
