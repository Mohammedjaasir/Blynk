import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

import 'package:ecom/design/tokens.dart';

// ratchet: lower as screens migrate, target 0. These only ever go down.
const int kMaxRawColorLiterals = 3; // Color(0x...)  (AUDITFIX: was 16, measured 15)
const int kMaxRawMaterialColors = 53; // Colors.x (not Colors.transparent)  (AUDITFIX: was 72)
// T1 (2026-09-23) drove every `fontSize:` literal out of lib/ except the type
// layer's own declarations, so this is now 0 and the guard below is an
// equality, not a ceiling: adding one back fails immediately.
const int kMaxFontSizeLiterals = 0; // fontSize: ...  (was 117, measured 114)
// ...and with none left outside typography.dart, none of them can be below
// the 12 px floor either. Only ever lower this.
const int kMaxSubFloorFontSizes = 0;

/// Files that legitimately hold raw values (token layer, legacy shims, theme).
const _exempt = <String>{
  'lib/app_colors.dart',
  'lib/app_design.dart',
  'lib/app_theme.dart',
};

List<File> _dartFiles(String root) {
  return Directory(root)
      .listSync(recursive: true)
      .whereType<File>()
      .where((f) => f.path.endsWith('.dart'))
      .toList();
}

String _norm(String path) => path.replaceAll(r'\', '/');

int _count(Iterable<File> files, RegExp pattern) =>
    files.fold(0, (sum, f) => sum + pattern.allMatches(f.readAsStringSync()).length);

/// Strips `//`/`///` line comments before a guard matches source text, so a
/// doc comment that *explains* a banned pattern (e.g. "never a `→`
/// character") does not itself trip the guard.
///
/// Review M-4: the original was `line.indexOf('//')`, which also truncated at
/// a `//` **inside a string literal** — a URL, most obviously. Everything
/// after such a string on that line became invisible to every guard built on
/// this helper, which is now seven of them. That is the same
/// guard-that-cannot-fail class as T1's `0x08` byte, just latent: `lib/` has
/// no such line today, so nothing was actually hidden, but the next one added
/// would have been. It now tracks quote state and only cuts at a `//` that is
/// really outside a string.
///
/// Scope, stated so the next person does not over-trust it: this is line-based
/// and therefore does not model triple-quoted strings that span lines. `lib/`
/// contains none (asserted below), and a `/* */` block comment is not stripped
/// here — it never was.
String _stripLineComments(String source) =>
    source.split('\n').map(_stripLineComment).join('\n');

const int _quote = 0x27; // '
const int _dquote = 0x22; // "
const int _slash = 0x2F; // /
const int _backslash = 0x5C;
const int _lowerR = 0x72; // r, as in a raw string

bool _isWordChar(int c) =>
    (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x5A) || (c >= 0x61 && c <= 0x7A) || c == 0x5F;

String _stripLineComment(String line) {
  var open = 0; // the quote character we are inside, or 0
  var raw = false; // inside an r'...' string, where a backslash is literal
  for (var i = 0; i < line.length; i++) {
    final c = line.codeUnitAt(i);
    if (open == 0) {
      if (c == _quote || c == _dquote) {
        open = c;
        // `r` immediately before the quote opens a raw string - but only when
        // that `r` is not itself the tail of an identifier (`, dir'` etc).
        raw = i > 0 &&
            line.codeUnitAt(i - 1) == _lowerR &&
            (i < 2 || !_isWordChar(line.codeUnitAt(i - 2)));
      } else if (c == _slash && i + 1 < line.length && line.codeUnitAt(i + 1) == _slash) {
        return line.substring(0, i);
      }
    } else {
      if (!raw && c == _backslash) {
        i++; // the escaped character cannot close the string
        continue;
      }
      if (c == open) open = 0;
    }
  }
  return line;
}

Iterable<String> _codeOffenders(Iterable<File> files, RegExp pattern) => files
    .where((f) => pattern.hasMatch(_stripLineComments(f.readAsStringSync())))
    .map((f) => _norm(f.path));

void main() {
  final all = _dartFiles('lib');
  final screens = all.where((f) {
    final p = _norm(f.path);
    return !p.startsWith('lib/design/') && !_exempt.contains(p);
  }).toList();

  final rawColor = RegExp(r'Color\(0x');
  final materialColors = RegExp(r'(?<![A-Za-z_])Colors\.(?!transparent\b)[A-Za-z]');
  final fontSize = RegExp(r'fontSize\s*:');

  // Review M-4. Seven guards in this file are only as good as this helper, so
  // it gets its own tests rather than being trusted. The first three cases are
  // the bug that was found; the rest pin the behaviour it must keep.
  group('_stripLineComments (the helper seven guards stand on)', () {
    test('cuts a real comment, at any depth of slash', () {
      expect(_stripLineComment('final a = 1; // note'), 'final a = 1; ');
      expect(_stripLineComment('/// doc'), '');
      expect(_stripLineComment('no comment here'), 'no comment here');
    });

    test('does NOT cut at a // inside a string literal (the M-4 bug)', () {
      expect(_stripLineComment("const u = 'https://blynk.lk'; final x = 1;"),
          "const u = 'https://blynk.lk'; final x = 1;");
      expect(_stripLineComment('const u = "https://blynk.lk"; final x = 1;'),
          'const u = "https://blynk.lk"; final x = 1;');
      // ...and still cuts the real comment that follows one.
      expect(_stripLineComment("const u = 'https://blynk.lk'; // note"),
          "const u = 'https://blynk.lk'; ");
    });

    test('handles escapes, raw strings, mixed quotes and an unterminated line', () {
      // An escaped quote does not close the string, so the // after it is
      // still a real comment.
      expect(_stripLineComment(r"const s = 'it\'s'; // note"), r"const s = 'it\'s'; ");
      expect(_stripLineComment(r"final r = RegExp(r'a//b'); final x = 1;"),
          r"final r = RegExp(r'a//b'); final x = 1;");
      expect(_stripLineComment("const s = \"it's\"; // note"), "const s = \"it's\"; ");
      // A string opened on this line and closed on the next: nothing is cut,
      // which is the safe direction (a guard sees more, never less).
      expect(_stripLineComment("const s = 'opened // not a comment"),
          "const s = 'opened // not a comment");
    });

    test('lib/ has no triple-quoted string, which is what makes the line-based scan safe', () {
      final offenders = all
          .where((f) => RegExp("'''|\\\"\\\"\\\"").hasMatch(f.readAsStringSync()))
          .map((f) => _norm(f.path));
      expect(offenders, isEmpty,
          reason: 'a multi-line string would break every line-based guard in this file');
    });
  });

  group('design hygiene ratchet (outside lib/design and the legacy shims)', () {
    test('Color(0x...) literals do not grow', () {
      expect(_count(screens, rawColor), lessThanOrEqualTo(kMaxRawColorLiterals));
    });

    test('raw Colors.x usages do not grow', () {
      expect(_count(screens, materialColors), lessThanOrEqualTo(kMaxRawMaterialColors));
    });

    // T1: the scope is no longer "lib minus lib/design" - it is *every* file
    // in lib/ except lib/design/typography.dart, the one file allowed to
    // declare a size at all. That closes the hole where a token layer file
    // could declare a size the floor guard never saw. Comments are stripped
    // so a doc comment that names the banned pattern does not trip it.
    test('no fontSize: literal anywhere in lib/ outside design/typography.dart', () {
      final scope = all.where((f) => !_norm(f.path).endsWith('lib/design/typography.dart'));
      final count = scope.fold<int>(
        0,
        (sum, f) => sum + fontSize.allMatches(_stripLineComments(f.readAsStringSync())).length,
      );
      expect(
        count,
        equals(kMaxFontSizeLiterals),
        reason: 'offenders: ${_codeOffenders(scope, fontSize).join(", ")}',
      );
    });
  });

  group('audit fixes stay fixed (source guards over lib/UI and lib/Screens)', () {
    final ui = all.where((f) {
      final p = _norm(f.path);
      return p.startsWith('lib/UI/') || p.startsWith('lib/Screens/');
    }).toList();
    final everything = screens; // lib minus lib/design and the three legacy shims
    // Every gradient/shadow fill must come from lib/design/tokens.dart
    // (BlynkGradients/BlynkElevation). home_screen_carousel.dart predates
    // this redesign and already contains 3 hardcoded LinearGradients (a
    // photo scrim, an admin-runtime-colour wash and a decorative edge wash)
    // and 1 hardcoded BoxShadow — only one of the four is genuinely
    // untokenisable (the admin-colour wash); the other three are ordinary
    // literals R2 should migrate when it rewrites this file for the promo
    // banner card (spec §4 "Promo carousel"). R1 does not restyle Home, so
    // this file is not fixed here — but it is NOT blanket-exempted either
    // (review R1 finding I-1: a whole-file exclusion would let R2 add any
    // number of new ad-hoc gradients/shadows here without either guard ever
    // firing again). Instead the two guards below ratchet this one file to
    // its exact current count via `equals`, so a genuinely new violation —
    // in this file or any other — still fails immediately, while R2 drives
    // the count down to 0.
    // ...and W2 has now driven that count to 0, so the ratchet and its
    // constants are gone: `home_screen_carousel.dart` is scanned by the plain
    // ban like every other file. No file outside lib/design/ is exempt.
    final outsideDesign = all.where((f) => !_norm(f.path).startsWith('lib/design/')).toList();

    String read(File f) => f.readAsStringSync();
    Iterable<String> offenders(Iterable<File> files, RegExp pattern) =>
        files.where((f) => pattern.hasMatch(read(f))).map((f) => _norm(f.path));

    test('no ALL-CAPS labels: no .toUpperCase() and no ALL-CAPS string literals in a Text or section label', () {
      expect(offenders(ui, RegExp(r'\.toUpperCase\(\)')), isEmpty);
      // Two or more upper-case words in one literal, e.g. 'DELIVERY ADDRESS'.
      expect(offenders(ui, RegExp(r"""['"][A-Z]{2,}(?: [A-Z&]+)+['"]""")), isEmpty);
    });

    // 2026-09 redesign (spec §3 "Primary CTA"/§7.3): a trailing
    // Icons.arrow_forward icon on a CTA is now allowed (Checkout, Shop Now);
    // only the literal "→" character in a label stays banned. Comments are
    // stripped first so a doc comment that explains the rule (and so quotes
    // "→" itself) doesn't trip it.
    test('no "→" character in a label; a trailing Icons.arrow_forward icon is allowed', () {
      expect(_codeOffenders(ui, RegExp(r'→')), isEmpty);
    });

    // review R1 I-2: this guard counts `fontSize:` literals over `everything`
    // = lib minus lib/design, so a sub-floor size declared *inside* a token
    // in lib/design/typography.dart (and only consumed elsewhere via that
    // token) was invisible to it — BlynkText.microLabel shipped at 11 px
    // with the guard still reading 0 new violations. typography.dart is the
    // one lib/design file allowed to declare fontSize: literals at all (see
    // "has no fontSize: literal outside typography.dart" below), so it is
    // scanned here too, closing that blind spot for good.
    test('no fontSize literal below the 12 px floor anywhere in lib/, token declarations in typography.dart included', () {
      final low = RegExp(r'fontSize\s*:\s*(\d+(?:\.\d+)?)');
      var count = 0;
      final offenders = <String>[];
      for (final f in all) {
        for (final m in low.allMatches(_stripLineComments(read(f)))) {
          if (double.parse(m.group(1)!) < 12) {
            count++;
            offenders.add('${_norm(f.path)}: ${m.group(1)}');
          }
        }
      }
      expect(count, lessThanOrEqualTo(kMaxSubFloorFontSizes), reason: offenders.join(', '));
    });

    // T1: the type layer also exposes size *functions* so a responsive widget
    // (or the map-marker painter) can pick a size without declaring a literal.
    // Those are the only way past the guard above, so they must enforce the
    // floor themselves. `glyph` was added to this list by review M-4 — it was
    // the one remaining un-asserted size path out of the type layer.
    test('every type-layer size function asserts the 12 px floor', () {
      final typography = File('lib/design/typography.dart').readAsStringSync();
      const signatures = {
        'heroTitle': 'TextStyle heroTitle(double size)',
        'heroSubtitle': 'TextStyle heroSubtitle(double size)',
        'glyph': 'TextStyle glyph(IconData icon, double size, Color color)',
      };
      for (final entry in signatures.entries) {
        final at = typography.indexOf(entry.value);
        expect(at, greaterThan(-1), reason: '${entry.key} is gone or changed signature');
        final body = typography.substring(at, at + 400);
        expect(body, contains('assert(size >= minSize'),
            reason: '${entry.key} must assert the floor');
      }
      expect(() => BlynkText.heroTitle(11), throwsA(isA<AssertionError>()));
      expect(() => BlynkText.heroSubtitle(11), throwsA(isA<AssertionError>()));
      expect(() => BlynkText.glyph(BlynkIcons.cart, 11, BlynkColors.ink),
          throwsA(isA<AssertionError>()));
      expect(BlynkText.heroTitle(32).fontSize, 32);
      expect(BlynkText.glyph(BlynkIcons.cart, 40, BlynkColors.ink).fontSize, 40);
    });

    // 2026-09 redesign (spec §7.1): gradients only via tokens.
    // RadialGradient stays banned everywhere, and every gradient fill must
    // now come from BlynkGradients (lib/design/tokens.dart) — no file
    // outside lib/design/ may construct its own LinearGradient.
    // W2 drove home_screen_carousel.dart from 3 LinearGradient( to 0, so the
    // ratchet that tolerated them is gone and the file is now scanned by the
    // plain ban like every other file — which is what this guard's original
    // comment anticipated. There is no longer any exempt or ratcheted file.
    test('gradients only via tokens: RadialGradient is banned everywhere; no ad-hoc LinearGradient outside lib/design (no file is exempt)', () {
      expect(offenders(all, RegExp(r'RadialGradient')), isEmpty);
      expect(offenders(outsideDesign, RegExp(r'LinearGradient\(')), isEmpty);
      // Non-vacuity: the scope must actually contain files, or this passes free.
      expect(outsideDesign, isNotEmpty);
    });

    // 2026-09 redesign (spec §7.4): card elevation exists again, but only
    // via the BlynkElevation.soft token. AppElevation stays banned, and no
    // file outside lib/design/ may construct its own BoxShadow(.
    test('card elevation is the soft token only: AppElevation is gone, appCardDecoration uses BlynkElevation.soft, no ad-hoc BoxShadow outside lib/design (no file is exempt)', () {
      expect(offenders(all, RegExp(r'AppElevation')), isEmpty);
      final design = File('lib/app_design.dart').readAsStringSync();
      expect(design, isNot(contains('AppElevation')));
      expect(design, contains('BlynkElevation.soft'));
      expect(offenders(outsideDesign, RegExp(r'BoxShadow\(')), isEmpty);
      // Non-vacuity: the scope must actually contain files, or this passes free.
      expect(outsideDesign, isNotEmpty);
    });

    test('yellow is never a translucent wash', () {
      expect(
        offenders(everything, RegExp(r'(primaryYellowColor|BlynkColors\.signal)[^;]{0,80}withValues\(\s*alpha')),
        isEmpty,
      );
    });

    test('no orange checkout icons (address cards still carry deepOrange/red: deferred to the address-book redesign)', () {
      expect(offenders(everything, RegExp(r'Colors\.orangeAccent')), isEmpty);
    });

    test('control outlines use lineStrong, not the 1.2:1 hairline', () {
      // `home_screen_search_bar.dart` was removed on 2026-09-24 (Home's search
      // field became a circular button in the brand header, per the reference
      // composition), so it is no longer in this list — reading a deleted file
      // here would throw rather than assert.
      for (final path in [
        'lib/Screens/search_screen.dart',
        'lib/Screens/order_confirmation_screen.dart',
      ]) {
        expect(File(path).readAsStringSync(), isNot(contains('AppSurfaces.border')), reason: path);
      }
      final cancel = File('lib/UI/Widgets/Organisms/order_cancel_section.dart').readAsStringSync();
      expect(cancel, isNot(contains('side: const BorderSide(color: AppSurfaces.border)')));
    });

    test('no "Sorry" and no exclamation mark in a customer-facing title or message', () {
      expect(offenders(ui, RegExp(r"title:\s*'[^']*(Sorry|!)")), isEmpty);
      expect(offenders(ui, RegExp(r"message:\s*'[^']*!")), isEmpty);
    });

    // T1 (plan §5/§8): the primary CTA is a flat BlynkCta.fill (Blynk Yellow)
    // via BlynkButton.cta, never an ad-hoc fill and never green.
    // primaryGreenColor and BlynkColors.positive stay banned as a button
    // backgroundColor, and the previous pass's second green is now banned
    // outright anywhere in lib/ - the token does not exist any more, so a
    // reference to it must fail rather than silently resolve to something.
    test('the primary CTA is flat yellow: no ad-hoc green backgroundColor on a button, and no second green anywhere', () {
      expect(
        offenders(
          ui,
          RegExp(r'backgroundColor:\s*(AppColors\.primaryGreenColor|BlynkColors\.positive)'),
        ),
        isEmpty,
      );
      expect(_codeOffenders(all, RegExp(r'accentGreen')), isEmpty);
      for (final path in [
        'lib/Screens/Auth/otp_verification_screen.dart',
        'lib/UI/Widgets/Organisms/login_screen_otp_sheet.dart',
        'lib/Screens/Auth/login_screen.dart',
        'lib/UI/Widgets/Organisms/cart_screen_payment_container.dart',
        'lib/UI/Widgets/Organisms/cart_screen_address_container.dart',
        'lib/UI/Widgets/Organisms/home_screen_app_bar.dart',
        'lib/UI/Widgets/Organisms/home_screen_carousel.dart',
      ]) {
        final source = File(path).readAsStringSync();
        expect(source, isNot(contains('primaryGreenColor')), reason: path);
        expect(source, isNot(contains('BlynkColors.positive')), reason: path);
        expect(source, isNot(contains('Colors.grey')), reason: path);
      }
    });

    // T1 fix round 1, review I-1. Currency is LKR, never a dollar sign (plan
    // Global Constraints); `formatLkr` is the only thing that formats money.
    //
    // The rule is about *literal* dollar signs, not about what follows one. In
    // Dart an unescaped `$` inside a non-raw string is always interpolation
    // (`$name` / `${expr}`) — `'$4.50'` is not even valid source — so the only
    // three ways a real dollar sign can reach the UI are:
    //
    //   1. an escaped dollar — 'Total \$4.50', '\$${cart.total}', '\$$price'
    //   2. a bare one inside a raw string — r'$4.50'
    //   3. a unicode escape  — '$', '\u{24}'
    //
    // Matching the escape rather than the follow-set is what makes the two
    // interpolated forms in review I-1 fail: both contain an escaped dollar,
    // whatever comes after it. It is also why there are no false positives —
    // `'$itemQty items'` and `'${order.total}'` are untouched — and why the
    // quote style does not matter, so double-quoted copy is covered for free
    // (this package has no `prefer_single_quotes` lint).
    //
    // Case 2 is the one place a follow-set is still needed, because inside a
    // raw string a bare dollar is genuinely ambiguous: `r'$4.50'` is currency
    // but `RegExp(r'ab$')` is an end-anchor. It therefore only fires when the
    // dollar is currency-shaped — followed by a digit or a space. (My own
    // false-positive probe caught the anchor case; the first draft of this
    // guard would have blocked any future `RegExp(r'…$')` in a screen file.)
    //
    // Deliberately scanned WITHOUT stripping comments: `_stripLineComments`
    // truncates a line at its first `//`, which would hide a dollar sign that
    // sits after a URL literal (review I-1, third gap). There are zero `\$`
    // sequences in lib/UI + lib/Screens today, comments included, so the cost
    // of the stricter scope is that a future comment must write "dollar sign"
    // in words rather than quoting the character.
    test('no literal dollar sign in customer-facing copy (currency is LKR)', () {
      final dollar = RegExp(r'\\\$|\\u\{?0*24\}?');
      final rawStringDollar = RegExp(r'''r(['"])[^'"\n]*\$(?:\d|\x20)[^'"\n]*\1''');
      expect(offenders(ui, dollar), isEmpty,
          reason: 'an escaped dollar sign is a literal dollar sign; use formatLkr');
      expect(offenders(ui, rawStringDollar), isEmpty,
          reason: 'a bare dollar sign in a raw string is a literal dollar sign');
    });

    // ---- T2 guards -------------------------------------------------------
    // Each of the four below was mutation-tested: the violation was written
    // into a real source file, the guard was confirmed to exit non-zero, and
    // the file was restored byte-for-byte. See task-T2-report.md §"Guards".

    // T2 (brief item 1): "no duplicated navigation implementation". The
    // customer app has exactly one place that decides what navigation looks
    // like — AdaptiveScaffold — so a screen cannot grow a second bottom bar
    // or rail whose selected state drifts from the shell's.
    test('navigation is implemented once, in adaptive_scaffold.dart', () {
      const owner = 'lib/UI/Widgets/Organisms/adaptive_scaffold.dart';
      final navControls = RegExp(r'(?<![A-Za-z_])(BottomNavigationBar|NavigationBar|NavigationRail|CupertinoTabBar)\(');
      final users = _codeOffenders(all, navControls).toList();
      expect(users, equals([owner]),
          reason: 'navigation belongs to AdaptiveScaffold; found: ${users.join(", ")}');
      // ...and it is really there, so the guard cannot pass vacuously.
      expect(navControls.hasMatch(File(owner).readAsStringSync()), isTrue);
    });

    // T2 (brief item 12): reuse the existing logout confirmation, do not
    // write a second one. `logout_dialog_test.dart` already pins the removed
    // Cupertino variant; this pins the live one.
    test('there is exactly one logout confirmation', () {
      const owner = 'lib/UI/Widgets/Organisms/logout_dialog.dart';
      final declaration = RegExp(r'(?<![A-Za-z_])Future<void>\s+showLogoutDialog\s*\(');
      final declarers = _codeOffenders(all, declaration).toList();
      expect(declarers, equals([owner]));
      // No other file may put up its own "Log out?" confirmation.
      final confirmation = RegExp(r"""['"]Log out\?['"]""");
      expect(_codeOffenders(all, confirmation).toList(), equals([owner]));
      // The one that exists still clears every piece of customer-scoped
      // state through the shared cleaner rather than re-listing providers.
      expect(
        _stripLineComments(File(owner).readAsStringSync()),
        contains('AppSessionCleaner.clearProviders'),
      );
    });

    // T2 (brief item 9): an error a customer reads is the mapped
    // CustomerError copy, never the exception. A guard rather than a review
    // habit, because the failure mode (a Dio message or a stack trace in a
    // snackbar) only shows up on a bad day in production.
    // Review F-1: the first draft required a CLOSING brace, so the single most
    // likely real violation — `message: 'Could not place your order: $e'`,
    // which ships a raw Dio string to a customer — never matched and the guard
    // would have stayed green through it. The brace is now genuinely optional:
    // the bare and braced forms are separate patterns.
    //
    // That widening needs a carve-out, which is the other half of F-1.
    // `lib/UI` already contains four bare `$e` interpolations and every one is
    // inside `debugPrint` (google_map_view.dart, maplibre_map_view.dart) —
    // developer output, not customer copy. Without the carve-out this gate
    // would go red on correct code, which is the failure mode T1 hit when it
    // rejected the proposed `$` follow-set. The carve-out is per LINE, not per
    // file, so a screen that legitimately debugPrints an exception is still
    // guarded on every other line; it is safe because all four sites put the
    // interpolation on the same line as the `debugPrint(` (verified, and the
    // non-vacuity companion below re-verifies it on every run).
    test('no raw exception text reaches customer-facing copy', () {
      // `.toString()` on an error-shaped identifier.
      final errorToString =
          RegExp(r'(?<![A-Za-z_$])(e|err|error|ex|exception|_error|failure)\s*\.\s*toString\(\)');
      // Bare interpolation: `'... $e'`, `'$error'`. The negative lookahead is
      // what stops it matching `$eventCount` or `$errorsFixed`.
      final bareInterpolated = RegExp(r'\$(e|err|error|ex|exception)(?![A-Za-z0-9_])');
      // Braced interpolation, to any depth: `${e}`, `${e.message}`,
      // `${e.response.data}`, `${error.toString()}`.
      final bracedInterpolated =
          RegExp(r'\$\{\s*(e|err|error|ex|exception)(?![A-Za-z0-9_])[^}]*\}');
      final dioLeak = RegExp(r'(?<![A-Za-z_])(DioException|StackTrace|statusCode)\s*\}');

      final devOutput = RegExp(r'(?<![A-Za-z_])(debugPrint|assert)\s*\(');
      Iterable<String> copyOffenders(RegExp pattern) => ui
          .where((f) => _stripLineComments(f.readAsStringSync())
              .split('\n')
              .any((line) => !devOutput.hasMatch(line) && pattern.hasMatch(line)))
          .map((f) => _norm(f.path));

      for (final pattern in [errorToString, bareInterpolated, bracedInterpolated, dioLeak]) {
        expect(copyOffenders(pattern), isEmpty,
            reason: 'show AppErrors.from(...).message, never the exception');
      }
      expect(ui, isNotEmpty);

      // Non-vacuity, and specifically proof that the BARE form really matches
      // real source rather than only the mutations I wrote for it. `lib/UI`
      // contains bare exception interpolations today and every one of them is
      // developer output; this asserts both halves.
      //
      // Deliberately NOT an allow-list of file paths. My first draft was one,
      // and mutation testing showed it turned a *legitimate* new
      // `debugPrint('...: $e')` into a gate failure — the exact "red on
      // correct code" trap T1 hit with the dollar-sign follow-set. It also
      // scanned raw source, so a `$e` inside a comment counted. Both fixed:
      // comment-stripped, and a count-plus-shape check instead of a list.
      final bareLines = <String>[];
      for (final f in ui) {
        for (final line in _stripLineComments(f.readAsStringSync()).split('\n')) {
          if (bareInterpolated.hasMatch(line)) bareLines.add(line.trim());
        }
      }
      expect(bareLines, isNotEmpty,
          reason: 'the bare-interpolation pattern no longer matches any real source, '
              'so it can no longer prove anything - check it was not narrowed');
      for (final line in bareLines) {
        expect(devOutput.hasMatch(line), isTrue,
            reason: 'the carve-out covers developer output only, and this line is not: $line');
      }
    });

    // T2 (brief item 4 / plan §3): a struck original price is real data or it
    // is nothing - a "was" price computed or assumed on the client is
    // fabricated commerce data. Since product offers (owner, 2026-10-09) the
    // backend sends a real `offer_price`, and the honest callers are exactly
    // the two that strike a product's regular price beside it while
    // `isOnOffer`: the product card and the product detail screen. A new
    // caller anywhere else fails here.
    test('a struck price is rendered only for a real product offer, in the two known places', () {
      const owner = 'lib/UI/Widgets/Atoms/money_text.dart';
      const offerCallers = {
        'lib/UI/Widgets/Atoms/card_product.dart',
        'lib/Screens/product_details_screen.dart',
      };
      // Scanned outside money_text.dart itself, whose own constructor
      // declaration is not a call site.
      final constructed = RegExp(r'(?<![A-Za-z_])StruckPrice\s*\(');
      final callers = all.where((f) => _norm(f.path) != owner);
      expect(callers, isNotEmpty);
      expect(_codeOffenders(callers, constructed).toSet(), offerCallers,
          reason: "StruckPrice only strikes a product's regular price beside its real offer price");
      for (final path in offerCallers) {
        expect(_stripLineComments(File(path).readAsStringSync()), contains('isOnOffer'),
            reason: '$path must gate the struck price on the backend offer');
      }
      // The widget itself is still declared (so the guard is not vacuous) and
      // still routes through the token rather than restyling a strike here.
      // Comments are stripped: StruckPrice's own doc comment names the token,
      // and a `contains` over the raw source would be satisfied by that alone
      // even after the code stopped using it (caught by mutation testing).
      final source = _stripLineComments(File(owner).readAsStringSync());
      expect(source, contains('class StruckPrice'));
      expect(source, contains('BlynkType.priceStruck'));
      // And nothing else in lib/ strikes a price through by hand.
      //
      // Review F-2: `card_product_order_summary.dart` used to be exempted as a
      // whole file. The reason was sound — it strikes the product *name* of a
      // line the backend really reports as `itemStatus == 'UNAVAILABLE'`, not a
      // price — but a blanket exemption means T9 could add a struck "original"
      // price in that same file and this guard, written precisely to stop
      // struck prices, would say nothing. It is now a counted ratchet at its
      // exact current count, matching the `carouselLinearGradientCount` /
      // `carouselBoxShadowCount` precedent at the top of this group. A SECOND
      // strike in that file fails, and so does removing the first (which is
      // the signal that the exemption itself should go).
      const strikeRatchetFile = 'lib/UI/Widgets/Atoms/card_product_order_summary.dart';
      const orderSummaryStrikeCount = 1;
      final lineThrough = RegExp(r'TextDecoration\.lineThrough');
      final adHocStrike = all.where((f) {
        final p = _norm(f.path);
        return p != owner && p != strikeRatchetFile && !p.startsWith('lib/design/');
      }).where((f) => lineThrough.hasMatch(_stripLineComments(read(f))));
      expect(adHocStrike.map((f) => _norm(f.path)), isEmpty,
          reason: 'a price is struck through only via StruckPrice, and only with real data');
      expect(
        lineThrough.allMatches(_stripLineComments(File(strikeRatchetFile).readAsStringSync())).length,
        equals(orderSummaryStrikeCount),
        reason: 'a NEW line-through in this file must fail too, not be silently tolerated; '
            'the one that is allowed strikes an UNAVAILABLE product NAME, never a price',
      );
    });

    // Review M-2. The widget tests for these pin rendered *values*, so a
    // widget that de-tokenised to the same literal would keep them green — the
    // rendering is protected, the consumption is not. These are the missing
    // half: the component must name the token. Cheap here precisely because
    // each is a single component-specific token with a single owner, which is
    // why this is not the "assert the widget contains no EdgeInsets literal"
    // noise T1 rightly declined.
    test('component tokens are consumed by name, not re-inlined at the same value', () {
      const consumers = <String, List<String>>{
        'lib/UI/Widgets/Organisms/adaptive_scaffold.dart': [
          'BlynkNav.badgeDot',
          'BlynkNav.badgeDotBorder',
          'BlynkNav.selectedTile',
        ],
        'lib/UI/Widgets/Atoms/status_badge.dart': ['BlynkIcons.xs'],
        'lib/UI/Widgets/Atoms/quantity_stepper.dart': [
          'BlynkStepper.visualHeight',
          'BlynkStepper.minTapSize',
          'BlynkStepper.borderStrong',
        ],
        'lib/UI/Widgets/Atoms/blynk_button.dart': [
          'BlynkDisabled.fill',
          'BlynkDisabled.label',
          'BlynkControl.spinner',
          'BlynkControl.minWidth',
          'BlynkControl.outlineWidth',
        ],
        'lib/UI/Widgets/Atoms/money_text.dart': ['BlynkType.price', 'BlynkType.priceStruck'],
        // --- W8: the entries W1, W3 and W6 asked for, plus W8's own tokens.
        //
        // `BlynkWell.fallbackDisc` is exactly the substring trap T2 documented
        // above: `fallbackDiscFraction`, `fallbackDiscMin` and
        // `fallbackDiscMax` all start with it, so a plain `contains` would be
        // satisfied by any of the three and de-tokenising the medallion colour
        // itself would stay green. The `(?![A-Za-z0-9_])` suffix is what makes
        // this row mean anything. Same for `BlynkCardProduct.name`
        // (vs `nameMaxLines`) and `BlynkForm.maxWidth` (vs `narrowMaxWidth`,
        // which does NOT match it since the check is a suffix, not a prefix,
        // guard — the two are separate rows below and each is asserted in the
        // file that actually renders it).
        'lib/UI/Widgets/Atoms/image_well.dart': [
          'BlynkWell.tint',
          'BlynkWell.fallbackDisc',
          'BlynkWell.fallbackGlyph',
        ],
        'lib/UI/Widgets/Atoms/card_product.dart': [
          'BlynkCardProduct.padding',
          'BlynkCardProduct.name',
          'BlynkCardProduct.price',
          'BlynkCardProduct.unavailableWashOpacity',
        ],
        // Motion M4: the rail's rows are CategoryWidget now, which owns the
        // selected look (BlynkCategory.selectedRing = BlynkColors.signal), so
        // the rail no longer names the yellow itself. Its tap-target floor
        // is still its own.
        'lib/UI/Widgets/Organisms/products_screen_sub_category_list.dart': [
          'BlynkControl.minHeight',
        ],
        'lib/Screens/product_details_screen.dart': [
          'BlynkCardProduct.unavailableWashColor',
          'BlynkCardProduct.unavailableWashOpacity',
        ],
        'lib/UI/Widgets/Organisms/dental_widgets.dart': [
          'BlynkCardProduct.surface',
          'BlynkCardProduct.radius',
          'BlynkCardProduct.elevation',
          'BlynkWell.tint',
          'BlynkWell.radius',
          'BlynkWell.fallbackGlyph',
          'BlynkControl.minHeight',
          'BlynkMap.frameHeight',
        ],
        // W8's new tokens, each proved consumed by the file that asked for it.
        // A token nobody names is a token that can drift.
        'lib/UI/Widgets/Organisms/order_tracking_map.dart': ['BlynkMap.frameHeight'],
        'lib/UI/Widgets/Organisms/home_screen_carousel.dart': ['BlynkPromo.scrimOpacity'],
        'lib/Screens/add_edit_address_screen.dart': ['BlynkForm.maxWidth'],
        'lib/Screens/Auth/otp_verification_screen.dart': ['BlynkForm.narrowMaxWidth'],
        'lib/Screens/app_about_screen.dart': ['BlynkForm.proseMaxWidth'],
        'lib/UI/Widgets/Atoms/card_address_screen.dart': [
          'BlynkCardProduct.surface',
          'BlynkCardProduct.radius',
          'BlynkWell.tint',
          'BlynkControl.outlineWidth',
        ],
      };
      consumers.forEach((path, tokens) {
        final source = _stripLineComments(File(path).readAsStringSync());
        for (final token in tokens) {
          // Whole-identifier, not `contains`. Mutation testing caught the
          // substring trap here: a plain `contains('BlynkNav.badgeDot')` is
          // satisfied by `BlynkNav.badgeDotBorder`, so de-tokenising the dot
          // itself stayed green. Same class as the `tile` /
          // `BlynkNav.tileRadius` false match T1 had to fix in G9.
          final whole = RegExp('${RegExp.escape(token)}(?![A-Za-z0-9_])');
          expect(whole.hasMatch(source), isTrue,
              reason: '$path must consume $token by name, not re-inline its value');
        }
      });
    });

    // --- W8, at W1's request -------------------------------------------
    //
    // 40 of the 41 live products have no image, so the no-image state is the
    // app's DEFAULT appearance. W1 built exactly one fallback for it. These
    // two guards are what stop a second one appearing: the first bans the
    // broken-image glyphs outright, the second keeps product photos flowing
    // through the one well rather than a hand-rolled `Image.network` that
    // would bring its own error builder — and its own second fallback — with
    // it.
    test('no broken-image glyph exists anywhere in lib/', () {
      const banned = <String>['broken_image', 'image_not_supported', 'hide_image'];
      final offenders = <String>[];
      for (final f in all) {
        final source = _stripLineComments(f.readAsStringSync());
        for (final glyph in banned) {
          if (RegExp('Icons\\.$glyph(?![A-Za-z0-9_])').hasMatch(source)) {
            offenders.add('${_norm(f.path)}: Icons.$glyph');
          }
        }
      }
      expect(offenders, isEmpty,
          reason: 'the no-image state is the default appearance and it is a deliberate Blynk '
              'composition, never a broken-image glyph (W1 §2)');
    });

    test('the product image fallback is implemented once, in image_well.dart', () {
      // Non-vacuity FIRST: if the owner stopped loading photos at all, the
      // allow-list below would pass for free and this guard would be proving
      // nothing. T2 §8 F is the cautionary tale — a companion that scanned a
      // different text than the guard it defended.
      const owner = 'lib/UI/Widgets/Atoms/image_well.dart';
      expect(_stripLineComments(File(owner).readAsStringSync()), contains('Image.network('),
          reason: '$owner must still be the thing that loads a product photo');

      // Every other `Image.network(` in lib/ is a NON-product surface, each
      // named here with what it loads. A new product surface reaching for
      // `Image.network` directly — instead of ProductImageWell — fails this.
      const nonProduct = <String>{
        'lib/UI/Widgets/Atoms/category_widget.dart', // category tile artwork
        // products_screen_sub_category_list.dart: dropped with motion M4 - its rows
        // are CategoryWidget, which is the category_widget.dart entry above.
        'lib/UI/Widgets/Organisms/dental_widgets.dart', // clinic / doctor photos
        'lib/UI/Widgets/Organisms/home_screen_carousel.dart', // operator promo backgrounds
      };
      final loaders = all
          .where((f) => _stripLineComments(f.readAsStringSync()).contains('Image.network('))
          .map((f) => _norm(f.path))
          .map((p) => p.substring(p.indexOf('lib/')))
          .toSet();
      expect(loaders.difference({owner, ...nonProduct}), isEmpty,
          reason: 'product photos load through image_well.dart, so there is one fallback, not two');
      // And the allow-list is a ratchet: a surface that stops loading images
      // should lose its entry rather than keep a stale exemption.
      expect(nonProduct.difference(loaders), isEmpty,
          reason: 'this exemption no longer describes the code — drop the entry');
    });

    test('there is one order-status system, not two', () {
      // W5 moved the orders list to the shared StatusBadge, which left
      // `order_status_chip.dart` with zero call sites; W8 deleted it. The
      // screen test that used to assert `findsNothing` on one page is
      // replaced by this, which is strictly stronger: the second system
      // cannot be reintroduced anywhere.
      final offenders = all
          .where((f) => RegExp(r'OrderStatusChip|orderChipColors').hasMatch(f.readAsStringSync()))
          .map((f) => _norm(f.path));
      expect(offenders, isEmpty, reason: 'StatusBadge is the one status pill');
      expect(File('lib/UI/Widgets/Atoms/order_status_chip.dart').existsSync(), isFalse);
      // Non-vacuity: the surviving system must still be there to be the one.
      expect(File('lib/UI/Widgets/Atoms/status_badge.dart').existsSync(), isTrue);
    });

    test('no fixed-height text box around a primary button or bar', () {
      expect(
        File('lib/UI/Widgets/Organisms/cart_screen_payment_container.dart').readAsStringSync(),
        isNot(contains('height: 70')),
      );
      expect(File('lib/Screens/user_orders_screen.dart').readAsStringSync(), isNot(contains('minHeight: 44')));
    });
  });

  group('lib/design token layer', () {
    final design = all.where((f) => _norm(f.path).startsWith('lib/design/')).toList();

    test('exists and is non-empty', () {
      expect(design, isNotEmpty);
    });

    test('contains no Colors.x', () {
      final offenders = design.where((f) => RegExp(r'(?<![A-Za-z_])Colors\.').hasMatch(f.readAsStringSync()));
      expect(offenders.map((f) => f.path), isEmpty);
    });

    test('raw Color(0x...) appears only in primitives.dart', () {
      final offenders = design
          .where((f) => !_norm(f.path).endsWith('lib/design/primitives.dart'))
          .where((f) => rawColor.hasMatch(f.readAsStringSync()));
      expect(offenders.map((f) => f.path), isEmpty);
    });

    test('has no fontSize: literal outside typography.dart', () {
      final offenders = design
          .where((f) => !_norm(f.path).endsWith('lib/design/typography.dart'))
          .where((f) => fontSize.hasMatch(f.readAsStringSync()));
      expect(offenders.map((f) => f.path), isEmpty);
    });
  });
}
