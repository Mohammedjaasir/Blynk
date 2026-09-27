import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:ecom/design/contrast.dart';
import 'package:ecom/design/tokens.dart';

/// Source with `//` line comments removed, so a doc comment that *names* a
/// removed token (to explain why it went) cannot satisfy a ban check.
String _code(String source) => source
    .split('\n')
    .map((line) {
      final i = line.indexOf('//');
      return i == -1 ? line : line.substring(0, i);
    })
    .join('\n');

void main() {
  group('contrast (plan 2.2 / 13)', () {
    void atLeast(String name, Color fg, Color bg, double min) {
      test('$name >= $min:1', () {
        expect(contrastRatio(fg, bg), greaterThanOrEqualTo(min));
      });
    }

    test('contrastRatio is the WCAG formula', () {
      expect(contrastRatio(Colors.black, Colors.white), closeTo(21, 0.001));
      expect(contrastRatio(Colors.white, Colors.white), closeTo(1, 0.001));
    });

    atLeast('ink on paper', BlynkColors.ink, BlynkColors.paper, 16);
    atLeast('ink2 on paper', BlynkColors.ink2, BlynkColors.paper, 4.5);
    atLeast('ink2 on well', BlynkColors.ink2, BlynkColors.well, 4.5);
    atLeast('ink3 on well', BlynkColors.ink3, BlynkColors.well, 7);
    atLeast('ink on signal', BlynkColors.ink, BlynkColors.signal, 12);
    atLeast('ink on signalPressed', BlynkColors.ink, BlynkColors.signalPressed, 9);
    atLeast('positiveInk on well', BlynkColors.positiveInk, BlynkColors.well, 5.5);
    atLeast('positiveInk on positiveTint', BlynkColors.positiveInk, BlynkColors.positiveTint, 5);
    atLeast('paper on positive', BlynkColors.paper, BlynkColors.positive, 4.5);
    atLeast('problem on paper', BlynkColors.problem, BlynkColors.paper, 6);
    atLeast('problem on problemTint', BlynkColors.problem, BlynkColors.problemTint, 5.5);
    atLeast('notice on noticeTint', BlynkColors.notice, BlynkColors.noticeTint, 5);
    atLeast('lineStrong on paper', BlynkColors.lineStrong, BlynkColors.paper, 3.5);
    atLeast('lineStrong on well', BlynkColors.lineStrong, BlynkColors.well, 3.5);
    atLeast('paper on ink (snackbar, cart bar)', BlynkColors.paper, BlynkColors.ink, 16);

    test('signalPressed is visibly darker than signal', () {
      expect(contrastRatio(BlynkColors.signalPressed, BlynkColors.signal), greaterThan(1.2));
    });

    test('yellow is never a text or border colour: signal on paper < 1.5:1', () {
      expect(contrastRatio(BlynkColors.signal, BlynkColors.paper), lessThan(1.5));
    });

    test('onSignal is ink and onPositive is paper', () {
      expect(BlynkColors.onSignal, BlynkColors.ink);
      expect(BlynkColors.onPositive, BlynkColors.paper);
    });

    // 2026-09 redesign, after the palette revert (plan §5). The gradient CTA
    // stops, the second green and the discount pair are gone, so the pairs
    // the app actually renders text or icons on are these.
    atLeast('onSignal on the flat CTA fill', BlynkCta.label, BlynkCta.fill, 12);
    atLeast('onSignal on the pressed CTA fill', BlynkCta.label, BlynkCta.fillPressed, 9);
    // labelDisabled is ink3, not ink2: ink2 on `line` measures only 3.97:1.
    atLeast('labelDisabled (ink3) on the disabled CTA fill', BlynkCta.labelDisabled, BlynkCta.fillDisabled, 4.5);
    // T2: the one disabled recipe, now named for what it is. Both pairings it
    // renders are measured, because plan §5 requires every pairing actually
    // used to be measured before use — filled kinds sit on BlynkDisabled.fill,
    // outline and text kinds keep their `paper` surface.
    atLeast('BlynkDisabled.label on BlynkDisabled.fill (filled kinds)', BlynkDisabled.label, BlynkDisabled.fill, 4.5);
    atLeast('BlynkDisabled.label on paper (outline and text kinds)', BlynkDisabled.label, BlynkColors.paper, 4.5);
    atLeast('promoLabel on promoFill (Shop Now pill)', BlynkCta.promoLabel, BlynkCta.promoFill, 4.5);
    atLeast('promoLabel on promoFillPressed', BlynkCta.promoLabel, BlynkCta.promoFillPressed, 4.5);
    atLeast('countBadgeLabel on countBadgeFill (cart badge)', BlynkNav.countBadgeLabel, BlynkNav.countBadgeFill, 4.5);
    atLeast('addLabel on the product card add control', BlynkCardProduct.addLabel, BlynkCardProduct.addFill, 12);
    atLeast('addLabelUnavailable on addFillUnavailable', BlynkCardProduct.addLabelUnavailable, BlynkCardProduct.addFillUnavailable, 4.5);
    atLeast('ink on the product image well', BlynkColors.ink, BlynkCardProduct.imageWell, 12);
    atLeast('strike on paper (struck original price)', BlynkColors.strike, BlynkColors.paper, 4.5);
    atLeast('ink on paper (the page is paper, never a cream canvas)', BlynkColors.ink, BlynkColors.paper, 16);

    // T2 ruling, pinned so it cannot be flipped back silently. The only dot
    // the customer app shows means "an order is on its way". Plan §5 reserves
    // `problem` (red) for errors and cancellation, so painting a normal
    // in-progress delivery red would be misinformation, not a style choice.
    // This token used to declare `problem`, which is why the shell could not
    // consume it; the token was the defect.
    test('the nav badge dot is neutral, never the problem red', () {
      expect(BlynkNav.badgeDot, BlynkColors.ink);
      expect(BlynkNav.badgeDot, isNot(BlynkColors.problem));
      expect(BlynkNav.badgeDotBorder, BlynkColors.paper);
      // The ring has to separate the dot from the glyph under it.
      expect(contrastRatio(BlynkNav.badgeDot, BlynkNav.badgeDotBorder), greaterThanOrEqualTo(3));
    });

    // T2: the inline glyph that pairs with 12 px caption text. It is a glyph,
    // not text, so the 12 px type floor does not apply to it - but it must
    // stay smaller than `sm`, or it stops being the inline size and starts
    // competing with the caption it sits beside.
    test('BlynkIcons.xs is the 16 dp inline glyph, below sm', () {
      expect(BlynkIcons.xs, 16);
      expect(BlynkIcons.xs, lessThan(BlynkIcons.sm));
      expect(BlynkIcons.sm, lessThan(BlynkIcons.md));
      expect(BlynkIcons.md, lessThan(BlynkIcons.lg));
    });

    test('signal is Blynk Yellow #FFE141 and positive is Blynk Green #0C831F', () {
      // The identity colours. A previous pass retuned signal to the reference
      // mock's #F7E95C; this pins it so that cannot happen silently again.
      expect(BlynkColors.signal.toARGB32(), 0xFFFFE141);
      expect(BlynkColors.positive.toARGB32(), 0xFF0C831F);
    });

    test('promoFillPressed is visibly lighter than promoFill', () {
      expect(contrastRatio(BlynkCta.promoFillPressed, BlynkCta.promoFill), greaterThan(1.2));
    });
  });

  group('the reverted palette has no second accent (plan §5)', () {
    /// Every file in the design layer, discovered live rather than enumerated,
    /// so a file added later (T2 will extend `components.dart`) is covered
    /// automatically — review I-3.
    List<File> designLayer() {
      final files = Directory('lib/design')
          .listSync(recursive: true)
          .whereType<File>()
          .where((f) => f.path.endsWith('.dart'))
          .toList();
      // Review M-5: a scope derived from a live directory listing must fail
      // loudly if the path ever stops matching, not pass vacuously.
      expect(files, isNotEmpty, reason: 'lib/design/ scan found nothing - the guard would be vacuous');
      return files;
    }

    /// Every `.dart` file under `lib/`, same companion assert.
    List<File> libFiles() {
      final files = Directory('lib')
          .listSync(recursive: true)
          .whereType<File>()
          .where((f) => f.path.endsWith('.dart'))
          .toList();
      expect(files, isNotEmpty, reason: 'lib/ scan found nothing - the guard would be vacuous');
      return files;
    }

    String norm(String path) => path.replaceAll(r'\', '/');

    // Review I-3: this used to read only tokens.dart and primitives.dart, so
    // the third layer T1 created (components.dart) — the very file T2 will
    // extend — was unguarded. It now scans the whole design layer.
    //
    // The patterns are whole-identifier, not substrings: a bare `contains`
    // check for 'tile' would false-match BlynkNav.tileRadius/tilePadding and
    // BlynkCardProduct's `selectedTile` neighbours.
    test('no canvas / ctaStart / ctaEnd / accentGreen / signalSoft / tile / discount* token anywhere in lib/design', () {
      final banned = <String, RegExp>{
        'canvas': RegExp(r'(?<![A-Za-z0-9_])canvas(?![A-Za-z0-9_])'),
        'ctaStart / ctaEnd / ctaInk': RegExp(r'(?<![A-Za-z0-9_])cta(?:Start|End|Ink)(?![A-Za-z0-9_])'),
        'signalSoft': RegExp(r'(?<![A-Za-z0-9_])signalSoft(?![A-Za-z0-9_])'),
        // Catches accentGreen, accentGreenPressed/Tint and onAccentGreen.
        'accentGreen (any variant)': RegExp(r'(?<![A-Za-z0-9_])(?:on)?[Aa]ccentGreen[A-Za-z0-9_]*'),
        'tile': RegExp(r'(?<![A-Za-z0-9_])tile(?![A-Za-z0-9_])'),
        'discountInk / discountTint': RegExp(r'(?<![A-Za-z0-9_])discount[A-Za-z0-9_]*'),
      };
      for (final f in designLayer()) {
        // Comments are stripped so the doc comments that explain the removal
        // do not themselves trip the guard.
        final source = _code(f.readAsStringSync());
        for (final entry in banned.entries) {
          expect(entry.value.hasMatch(source), isFalse,
              reason: '${norm(f.path)} re-introduces ${entry.key}');
        }
      }
    });

    test('the design layer defines no gradient at all', () {
      // Plan §5: "no gradients as decoration; the CTA is a flat signal fill".
      // BlynkGradients is gone, so there is nothing to opt back into.
      for (final f in designLayer()) {
        expect(_code(f.readAsStringSync()), isNot(contains('Gradient')), reason: norm(f.path));
      }
    });

    // Review I-2 / E-3. `categoryTints` WAS a reviewed deviation from plan §5
    // ("No per-screen colours", "No new palette"): four pastel tints behind
    // the unselected category tiles, kept only because deleting them meant
    // restyling category_widget.dart — an obligation the category redesign
    // carried. The 2026-09-24 redesign did that restyle and deleted them.
    //
    // This test used to pin the deviation's size. It now asserts the
    // deviation is gone and stays gone: the pastels may not be re-declared,
    // and no file may reference one. Colour behind a category is decoration
    // that carries no meaning, which is exactly what §5 forbids.
    test('the categoryTints deviation is closed: no declaration, no consumer', () {
      final reference = RegExp(r'(?<![A-Za-z0-9_])categoryTint[A-Za-z0-9_]*');

      final offenders = libFiles()
          .where((f) => reference.hasMatch(_code(f.readAsStringSync())))
          .map((f) => norm(f.path))
          .toList()
        ..sort();

      expect(offenders, isEmpty,
          reason: 'the pastel category tints were deleted; nothing may bring them back');
    });
  });

  // W8: the three tokens the waves reported rather than inlined. Each is
  // measured or ordered here, not merely declared.
  group('W8 tokens (the values the waves asked to be named)', () {
    test('BlynkForm caps are three distinct reading widths, all under the page cap', () {
      expect(BlynkForm.narrowMaxWidth, lessThan(BlynkForm.maxWidth));
      expect(BlynkForm.maxWidth, lessThan(BlynkForm.proseMaxWidth));
      // A form cap only means something if it is tighter than the page cap it
      // sits inside; ContentFrame's medium cap is 840.
      expect(BlynkForm.proseMaxWidth, lessThan(840));
      // ...and wide enough that a phone never hits it.
      expect(BlynkForm.narrowMaxWidth, greaterThan(430));
    });

    test('BlynkPromo.scrimOpacity reads, and BlynkColors.scrim measurably cannot replace it', () {
      // Worst case for a photographic promo background: a pure-white photo.
      Color over(Color wash, double alpha) => Color.alphaBlend(
            wash.withValues(alpha: alpha),
            const Color(0xffFFFFFF),
          );

      final chosen = contrastRatio(BlynkColors.paper, over(BlynkColors.ink, BlynkPromo.scrimOpacity));
      expect(chosen, greaterThanOrEqualTo(4.5),
          reason: 'the promo headline must read over any photograph the operator uploads');

      // The documented reason this is its own token: the existing flat scrim
      // - composited at its OWN baked-in alpha, which is what using it would
      // actually paint - does NOT clear the floor for the same pairing. If
      // this ever stops being true the token can be retired; it cannot be
      // *weakened*.
      final existing = contrastRatio(
        BlynkColors.paper,
        Color.alphaBlend(BlynkColors.scrim, const Color(0xffFFFFFF)),
      );
      expect(existing, lessThan(4.5),
          reason: 'BlynkColors.scrim is why BlynkPromo.scrimOpacity exists; tune the usage, never the floor');
      expect(chosen, greaterThan(existing));
    });

    test('BlynkMap.frameHeight is one height, and it is the larger of the two it replaced', () {
      // 200 (dental) vs 220 (order tracking). The tracking map is the content
      // of its screen, so the token took the number that does not shrink it.
      expect(BlynkMap.frameHeight, 220);
      expect(BlynkMap.frameHeight, greaterThan(200));
      expect(BlynkMap.frameRadius, BlynkRadius.lgAll);
    });
  });

  group('scales', () {
    test('spacing is the 4-pt scale', () {
      expect(
        [
          BlynkSpace.s4,
          BlynkSpace.s8,
          BlynkSpace.s12,
          BlynkSpace.s16,
          BlynkSpace.s24,
          BlynkSpace.s32,
          BlynkSpace.s48,
        ],
        [4, 8, 12, 16, 24, 32, 48],
      );
    });

    test('radii are 8 / 12 / 20 and full is a pill', () {
      expect([BlynkRadius.sm, BlynkRadius.md, BlynkRadius.lg], [8, 12, 20]);
      expect(BlynkRadius.smAll, BorderRadius.circular(8));
      expect(BlynkRadius.mdAll, BorderRadius.circular(12));
      expect(BlynkRadius.lgAll, BorderRadius.circular(20));
      expect(BlynkRadius.lgTop.topLeft, const Radius.circular(20));
      expect(BlynkRadius.lgTop.bottomLeft, Radius.zero);
      expect(BlynkRadius.full.topLeft.x, greaterThanOrEqualTo(999));
    });

    test('gutterFor breakpoints: 16 < 600, 24 < 1024, 32 above', () {
      expect(BlynkSpace.gutterFor(320), 16);
      expect(BlynkSpace.gutterFor(599.9), 16);
      expect(BlynkSpace.gutterFor(600), 24);
      expect(BlynkSpace.gutterFor(1023.9), 24);
      expect(BlynkSpace.gutterFor(1024), 32);
      expect(BlynkSpace.gutterFor(1920), 32);
    });

    test('durations are 60 / 120 / 200 / 280 / 320 ms, camera 500', () {
      expect(BlynkMotion.instant, const Duration(milliseconds: 60));
      expect(BlynkMotion.fast, const Duration(milliseconds: 120));
      expect(BlynkMotion.base, const Duration(milliseconds: 200));
      expect(BlynkMotion.slow, const Duration(milliseconds: 280));
      expect(BlynkMotion.emphasized, const Duration(milliseconds: 320));
      expect(BlynkMotion.camera, const Duration(milliseconds: 500));
      // Strictly ordered, so a token name always means what its neighbour
      // implies: nothing "fast" may take longer than something "base".
      expect(BlynkMotion.instant < BlynkMotion.fast, isTrue);
      expect(BlynkMotion.fast < BlynkMotion.base, isTrue);
      expect(BlynkMotion.base < BlynkMotion.slow, isTrue);
      expect(BlynkMotion.slow < BlynkMotion.emphasized, isTrue);
      expect(BlynkMotion.emphasized < BlynkMotion.camera, isTrue);
    });

    test('curves: enter decelerates, exit accelerates, standard eases both', () {
      expect(BlynkMotion.easeOut, Curves.easeOutCubic);
      expect(BlynkMotion.easeIn, Curves.easeInCubic);
      expect(BlynkMotion.standard, Curves.easeInOutCubic);
    });

    test('press and entrance are felt, not watched', () {
      expect(BlynkMotion.pressScale, 0.97);
      expect(BlynkMotion.entranceTravel, 16);
      expect(BlynkMotion.entrance, const Duration(milliseconds: 450));
      expect(BlynkMotion.entranceStep, const Duration(milliseconds: 90));
      expect(BlynkMotion.entranceRise, 24);
    });

    test('stagger: 40 ms a step, capped at 6, so a long list never waits on itself', () {
      expect(BlynkMotion.staggerStep, const Duration(milliseconds: 40));
      expect(BlynkMotion.staggerCap, 6);
      expect(BlynkMotion.staggerFor(0), Duration.zero);
      expect(BlynkMotion.staggerFor(3), const Duration(milliseconds: 120));
      expect(BlynkMotion.staggerFor(6), const Duration(milliseconds: 240));
      expect(BlynkMotion.staggerFor(40), BlynkMotion.staggerFor(6),
          reason: 'past the cap every item shares the cap delay');
    });

    test('icon sizes are 20 / 24 / 32', () {
      expect([BlynkIcons.sm, BlynkIcons.md, BlynkIcons.lg], [20, 24, 32]);
    });

    test('only the cart bar and overlays cast a shadow', () {
      expect(BlynkElevation.none, isEmpty);
      expect(BlynkElevation.raised, hasLength(1));
      expect(BlynkElevation.overlayDp, greaterThan(0));
      expect(BlynkElevation.overlayShadow.a, lessThan(0.3));
    });

    test('chip/pill radii are 16 / 10, and lg (20) is the card/CTA radius', () {
      expect(BlynkRadius.chip, 16);
      expect(BlynkRadius.pill, 10);
      expect(BlynkRadius.lg, 20);
      expect(BlynkRadius.chipAll, BorderRadius.circular(16));
      expect(BlynkRadius.pillAll, BorderRadius.circular(10));
    });

    test('BlynkElevation.soft is one wide, low-opacity shadow', () {
      expect(BlynkElevation.soft, hasLength(1));
      final shadow = BlynkElevation.soft.single;
      expect(shadow.blurRadius, 18);
      expect(shadow.offset, const Offset(0, 6));
      expect(shadow.color.a, lessThan(0.1));
    });

  });

  group('BlynkMotion.resolve', () {
    Future<Duration> resolved(WidgetTester tester, {required bool disableAnimations}) async {
      late Duration result;
      await tester.pumpWidget(
        MediaQuery(
          data: MediaQueryData(disableAnimations: disableAnimations),
          child: Builder(
            builder: (context) {
              result = BlynkMotion.resolve(context, BlynkMotion.base);
              return const SizedBox();
            },
          ),
        ),
      );
      return result;
    }

    testWidgets('is zero when the platform disables animations', (tester) async {
      expect(await resolved(tester, disableAnimations: true), Duration.zero);
    });

    testWidgets('passes the duration through otherwise', (tester) async {
      expect(await resolved(tester, disableAnimations: false), BlynkMotion.base);
    });
  });

  group('BlynkIcons', () {
    test('semantically distinct icons never share a glyph', () {
      final seen = <IconData>{};
      for (final icon in BlynkIcons.distinct) {
        expect(seen.add(icon), isTrue, reason: 'duplicate icon 0x${icon.codePoint.toRadixString(16)}');
      }
    });

    test('address book differs from packed, orders and the address labels', () {
      expect(BlynkIcons.addressBook, isNot(BlynkIcons.packed));
      expect(BlynkIcons.addressBook, isNot(BlynkIcons.orders));
      expect(BlynkIcons.addressHome, isNot(BlynkIcons.shop));
    });
  });

  group('BlynkText', () {
    test('scale matches the plan (size / line height / weight)', () {
      void expectStyle(TextStyle s, double size, double line, FontWeight w) {
        expect(s.fontSize, size);
        expect(s.height! * s.fontSize!, closeTo(line, 0.001));
        expect(s.fontWeight, w);
        // 2026-09-24: family moved Catamaran -> Poppins for the reference
        // design. Expectation updated, assertion strength unchanged.
        expect(s.fontFamily, BlynkText.family);
        expect(s.color, BlynkColors.ink);
      }

      expectStyle(BlynkText.display, 28, 34, FontWeight.w800);
      expectStyle(BlynkText.title, 20, 26, FontWeight.w800);
      expectStyle(BlynkText.heading, 16, 22, FontWeight.w700);
      expectStyle(BlynkText.body, 14, 20, FontWeight.w500);
      expectStyle(BlynkText.label, 14, 20, FontWeight.w700);
      expectStyle(BlynkText.caption, 12, 16, FontWeight.w600);
    });

    test('price is heading-size w800 with tabular figures', () {
      expect(BlynkText.price.fontSize, BlynkText.heading.fontSize);
      expect(BlynkText.price.fontWeight, FontWeight.w800);
      expect(BlynkText.price.fontFeatures, contains(const FontFeature.tabularFigures()));
    });

    test('2026-09 redesign additions: size / line height / weight', () {
      void expectStyle(TextStyle s, double size, double line, FontWeight w) {
        expect(s.fontSize, size);
        expect(s.height! * s.fontSize!, closeTo(line, 0.001));
        expect(s.fontWeight, w);
        // 2026-09-24: family moved Catamaran -> Poppins for the reference
        // design. Expectation updated, assertion strength unchanged.
        expect(s.fontFamily, BlynkText.family);
        expect(s.color, BlynkColors.ink);
      }

      expectStyle(BlynkText.headline, 22, 28, FontWeight.w800);
      expectStyle(BlynkText.sectionHeader, 17, 22, FontWeight.w700);
      expectStyle(BlynkText.ctaLabel, 17, 22, FontWeight.w800);
      expectStyle(BlynkText.priceSmall, 15, 20, FontWeight.w800);
      expectStyle(BlynkText.priceLarge, 26, 32, FontWeight.w800);
      // review R1 I-2: raised from 11 to 12 so this style can never again
      // silently bypass the 12 px accessibility floor from inside the
      // token layer (see design_hygiene_ratchet_test.dart's floor guard).
      expectStyle(BlynkText.microLabel, 12, 14, FontWeight.w700);
      expectStyle(BlynkText.rowLabel, 15, 20, FontWeight.w700);
      expect(BlynkText.priceSmall.fontFeatures, contains(const FontFeature.tabularFigures()));
      expect(BlynkText.priceLarge.fontFeatures, contains(const FontFeature.tabularFigures()));
    });

    test('textTheme maps the scale onto Material roles', () {
      final t = BlynkText.textTheme;
      expect(t.displayMedium, BlynkText.display);
      expect(t.titleLarge, BlynkText.title);
      expect(t.titleMedium, BlynkText.heading);
      expect(t.bodyMedium, BlynkText.body);
      expect(t.bodyLarge, BlynkText.body);
      expect(t.labelLarge, BlynkText.label);
      expect(t.bodySmall, BlynkText.caption);
      expect(t.labelMedium, BlynkText.caption);
      expect(t.labelSmall, BlynkText.caption);
    });
  });
}
