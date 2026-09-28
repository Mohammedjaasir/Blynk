import 'package:flutter_test/flutter_test.dart';

import 'package:ecom/UI/Widgets/Organisms/map_tile_config.dart';

/// 2026-09-28: the map must work everywhere, not only in the Dharga Town box
/// the bundled style covered. The default is OpenFreeMap's worldwide style.
void main() {
  test('by default the map is the worldwide OpenFreeMap style', () {
    expect(resolveMapStyleSource(configured: ''), kDefaultMapStyleUrl);
    expect(kDefaultMapStyleUrl, startsWith('https://'));
  });

  test('"self-hosted" keeps the old service-area map as an option', () {
    expect(resolveMapStyleSource(configured: 'self-hosted'), kSelfHostedStyle);
    expect(resolveMapStyleSource(configured: ' Self-Hosted '), kSelfHostedStyle);
  });

  test('any other https style URL is used as given', () {
    const url = 'https://maps.example.com/style.json';
    expect(resolveMapStyleSource(configured: url), url);
  });

  test('an http, relative or junk value is refused, never guessed', () {
    for (final bad in ['http://maps.example.com/style.json', 'style.json', 'not a url', 'ftp://x/y']) {
      expect(resolveMapStyleSource(configured: bad), isNull, reason: bad);
    }
  });
}
