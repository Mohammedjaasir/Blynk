import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// Guards the Google Maps key-injection structure (plan section 11.3, G2):
/// the key is supplied at build time and never lives in tracked source.
/// Runs from the package root (where `flutter test` runs).
final _apiKeyShape = RegExp(r'AIza[0-9A-Za-z_\-]{35}');

const _manifestPath = 'android/app/src/main/AndroidManifest.xml';

String _norm(String p) => p.replaceAll('\\', '/');

/// Text-ish files under [dir], skipping build output, caches and the
/// git-ignored secrets file.
List<File> _sourceFilesUnder(String dir) {
  final root = Directory(dir);
  if (!root.existsSync()) return [];
  const skipDirs = {'build', '.gradle', '.dart_tool', '.idea', 'node_modules'};
  const skipExtensions = {
    '.png', '.jpg', '.jpeg', '.webp', '.gif', '.ico', '.pdf', '.ttf', '.otf',
    '.jar', '.keystore', '.jks', '.pmtiles', '.zip',
  };
  return root.listSync(recursive: true).whereType<File>().where((f) {
    final path = _norm(f.path);
    final segments = path.substring(dir.length).split('/');
    if (segments.any(skipDirs.contains)) return false;
    if (path.endsWith('/secrets.properties')) return false;
    // Firebase app config: git-ignored, lives only on the build machine
    // (its API key is a public client identifier, but it stays untracked).
    if (path.endsWith('/google-services.json')) return false;
    return !skipExtensions.any(path.toLowerCase().endsWith);
  }).toList();
}

String _read(File f) {
  try {
    return f.readAsStringSync();
  } on FileSystemException {
    return '';
  } on FormatException {
    return ''; // binary content, cannot contain a text key
  }
}

void main() {
  test('no Google API key shaped string in lib, test, android, web or docs/06-deployment', () {
    final dirs = ['lib', 'test', 'android', 'web', '../../../docs/06-deployment'];
    var scanned = 0;
    final hits = <String>[];
    for (final dir in dirs) {
      for (final f in _sourceFilesUnder(dir)) {
        scanned++;
        if (_apiKeyShape.hasMatch(_read(f))) hits.add(_norm(f.path));
      }
    }
    expect(scanned, greaterThan(50), reason: 'the scan must actually cover the source tree');
    expect(hits, isEmpty, reason: 'key-shaped string found in: $hits');
  });

  test('the key-shape pattern matches a synthetic key (guard is not vacuous)', () {
    // Built at runtime so this file itself never contains a key-shaped literal.
    final synthetic = 'AI${'za'}${'A' * 35}';
    expect(_apiKeyShape.hasMatch(synthetic), isTrue);
    expect(_apiKeyShape.hasMatch('AIza-too-short'), isFalse);
  });

  test('android/secrets.properties is git-ignored', () {
    final lines = File('android/.gitignore')
        .readAsLinesSync()
        .map((l) => l.trim())
        .where((l) => l.isNotEmpty && !l.startsWith('#'))
        .toList();
    expect(
      lines.any((l) => l == 'secrets.properties' || l == '/secrets.properties' || l == '**/secrets.properties'),
      isTrue,
      reason: 'android/.gitignore must list secrets.properties',
    );
  });

  test('android/app/google-services.json is git-ignored', () {
    final lines = File('.gitignore')
        .readAsLinesSync()
        .map((l) => l.trim())
        .where((l) => l.isNotEmpty && !l.startsWith('#'))
        .toList();
    expect(lines, contains('android/app/google-services.json'));
  });

  test('secrets.properties.example has an empty MAPS_API_KEY value', () {
    final file = File('android/secrets.properties.example');
    expect(file.existsSync(), isTrue);
    final entries = file
        .readAsLinesSync()
        .map((l) => l.trim())
        .where((l) => l.isNotEmpty && !l.startsWith('#'))
        .toList();
    expect(entries, ['MAPS_API_KEY=']);
  });

  test('the manifest reads the key from the MAPS_API_KEY placeholder, never a literal', () {
    final manifest = File(_manifestPath).readAsStringSync();
    final metaData = RegExp(
      r'<meta-data\s+android:name="com\.google\.android\.geo\.API_KEY"\s+android:value="([^"]*)"',
    ).allMatches(manifest).toList();
    expect(metaData, hasLength(1), reason: 'exactly one Maps API key meta-data entry');
    expect(metaData.single.group(1), r'${MAPS_API_KEY}');
    expect(_apiKeyShape.hasMatch(manifest), isFalse);
  });

  test('no Maps Map ID is configured natively (D12: standard appearance, legacy markers)', () {
    final manifest = File(_manifestPath).readAsStringSync();
    expect(manifest.contains('com.google.android.geo.map_id'), isFalse);
  });

  test('the build script resolves the key from env, secrets.properties, local.properties and never prints it', () {
    final gradle = File('android/app/build.gradle').readAsStringSync();
    expect(gradle, contains('MAPS_API_KEY'));
    expect(gradle, contains('secrets.properties'));
    expect(gradle, contains('local.properties'));
    expect(gradle, contains('manifestPlaceholders'));
    expect(gradle, isNot(contains('println')));
    expect(RegExp(r'logger\.\w+\([^)]*mapsApiKey').hasMatch(gradle), isFalse,
        reason: 'the resolved key must not be logged');
  });
}
