import 'package:flutter/material.dart';

import 'primitives.dart';

export 'components.dart';
export 'motion.dart';
export 'typography.dart';

/// Semantic colour roles. Yellow is only ever a fill for the forward action
/// (label [onSignal]); green is only ever a true positive state.
abstract final class BlynkColors {
  static const Color signal = BlynkPalette.signal;
  static const Color signalPressed = BlynkPalette.signalPressed;

  /// The quietest step on the signal ramp: a selected-state wash, never a
  /// fill that competes with a real yellow action.
  static const Color signalWash = BlynkPalette.signalWash;

  /// [signalWash] while pressed.
  static const Color signalWashPressed = BlynkPalette.signalWashPressed;
  static const Color ink = BlynkPalette.ink;
  static const Color ink2 = BlynkPalette.ink2;
  static const Color ink3 = BlynkPalette.ink3;
  static const Color paper = BlynkPalette.paper;
  static const Color well = BlynkPalette.well;
  static const Color line = BlynkPalette.line;
  static const Color lineStrong = BlynkPalette.lineStrong;
  static const Color positive = BlynkPalette.positive;
  static const Color positiveInk = BlynkPalette.positiveInk;
  static const Color positiveTint = BlynkPalette.positiveTint;
  static const Color problem = BlynkPalette.problem;
  static const Color problemTint = BlynkPalette.problemTint;
  static const Color notice = BlynkPalette.notice;
  static const Color noticeTint = BlynkPalette.noticeTint;
  static const Color scrim = BlynkPalette.scrim;
  static const Color clear = BlynkPalette.clear;

  static const Color onSignal = ink;
  static const Color onPositive = paper;

  /// Label colour on an [ink] fill (snackbars, the cart bar, the count badge
  /// and the promo pill that sits on a yellow or photographic surface).
  static const Color onInk = paper;

  /// The quieter second line on an [ink] fill — the cart bar's item count
  /// beneath its total. 9.09:1 on [ink], so it is muted by contrast *ramp*,
  /// not by dropping under the 4.5:1 floor.
  static const Color onInkMuted = BlynkPalette.paperMuted;

  /// Struck-through original price. Only ever used where the backend
  /// actually returns an original price.
  static const Color strike = BlynkPalette.strike;

  /// The reduced price, and the green line through the old one.
  static const Color sale = BlynkPalette.sale;

  // 2026-09-24: `categoryTints` was DELETED. See the note in primitives.dart —
  // the category tile no longer paints decorative colour, so the deviation it
  // represented is closed.
}

abstract final class BlynkSpace {
  static const double s4 = BlynkScale.s4;
  static const double s8 = BlynkScale.s8;
  static const double s12 = BlynkScale.s12;
  static const double s16 = BlynkScale.s16;
  static const double s24 = BlynkScale.s24;
  static const double s32 = BlynkScale.s32;
  static const double s48 = BlynkScale.s48;

  /// Page gutter: 16 compact, 24 medium, 32 expanded.
  static double gutterFor(double width) {
    if (width < 600) return s16;
    if (width < 1024) return s24;
    return s32;
  }
}

abstract final class BlynkRadius {
  static const double sm = BlynkScale.radiusSm;
  static const double md = BlynkScale.radiusMd;
  static const double lg = BlynkScale.radiusLg;

  static const BorderRadius smAll = BorderRadius.all(Radius.circular(sm));
  static const BorderRadius mdAll = BorderRadius.all(Radius.circular(md));
  static const BorderRadius lgAll = BorderRadius.all(Radius.circular(lg));
  static const BorderRadius lgTop = BorderRadius.vertical(top: Radius.circular(lg));

  /// Stepper and badge pills only.
  static const BorderRadius full = BorderRadius.all(Radius.circular(999));

  // 2026-09 redesign radii. `lg` (20) already matches the spec's card/CTA
  // radius, so it is reused rather than duplicated.
  /// Product-image tiles and chips.
  static const double chip = 16;
  /// Small pills/badges and the product-card "+" button.
  static const double pill = 10;

  static const BorderRadius chipAll = BorderRadius.all(Radius.circular(chip));
  static const BorderRadius pillAll = BorderRadius.all(Radius.circular(pill));
}

/// [none] for flat surfaces, [raised] for the floating cart bar, [overlayDp]/
/// [overlayShadow] for modal sheets/dialogs, and [soft] (2026-09 redesign)
/// for every card — `appCardDecoration()` and `ProductCard` both use it, so
/// cards float on a soft shadow app-wide rather than being flat.
abstract final class BlynkElevation {
  static const List<BoxShadow> none = <BoxShadow>[];

  static const List<BoxShadow> raised = <BoxShadow>[
    BoxShadow(color: BlynkPalette.shadowRaised, blurRadius: 16, offset: Offset(0, 4)),
  ];

  /// Sheets and dialogs are Material surfaces, so their shadow is an
  /// elevation level plus a colour rather than a [BoxShadow] list.
  static const double overlayDp = 3;
  static const Color overlayShadow = BlynkPalette.shadowOverlay;

  /// 2026-09 redesign: the one card-elevation token. Cards float on a soft,
  /// wide, low-opacity shadow instead of a hairline border. Screens and
  /// organisms must use this token, never an ad-hoc [BoxShadow] literal.
  static const List<BoxShadow> soft = <BoxShadow>[
    BoxShadow(color: BlynkPalette.shadowSoft, blurRadius: 18, offset: Offset(0, 6)),
  ];
}

// There is deliberately no `BlynkGradients`. Plan §5: "no gradients as
// decoration; the CTA is a flat `signal` fill". The previous pass added a
// lime -> green CTA gradient and a signal -> signalSoft promo gradient; both
// are gone, so the design layer now defines no gradient at all and
// design_hygiene_ratchet_test.dart asserts that (a gradient anywhere outside
// the ratcheted carousel file fails immediately).

/// One family: Material outlined. Filled glyphs only for selected nav items
/// and state icons (check, warning).
abstract final class BlynkIcons {
  /// 16 — the inline glyph that pairs with 12 px caption text (status pill,
  /// inline field error, order status row). [sm] is 20 and reads as a second
  /// heading next to a caption.
  static const double xs = BlynkScale.iconXs;
  static const double sm = BlynkScale.iconSm;
  static const double md = BlynkScale.iconMd;
  static const double lg = BlynkScale.iconLg;

  static const IconData shop = Icons.storefront_outlined;
  static const IconData shopSelected = Icons.storefront;
  static const IconData orders = Icons.receipt_long_outlined;
  static const IconData ordersSelected = Icons.receipt_long;
  static const IconData addressBook = Icons.menu_book_outlined;
  static const IconData addressBookSelected = Icons.menu_book;
  static const IconData packed = Icons.inventory_2_outlined;
  static const IconData cart = Icons.shopping_bag_outlined;
  static const IconData cartSelected = Icons.shopping_bag;
  static const IconData search = Icons.search;
  static const IconData help = Icons.help_outline;
  static const IconData helpSelected = Icons.help;
  static const IconData profile = Icons.person_outline;
  static const IconData profileSelected = Icons.person;
  static const IconData back = Icons.arrow_back;
  static const IconData close = Icons.close;
  static const IconData check = Icons.check_circle;
  static const IconData warning = Icons.warning;
  static const IconData offline = Icons.wifi_off;
  static const IconData addressHome = Icons.home_outlined;
  static const IconData addressWork = Icons.work_outline;
  static const IconData addressOther = Icons.place_outlined;
  static const IconData delivered = Icons.task_alt;
  static const IconData outForDelivery = Icons.local_shipping_outlined;

  // State-view and badge glyphs (not part of the `distinct` set below).
  static const IconData empty = Icons.inbox_outlined;
  static const IconData error = Icons.error_outline;
  static const IconData notFound = Icons.search_off;
  static const IconData pending = Icons.schedule;
  static const IconData info = Icons.info_outline;

  // No-image fallback glyphs (not part of the `distinct` set below). These
  // are decoration inside the image well, never a label and never a control:
  // the product's real `category_name` picks one, and anything unrecognised
  // gets [product]. Nothing here is inferred about the product itself.
  static const IconData product = Icons.shopping_basket_outlined;
  static const IconData groupDairy = Icons.egg_outlined;
  static const IconData groupBakery = Icons.bakery_dining_outlined;
  static const IconData groupProduce = Icons.eco_outlined;
  static const IconData groupDrinks = Icons.local_drink_outlined;
  static const IconData groupSnacks = Icons.cookie_outlined;
  static const IconData groupMeat = Icons.set_meal_outlined;
  static const IconData groupPantry = Icons.rice_bowl_outlined;
  static const IconData groupHousehold = Icons.cleaning_services_outlined;
  static const IconData groupPersonalCare = Icons.spa_outlined;
  static const IconData groupBaby = Icons.child_friendly_outlined;
  static const IconData groupHealth = Icons.medical_services_outlined;

  // Account rows (not part of the `distinct` set below).
  static const IconData chevron = Icons.chevron_right;
  static const IconData share = Icons.share_outlined;
  static const IconData logout = Icons.logout;
  static const IconData dental = Icons.medical_services_outlined;
  static const IconData feedback = Icons.rate_review_outlined;
  // SMS & offers (Profile): the row, and the one-of-three language choice.
  static const IconData sms = Icons.sms_outlined;
  static const IconData choiceOn = Icons.radio_button_checked;
  static const IconData choiceOff = Icons.radio_button_unchecked;
  // "Notify me when it's back" on a sold-out product (phase 6).
  static const IconData notifyMe = Icons.notifications_none;
  static const IconData notifyMeOn = Icons.notifications_active_outlined;
  // Rating a finished dental visit: filled vs outline carries the meaning.
  static const IconData star = Icons.star_rounded;
  static const IconData starOutline = Icons.star_outline_rounded;
  // Category offers and combo packs (owner, 2026-10-09): the "10% off
  // everything here" banner and the combo pack fallback / cart line mark.
  static const IconData offer = Icons.local_offer_outlined;
  static const IconData combo = Icons.redeem_outlined;

  /// The icons that must read as different things from each other.
  static const List<IconData> distinct = <IconData>[
    shop,
    orders,
    addressBook,
    packed,
    cart,
    search,
    help,
    profile,
    back,
    close,
    check,
    warning,
    offline,
    addressHome,
    addressWork,
    addressOther,
    delivered,
    outForDelivery,
  ];
}
