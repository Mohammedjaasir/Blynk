import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// The motion vocabulary lives in `lib/design/motion.dart` and nowhere else.
///
/// This holds the rest of `lib/` to **zero** literal `Duration(milliseconds:`
/// outside a short allow-list of timers that are not motion at all. A screen
/// that wants a new speed adds a token with a name and a reason; it does not
/// invent a number. That is the difference between a motion *system* and a
/// pile of animations that happen to be in the same app.
///
/// The allow-list is deliberately explicit, file by file, so adding to it is
/// a visible decision in a diff rather than a regex getting looser.
const Map<String, int> _allowed = {
  // Search debounce: how long to wait for the customer to stop typing. A
  // timer, not motion; it must not follow the reduced-motion setting.
  'lib/Screens/search_screen.dart': 1,
  'lib/Screens/dental_clinics_screen.dart': 1,
  // A retry delay for the native map laying out. Also a timer.
  'lib/UI/Widgets/Organisms/google_map_view.dart': 1,
  // The launch intro's own sequence and reduced-motion hold: one-off timings
  // fitted to the native splash handover, not reusable UI motion.
  'lib/UI/Widgets/Organisms/blynk_launch_screen.dart': 2,
  // Startup cap on decoding the intro logo: a timeout, not motion.
  'lib/main.dart': 1,
  // The token definitions themselves.
  'lib/design/primitives.dart': 9,
};

// A literal *number*. `Duration(milliseconds: total)` built from a variable
// that came from a token is fine; `Duration(milliseconds: 260)` is not.
final RegExp _literal = RegExp(r'Duration\(\s*milliseconds\s*:\s*\d');

void main() {
  test('no literal durations outside the motion tokens', () {
    final offenders = <String>[];
    for (final f in Directory('lib').listSync(recursive: true).whereType<File>()) {
      if (!f.path.endsWith('.dart')) continue;
      final path = f.path.replaceAll('\\', '/');
      final count = _literal.allMatches(f.readAsStringSync()).length;
      if (count == 0) continue;
      final allowed = _allowed[path] ?? 0;
      if (count > allowed) offenders.add('$path: $count literal(s), $allowed allowed');
    }
    expect(offenders, isEmpty,
        reason: 'Add a named token to BlynkMotion instead of a literal:\n${offenders.join('\n')}');
  });

  test('the allow-list is not padded', () {
    // Every allow-list entry must still be needed at exactly that count, so
    // a file that later drops its timer also drops out of the list.
    for (final entry in _allowed.entries) {
      final f = File(entry.key);
      expect(f.existsSync(), isTrue, reason: '${entry.key} no longer exists');
      final count = _literal.allMatches(f.readAsStringSync()).length;
      expect(count, entry.value, reason: '${entry.key}: allow-list says ${entry.value}, file has $count');
    }
  });
}
