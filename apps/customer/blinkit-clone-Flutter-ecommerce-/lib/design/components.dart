/// **Layer 3 — component tokens** (plan §24a).
///
/// Blynk's design system had two layers: `primitives.dart` (raw values) and
/// `tokens.dart` (semantic roles — `signal`, `ink`, `well`). What was missing
/// was a layer that names *what a thing is*: "the product card's price", "the
/// CTA's pressed fill", "the selected nav tile". Without it every screen
/// re-derived those answers inline, which is the structural reason 114
/// font-size literals had leaked out of the type layer.
///
/// Rules for this file:
/// * every value resolves to a semantic token from `tokens.dart` or a type
///   token from `typography.dart` — **never a raw hex** (`primitives.dart`
///   stays the only file with raw hex) and **never a font size**
///   (`typography.dart` stays the only file that declares one, so the 12 px
///   floor guard sees every size);
/// * nothing here encodes data or behaviour — these are looks only.
library;

import 'package:flutter/material.dart';

import 'tokens.dart';

/// The three type roles the redesign adds (plan §6). They are component
/// tokens, **not new sizes** — each one resolves to an existing entry in the
/// Catamaran scale.
abstract final class BlynkType {
  /// §6 `price` — w800 with lining/tabular figures, on [BlynkColors.ink].
  /// The default (detail rows, cart lines, bill totals).
  static const TextStyle price = BlynkText.price;

  /// [price] at product-card size.
  static const TextStyle priceCompact = BlynkText.priceSmall;

  /// [price] at a cart / bill grand-total size.
  static final TextStyle priceTotal = BlynkText.headline
      .copyWith(fontFeatures: const [FontFeature.tabularFigures()]);

  /// [price] at product-detail hero size.
  static const TextStyle priceHero = BlynkText.priceLarge;

  /// §6 `priceStruck` — [BlynkColors.strike] plus a line-through. Rendered
  /// **only** where the backend returns a real original price; there is no
  /// client-side discount source.
  static final TextStyle priceStruck = BlynkText.caption.copyWith(
    color: BlynkColors.strike,
    decoration: TextDecoration.lineThrough,
    // The line is green, the old figure stays grey (owner, 2026-10-09).
    decorationColor: BlynkColors.sale,
    decorationThickness: 2,
  );

  /// §6 `productName` — [BlynkText.heading], clamped to
  /// [productNameMaxLines] with [productNameOverflow].
  static const TextStyle productName = BlynkText.heading;
  static const int productNameMaxLines = 2;
  static const TextOverflow productNameOverflow = TextOverflow.ellipsis;

  /// The unit / pack-size line that sits under [productName].
  static final TextStyle productUnit =
      BlynkText.caption.copyWith(fontWeight: FontWeight.w400, color: BlynkColors.ink2);
}

/// The **one** disabled recipe, shared by every interactive control — every
/// [BlynkCta] kind and every outline/text button alike.
///
/// It is deliberately not named after any one component: a `BlynkCta.*` name
/// consumed by a secondary or tertiary button would read as CTA styling
/// leaking sideways, and later tasks copy whatever pattern they see.
///
/// A disabled surface is a flat neutral, never a dimmed [BlynkCta.fill] — a
/// washed-out yellow still reads as "the action" without being tappable.
/// [label] is `ink3`, not `ink2`: measured, `ink2` on [fill] is only 3.97:1,
/// under the 4.5:1 text floor. `ink3` clears **6.21:1** on [fill] and
/// **7.56:1** on `paper` (the outline kinds), and is still visibly not an
/// enabled label.
abstract final class BlynkDisabled {
  static const Color fill = BlynkColors.line;
  static const Color label = BlynkColors.ink3;
}

/// Geometry shared by every button kind, so the widget cannot drift from the
/// token layer. The forward CTA is taller and has its own [BlynkCta.minHeight]
/// (56); everything here is the ordinary control.
abstract final class BlynkControl {
  /// The accessibility floor for any tappable control.
  static const double minHeight = 48;

  /// The visual height of a button in a tight bar (the cart bar's pill). Its
  /// tap target stays [minHeight] via `MaterialTapTargetSize.padded`.
  static const double compactHeight = 44;

  /// The floor for a button that does not fill its row, so a one-word label
  /// ("Add", "OK") still reads as a button rather than as text with a box.
  static const double minWidth = 64;

  /// The boundary on an outline button (secondary, destructive). Thicker than
  /// a divider and thinner than the 2 dp focus ring, so the three are always
  /// distinguishable from one another.
  static const double outlineWidth = 1.5;

  /// The in-flight spinner that replaces a button label without changing its
  /// width, and the smaller one for a [compactHeight]-class pill.
  static const double spinner = 18;
  static const double spinnerCompact = 16;
}

/// How wide a column of text or fields is allowed to get before it stops
/// being readable. `ContentFrame.capFor` starts at 840, which is a *page*
/// cap — right for a list or a grid, far too wide for a form or for prose.
///
/// W6 and W7 each hit this and named the same numbers privately (`560` twice
/// in dental, `560`/`480`/`640` across three W7 screens), which is exactly
/// the drift the component layer exists to stop. The three roles are named
/// separately because they are three different reading problems, not one
/// number used three ways.
abstract final class BlynkForm {
  /// A multi-field form (an address, patient details). Wide enough for a
  /// two-field row, narrow enough that a label still sits near its field.
  static const double maxWidth = 560;

  /// A single-purpose column: one input and one action (OTP entry, a
  /// confirmation moment). Anything wider leaves the action stranded from
  /// the thing it acts on.
  static const double narrowMaxWidth = 480;

  /// Continuous prose (About, policy copy). The classic measure — roughly
  /// 70–80 characters at [BlynkText.body] — above which the eye loses the
  /// start of the next line.
  static const double proseMaxWidth = 640;
}

/// A map surface embedded in a page (the live order-tracking frame, a dental
/// clinic's location, an appointment's location).
///
/// **One height, deliberately 220 and not 200.** The app had two numbers:
/// `order_tracking_map.dart` used 220 and dental's frames used 200. 220 wins
/// because the tracking map is the *content* of its screen — the answer to
/// "where is my order" — and shrinking it would remove context from the one
/// place the map carries the information. Dental's frames are a location
/// *reference* inside a scrolling column, so 20 dp more only adds context and
/// cannot clip. Taking the smaller number would have degraded the important
/// surface to match the incidental one.
abstract final class BlynkMap {
  static const double frameHeight = 220;
  static const BorderRadius frameRadius = BlynkRadius.lgAll;
}

/// A promotional surface that puts text on top of a photograph.
abstract final class BlynkPromo {
  /// The flat [BlynkColors.ink] wash between a photo and its copy.
  ///
  /// **[BlynkColors.scrim] cannot serve here and is not a substitute**: it is
  /// a flat 50 % black, and `paper` over it on a white photograph measures
  /// only **3.95:1** — under the 4.5:1 text floor. At 0.66 the same pairing
  /// measures **5.38:1** at its worst point, which is why this is a separate
  /// token rather than a reuse. Tune this number, never the floor.
  static const double scrimOpacity = 0.66;
}

/// The one primary action on a screen (plan §4.3, clarified in T2: "one yellow
/// moment" means one yellow **action** per screen — persistent chrome that
/// marks *where you are*, such as the selected nav tile, is not an action and
/// does not consume it), §5 "the CTA is a flat `signal` fill".
abstract final class BlynkCta {
  /// Flat Blynk Yellow. Never a gradient, never green.
  static const Color fill = BlynkColors.signal;
  static const Color fillPressed = BlynkColors.signalPressed;

  /// The shared disabled recipe — see [BlynkDisabled], which is where it is
  /// decided. These two stay as the CTA's names for it so the existing call
  /// sites and contrast tests keep reading naturally.
  static const Color fillDisabled = BlynkDisabled.fill;

  static const Color label = BlynkColors.onSignal;

  static const Color labelDisabled = BlynkDisabled.label;

  static const BorderRadius radius = BlynkRadius.lgAll;
  static const double minHeight = 56;
  static const EdgeInsets padding =
      EdgeInsets.symmetric(horizontal: BlynkSpace.s24, vertical: BlynkSpace.s12);
  static const double iconSize = BlynkIcons.sm;

  /// A trailing `Icons.arrow_forward` is allowed; a literal `→` in the label
  /// is not (guarded).
  static const TextStyle labelStyle = BlynkText.ctaLabel;

  /// Focus is a 2 dp ink ring, never colour alone.
  static const Color focusRing = BlynkColors.ink;
  static const double focusRingWidth = 2;

  /// The secondary/promotional pill that sits *on* a [fill] or photographic
  /// promo surface. It is deliberately [BlynkColors.ink], not a second
  /// yellow and not a second green.
  static const Color promoFill = BlynkColors.ink;

  /// Pressed [promoFill]: 2.21:1 lighter than [promoFill], and
  /// [promoLabel] still clears 7.56:1 on it.
  static const Color promoFillPressed = BlynkColors.ink3;
  static const Color promoLabel = BlynkColors.onInk;
  static const double promoMinHeight = 44;
  static const EdgeInsets promoPadding =
      EdgeInsets.symmetric(horizontal: BlynkSpace.s24, vertical: BlynkSpace.s8);
  static const BorderRadius promoRadius = BlynkRadius.full;
}

/// The product card — the single most repeated unit in the app (plan §8).
abstract final class BlynkCardProduct {
  static const Color surface = BlynkColors.paper;
  static const BorderRadius radius = BlynkRadius.lgAll;
  static const List<BoxShadow> elevation = BlynkElevation.soft;
  /// Tightened from s12 on 2026-09-25. On a three-column phone grid the card
  /// is ~121 dp wide, and every dp of padding is taken off the content box
  /// the quantity stepper has to fit its two 48 dp tap targets into.
  static const double padding = BlynkSpace.s8;

  /// The image sits on a [BlynkColors.well] tint, never inside a border
  /// (plan §4.1). This replaces the previous pass's pale-lime `tile`.
  static const Color imageWell = BlynkColors.well;
  static const BorderRadius imageRadius = BlynkRadius.chipAll;

  static const TextStyle name = BlynkType.productName;
  static const int nameMaxLines = BlynkType.productNameMaxLines;
  static const TextStyle price = BlynkType.priceCompact;

  /// Gap between the image well and the identity block.
  static const double gap = BlynkSpace.s8;

  /// The "+" add control is the card's yellow moment (plan §8).
  static const Color addFill = BlynkColors.signal;
  static const Color addFillPressed = BlynkColors.signalPressed;
  static const Color addLabel = BlynkColors.onSignal;
  static const Color addFillUnavailable = BlynkColors.well;
  static const Color addLabelUnavailable = BlynkColors.ink2;
  static const BorderRadius addRadius = BlynkRadius.pillAll;

  /// The unavailable scrim over the image well. Only rendered when the
  /// backend reports the product unavailable.
  static const Color unavailableWashColor = BlynkColors.paper;
  static const double unavailableWashOpacity = 0.72;
}

/// The image well — the tinted, rounded container **every** product image
/// sits in (card, rail, cart line, detail hero) — and the no-image fallback
/// it draws when there is no photo.
///
/// 40 of the 41 products in the live catalogue have no `image_url`, so the
/// fallback is not an edge case: it is the app's default appearance. It is a
/// deliberate composition built only out of Blynk's own surfaces — the
/// [tint], a [fallbackDisc] medallion and a low-emphasis [fallbackGlyph]
/// category glyph — never a broken-image glyph, a grey box, "image
/// unavailable" text, or stock/generated/externally-hosted imagery.
///
/// [fallbackDiscFraction] is of the well's shorter side and
/// [fallbackGlyphFraction] is of the medallion, so one composition reads
/// correctly from a 72 dp cart thumbnail up to a 320 dp detail hero without
/// any caller passing a size.
abstract final class BlynkWell {
  static const Color tint = BlynkCardProduct.imageWell;
  static const BorderRadius radius = BlynkCardProduct.imageRadius;

  /// Breathing room between the photo and the well's edge (plan §4.1: the
  /// image is inset, never bled to the corner radius).
  static const double inset = BlynkSpace.s8;

  /// The medallion behind the fallback glyph. `line` on [tint] is a quiet
  /// step, not a second surface colour — enough to read as deliberate, far
  /// too little to compete with the product name.
  static const Color fallbackDisc = BlynkColors.line;

  /// The glyph itself: `ink2`, the muted text role. It clears the 3:1
  /// non-text floor on [fallbackDisc] and stays below the name in emphasis.
  static const Color fallbackGlyph = BlynkColors.ink2;

  static const double fallbackDiscFraction = 0.56;
  static const double fallbackGlyphFraction = 0.5;

  /// Floors, so the medallion still reads in a 40 dp thumbnail and never
  /// swells into a hero-sized blob.
  static const double fallbackDiscMin = BlynkSpace.s24;
  static const double fallbackDiscMax = 160;
}

/// Bottom bar and navigation rail (plan §9): selected = a filled icon on a
/// `signal` rounded-square tile, label at 12 px minimum.
abstract final class BlynkNav {
  static const Color surface = BlynkColors.paper;
  static const Color divider = BlynkColors.line;

  /// The selected destination's tile, and the app's other yellow surface.
  ///
  /// This is **chrome, not an action**: it marks where you are. Plan §4.3's
  /// "one yellow moment per screen" counts yellow *actions* (T2 ruling), so a
  /// screen may show this tile and its one [BlynkCta.fill] action together —
  /// what it may not show is two yellow actions. The same reading is on
  /// [BlynkCta], so whichever yellow token you reach for, the rule is there.
  static const Color selectedTile = BlynkColors.signal;
  static const Color unselectedTile = BlynkColors.clear;
  static const BorderRadius tileRadius = BlynkRadius.chipAll;
  static const EdgeInsets tilePadding = EdgeInsets.all(BlynkSpace.s4 + 2);

  static const Color selectedIcon = BlynkColors.ink;
  static const Color unselectedIcon = BlynkColors.ink2;
  static const double iconSize = BlynkIcons.md;

  /// 12 px is the absolute floor — nav labels included.
  static const TextStyle label = BlynkText.caption;
  static const Color selectedLabel = BlynkColors.ink;
  static const Color unselectedLabel = BlynkColors.ink2;

  /// The dot on a nav icon, with [badgeDotBorder] as its ring so it stays
  /// legible over the icon beneath it.
  ///
  /// Neutral `ink`, **not** `problem`. T2 ruling: the only dot the customer
  /// app shows means "an order is on its way", and plan §5 reserves `problem`
  /// (red) for **errors and cancellation** — colouring a normal delivery red
  /// is misinformation, not a style choice. This token previously declared
  /// `problem`, which is why `adaptive_scaffold.dart` could not consume it;
  /// the token was the defect, not the widget.
  ///
  /// The dot never carries meaning alone either: the destination's
  /// `badgeDescription` is spoken with its label.
  static const Color badgeDot = BlynkColors.ink;
  static const Color badgeDotBorder = BlynkColors.paper;

  /// The cart count badge on a circular chrome button. Ink, not a second
  /// accent — the screen's yellow belongs to its one action.
  static const Color countBadgeFill = BlynkColors.ink;
  static const Color countBadgeLabel = BlynkColors.onInk;
  static const Color countBadgeBorder = BlynkColors.paper;
  static const TextStyle countBadgeStyle = BlynkText.microLabel;
}

/// The quantity stepper (plan §8): a pill on `paper` with a `line-strong`
/// boundary and at least 48 dp per control.
abstract final class BlynkStepper {
  static const Color surface = BlynkColors.paper;
  static const Color border = BlynkColors.line;
  static const Color borderStrong = BlynkColors.lineStrong;
  static const BorderRadius radius = BlynkRadius.full;

  /// Tap-target floor for the "-" / "+" controls and the whole pill.
  static const double minTapSize = 48;

  /// The height of the drawn pill inside that [minTapSize] box. The extra
  /// 8 dp is invisible hit area, so a tap just outside the outline still
  /// registers.
  static const double visualHeight = 40;

  static const TextStyle count = BlynkText.label;
  static const Color countColor = BlynkColors.ink;
  static const Color icon = BlynkColors.ink;
  static const Color iconDisabled = BlynkColors.ink2;
  static const double iconSize = BlynkIcons.sm;
}

/// The category carousel's tile: a **circular image container with the name
/// underneath**, used by Home's rail and by the Categories grid so the two
/// cannot drift.
///
/// 2026-09-24 redesign. The previous tile was a large rounded square filled
/// with one of four pastel tints, and the selected one was a solid `signal`
/// block. Four rotating pastels are decoration that carries no meaning — the
/// colour does not tell you anything about the category — and a row of them
/// read as a template rather than as a shop. The replacement is image-led:
/// one neutral [surface] for every tile, a circle so the imagery is the
/// shape, and colour reserved for the selected state alone.
///
/// **The selected ring cannot be the only cue.** Blynk Yellow measures
/// 1.30:1 against `paper` and 1.23:1 against [surface] — it is a brand
/// colour, not a contrast colour, and no yellow-on-light indicator can meet
/// the 3:1 non-text floor. The selected state is therefore carried by three
/// channels at once: this ring, the [labelSelected] weight step, and the
/// caller's `Semantics(selected: true)`. Remove any one of them and the
/// state is still announced and still visible.
abstract final class BlynkCategory {
  /// The circle's diameter per responsive class. It is **capped**, not
  /// proportional: a wider screen shows more categories, never larger ones.
  static const double diameterCompact = 64;
  static const double diameterMedium = 72;
  static const double diameterExpanded = 76;

  /// The one neutral surface every tile sits on — the same `well` the
  /// product image sits on, so a category and the products inside it share a
  /// surface instead of inventing a second one.
  static const Color surface = BlynkColors.well;

  /// Selected: a thin ring plus the faintest wash. Deliberately not a solid
  /// fill — see the class doc.
  static const Color selectedSurface = BlynkColors.signalWash;
  static const Color selectedRing = BlynkColors.signal;
  static const double ringWidth = 2;

  /// Press and hover feedback is a **fill change on the circle alone** — the
  /// same rule [BlynkCta] follows ("the pressed state is the fill change
  /// alone, so nothing shifts"). There is deliberately no ink ripple: a
  /// splash on a tile that is a circle above a label paints a stadium-shaped
  /// wash across both, which is the opposite of subtle.
  static const Color pressedSurface = BlynkColors.line;
  static const Color selectedPressedSurface = BlynkColors.signalWashPressed;

  /// Keyboard focus is an **ink** ring, not the yellow one: at 1.30:1 on
  /// paper, yellow cannot carry a focus indicator. Ink measures 16.51:1.
  static const Color focusRing = BlynkColors.ink;
  static const double focusRingWidth = 2;

  /// The photo is inset by [ringWidth] **whether or not the tile is
  /// selected**, so selecting one never resizes or reflows the row.
  static const double photoInset = ringWidth;

  /// The no-image fallback: one low-emphasis semantic glyph on [surface].
  /// `ink2` measures 4.83:1 on [surface] and 4.60:1 on [selectedSurface].
  /// There is no medallion here — at 64 dp a disc behind the glyph reads as
  /// a second circle inside the first.
  static const Color fallbackGlyph = BlynkColors.ink2;

  /// Of the circle's diameter, so one number is right at every size.
  static const double fallbackGlyphFraction = 0.42;

  /// Gap between the circle and its label.
  static const double gap = BlynkSpace.s8;

  static const TextStyle label = BlynkText.caption;
  static TextStyle get labelSelected =>
      BlynkText.caption.copyWith(fontWeight: FontWeight.w700);

  /// Always reserved, so a one-line name and a two-line name leave their
  /// tiles the same height and the row stays on one baseline.
  static const int labelMaxLines = 2;
}
