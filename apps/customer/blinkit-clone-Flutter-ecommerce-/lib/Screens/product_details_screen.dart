import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:share_plus/share_plus.dart';

import '../Models/order_format.dart';
import '../Models/product_model.dart';
import '../Services/Providers/cart.provider.dart';
import '../Services/Providers/product.provider.dart';
import '../Services/app_errors.dart';
import '../Services/share_links.dart';
import '../UI/Widgets/Atoms/add_to_cart_button.dart';
import '../UI/Widgets/Atoms/app_skeleton.dart';
import '../UI/Widgets/Atoms/app_state_views.dart';
import '../UI/Widgets/Atoms/blynk_button.dart';
import '../UI/Widgets/Atoms/circular_icon_button.dart';
import '../UI/Widgets/Atoms/failure_states.dart';
import '../UI/Widgets/Atoms/image_well.dart';
import '../UI/Widgets/Atoms/money_text.dart';
import '../UI/Widgets/Atoms/notify_me_button.dart';
import '../UI/Widgets/Atoms/status_badge.dart';
import '../design/tokens.dart';
import 'package:ecom/UI/Widgets/Atoms/product_hero.dart';
import 'package:ecom/UI/Widgets/Atoms/card_product.dart';
import 'package:ecom/UI/Widgets/Atoms/blynk_crossfade.dart';

/// Full product page, opened from any ProductCard (Home, Categories,
/// Search). The tapped product renders immediately, then the page asks
/// the backend for that product by id so price and availability are the
/// current ones.
///
/// ## 2026-09 redesign (W3) — what carries this screen, and what is missing
///
/// ```
/// (o) back                              (o) share
///         LARGE IMAGE HERO          <- ProductImageWell, the centrepiece
/// Category                          <- real category_name
/// Product name                      <- display, the type hierarchy's anchor
/// Unit . Pack size
/// LKR 540        [ Available ]      <- real selling_price, real is_available
///                                      (on offer: offer price, struck regular
///                                      price, "Offer −12%", end date if any)
/// Product details (expandable)      <- only sections with real content
/// ------------------------------------
/// STICKY:   [      Add to cart      ]   flat signal, ink label
/// ```
///
/// **Deliberately absent, because the backend has no field for any of them:**
/// a rating, a review count, a per-unit ("per 100 g") price, nutrition, certification or trust badges and
/// a favourite/wishlist control (there is no wishlist module). None of them is
/// rendered as a placeholder, a zero or a "coming soon" — each is omitted
/// entirely. If `description` is null the About section does not render at
/// all. A struck regular price and an offer tag show only while the backend
/// reports a real offer (`offer_price`, owner 2026-10-09). The share action carries the product's **name** only: there is no
/// public product URL to link to, so none is invented.
///
/// The page therefore breathes more than a typical commerce detail page. That
/// is the correct outcome, not an unfinished one: the weight is carried by the
/// image, the type hierarchy and the whitespace rather than by invented
/// commerce chrome.
class ProductDetailsScreen extends StatefulWidget {
  const ProductDetailsScreen({
    super.key,
    required this.productId,
    this.initialProduct,
  });

  final String productId;

  /// The listing copy the customer tapped, shown while the fresh copy
  /// loads. Null when the page is opened by id alone.
  final ProductModel? initialProduct;

  @override
  State<ProductDetailsScreen> createState() => _ProductDetailsScreenState();
}

/// Two columns from here up; below it the page stacks like a phone.
const double _twoColumnBreakpoint = 720;

class _ProductDetailsScreenState extends State<ProductDetailsScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  void _load() {
    if (!mounted) return;
    context.read<ProductProvider>().loadProductDetail(widget.productId);
  }

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<ProductProvider>();
    final failure = provider.productDetailFailure(widget.productId);
    final product =
        provider.productDetail(widget.productId) ?? widget.initialProduct;
    final wide = MediaQuery.sizeOf(context).width >= _twoColumnBreakpoint;

    Widget body;
    Widget? bottomBar;
    // Nothing to share once the store says the product is gone.
    final shareable =
        failure == ProductDetailFailure.notFound ? null : product;

    if (failure == ProductDetailFailure.notFound) {
      // Removed or deactivated in the store - even if we have a listing
      // copy, it must not stay purchasable here.
      body = AppStateView(
        icon: BlynkIcons.packed,
        title: 'Product no longer available',
        message: 'This item has been removed from the store.',
        actionLabel: 'Go back',
        onAction: () => Navigator.of(context).maybePop(),
      );
    } else if (product == null) {
      body = failure == ProductDetailFailure.network
          ? FailureState(
              failure: provider.productDetailError(widget.productId) ?? AppErrors.unknown,
              title: "Couldn't load this product",
              scrollable: false,
              onRetry: _load,
            )
          : _DetailsSkeleton(wide: wide);
    } else {
      body = _DetailsBody(product: product, wide: wide);
      if (!wide) bottomBar = _BottomCtaBar(product: product);
    }

    return Scaffold(
      backgroundColor: BlynkColors.paper,
      appBar: AppBar(
        backgroundColor: BlynkColors.paper,
        surfaceTintColor: BlynkColors.clear,
        elevation: 0,
        scrolledUnderElevation: 0.5,
        automaticallyImplyLeading: false,
        leading: Navigator.of(context).canPop() ? const _CircularBack() : null,
        actions: [
          if (shareable != null) _ShareAction(product: shareable),
          const SizedBox(width: BlynkSpace.s4),
        ],
      ),
      // Skeleton, failure and the loaded body are distinct widget types, so
      // keying on the type crossfades exactly the state changes.
      body: BlynkCrossfade(
        child: KeyedSubtree(key: ValueKey<Type>(body.runtimeType), child: body),
      ),
      bottomNavigationBar: bottomBar,
    );
  }
}

/// The mock's circular chrome control, using the shared
/// [CircularIconButton]. It keeps the platform back tooltip so assistive
/// technology — and `WidgetTester.pageBack()` — still find it as the back
/// affordance rather than as an anonymous icon.
class _CircularBack extends StatelessWidget {
  const _CircularBack();

  /// Inside the AppBar's 56 dp leading slot; the tap target stays 48 dp.
  static const double _size = 40;

  @override
  Widget build(BuildContext context) {
    final label = MaterialLocalizations.of(context).backButtonTooltip;
    return Center(
      child: Tooltip(
        message: label,
        child: CircularIconButton(
          icon: BlynkIcons.back,
          size: _size,
          semanticLabel: label,
          onPressed: () => Navigator.of(context).maybePop(),
        ),
      ),
    );
  }
}

/// The mock's circular share control. It uses the `share_plus` capability the
/// app already ships (Profile's "Share the app"). It shares the product's real
/// name and, when the build knows the website's address, the product's link
/// (`/p/<id>`, see [ShareLinks]) - which opens this product in the app.
class _ShareAction extends StatelessWidget {
  const _ShareAction({required this.product});

  final ProductModel product;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: CircularIconButton(
        icon: BlynkIcons.share,
        size: _CircularBack._size,
        semanticLabel: 'Share this product',
        onPressed: () => Share.share(
          ShareLinks.productShareText(product.name, product.id),
          subject: product.name,
        ),
      ),
    );
  }
}

class _DetailsBody extends StatelessWidget {
  const _DetailsBody({required this.product, required this.wide});

  final ProductModel product;
  final bool wide;

  // Leaves room for the global floating cart bar when it slides in.
  static const double _floatingCartClearance = 96;

  /// The hero never takes more than this share of the viewport height, so the
  /// name and the price are still above the fold on a short phone.
  static const double _heroHeightShare = 0.48;

  /// The image column's share of a two-column layout.
  static const double _heroColumnShare = 0.45;

  /// Floor for the two-column hero, so it stays a hero on a short laptop.
  static const double _heroMinSide = 160;

  /// The content column's cap on a very wide desktop.
  static const double _wideContentCap = 1120;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final content = wide
            ? _wideLayout(context, constraints)
            : _narrowLayout(context, constraints);

        // 2026-09-24: a `BottomStickyContainer` (the global floating cart
        // bar) used to be Stack-ed over this body. It was the one screen
        // that already owns a bottom bar, so the two stacked — and because
        // the floating one overlays rather than occupying layout, it sat on
        // top of the "Product details" section instead of above it. The
        // View-cart action moved into [_BottomCtaBar], which is this
        // screen's single bottom bar. Every other pushed route still uses
        // BottomStickyContainer; they have no bar of their own.
        return content;
      },
    );
  }

  Widget _narrowLayout(BuildContext context, BoxConstraints constraints) {
    final gutter = BlynkSpace.gutterFor(constraints.maxWidth);
    // The card's shape, never so tall that the name and price fall below
    // the fold.
    final hero = ProductHero.detailSizeFor(
      constraints.maxWidth - gutter * 2,
      constraints.maxHeight * _heroHeightShare,
    );

    return ListView(
      padding: EdgeInsets.fromLTRB(
        gutter,
        BlynkSpace.s8,
        gutter,
        _floatingCartClearance,
      ),
      children: [
        // No entrance on the image: it arrives by the Hero flight, and an
        // extra scale/fade here kept moving it after the Hero landed.
        Center(
          child: SizedBox.fromSize(
            size: hero,
            child: _Hero(product: product),
          ),
        ),
        const SizedBox(height: BlynkSpace.s24),
        _Entrance(delay: 60, child: _ProductSummary(product: product)),
        _Entrance(delay: 100, child: _ProductSections(product: product)),
      ],
    );
  }

  Widget _wideLayout(BuildContext context, BoxConstraints constraints) {
    const hPad = BlynkSpace.s32;
    const vPad = BlynkSpace.s24;
    const gap = BlynkSpace.s48;
    final contentWidth =
        math.min(constraints.maxWidth, _wideContentCap) - hPad * 2;
    // Image column takes ~45%, capped so it never outgrows the viewport
    // height on a landscape laptop (1280 x 720).
    final hero = ProductHero.detailSizeFor(
      math.max(_heroMinSide, (contentWidth - gap) * _heroColumnShare),
      math.max(
        _heroMinSide * ProductCard.imageRatio,
        constraints.maxHeight - vPad * 2 - BlynkSpace.s16,
      ),
    );

    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(
        hPad,
        vPad,
        hPad,
        _floatingCartClearance,
      ),
      child: Center(
        child: ConstrainedBox(
          constraints: BoxConstraints(maxWidth: contentWidth),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              SizedBox.fromSize(
                size: hero,
                child: _Hero(product: product),
              ),
              const SizedBox(width: gap),
              Expanded(
                child: _Entrance(
                  delay: 60,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      _ProductSummary(product: product),
                      const SizedBox(height: BlynkSpace.s24),
                      ConstrainedBox(
                        constraints: const BoxConstraints(maxWidth: 360),
                        child: AddToCartButton(
                          product: product,
                          compact: false,
                          expanded: true,
                        ),
                      ),
                      const SizedBox(height: BlynkSpace.s8),
                      _CartFeedback(product: product),
                      _ProductSections(product: product),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// The image hero: the shared [ProductImageWell], so the branded no-image
/// fallback here is the same composition as on a 152 dp rail card and cannot
/// drift from it. 40 of the 41 live products have no photo, so this is the
/// screen's default appearance — it is sized generously and inset so the
/// fallback medallion reads as deliberate rather than as a missing picture.
class _Hero extends StatelessWidget {
  const _Hero({required this.product});

  final ProductModel product;

  @override
  Widget build(BuildContext context) {
    // The other end of the card's flight: same tag, the detail's own look.
    return ProductHero(
      productId: product.id,
      child: ProductImageWell(
        product: product,
        radius: BlynkRadius.lgAll,
        inset: BlynkSpace.s24,
        overlay: product.isAvailable ? null : const _UnavailableWash(),
      ),
    );
  }
}

/// The unavailable wash, on the card's own tokens so the two surfaces agree.
/// It carries no words: the availability badge below the price is what says
/// so, and it says it in one place.
class _UnavailableWash extends StatelessWidget {
  const _UnavailableWash();

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      color: BlynkCardProduct.unavailableWashColor
          .withValues(alpha: BlynkCardProduct.unavailableWashOpacity),
    );
  }
}

class _ProductSummary extends StatelessWidget {
  const _ProductSummary({required this.product});

  final ProductModel product;

  @override
  Widget build(BuildContext context) {
    final unitLine = [
      product.unit,
      if (product.packSize != null && product.packSize!.trim().isNotEmpty)
        product.packSize!,
    ].where((s) => s.trim().isNotEmpty).join(' · ');
    final onOffer = product.isOnOffer;
    final offerEndsAt = product.offerEndsAt;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (product.categoryName.isNotEmpty) ...[
          Text(
            product.categoryName,
            style: BlynkText.caption.copyWith(color: BlynkColors.ink2),
          ),
          const SizedBox(height: BlynkSpace.s8),
        ],
        Semantics(
          header: true,
          child: Text(product.name, style: BlynkText.display),
        ),
        if (unitLine.isNotEmpty) ...[
          const SizedBox(height: BlynkSpace.s4),
          Text(
            unitLine,
            style: BlynkText.body.copyWith(color: BlynkColors.ink2),
          ),
        ],
        const SizedBox(height: BlynkSpace.s24),
        // Wraps rather than clipping when the price grows at 2.0x text scale.
        Wrap(
          crossAxisAlignment: WrapCrossAlignment.center,
          spacing: BlynkSpace.s16,
          runSpacing: BlynkSpace.s12,
          children: [
            if (onOffer)
              // The offer price leads, the regular price sits struck beside
              // it (owner, 2026-10-09); together they wrap as one.
              Wrap(
                crossAxisAlignment: WrapCrossAlignment.center,
                spacing: BlynkSpace.s8,
                runSpacing: BlynkSpace.s4,
                children: [
                  SalePrice(product.effectivePrice, style: BlynkType.priceHero),
                  StruckPrice(
                    product.sellingPrice,
                    style: BlynkText.body.copyWith(color: BlynkColors.strike),
                  ),
                  SaveText(product.sellingPrice - product.effectivePrice),
                ],
              )
            else
              MoneyText(product.sellingPrice, style: BlynkType.priceHero),
            _AvailabilityBadge(isAvailable: product.isAvailable),
          ],
        ),
        if (onOffer && offerEndsAt != null) ...[
          const SizedBox(height: BlynkSpace.s8),
          Text(
            'Offer ends ${formatOrderTime(offerEndsAt)}',
            key: const Key('product-offer-ends'),
            style: BlynkText.caption.copyWith(color: BlynkColors.ink2),
          ),
        ],
        // Sold out: the customer can ask for one push when it is back.
        if (!product.isAvailable) ...[
          const SizedBox(height: BlynkSpace.s16),
          ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 360),
            child: NotifyMeButton(productId: product.id),
          ),
        ],
      ],
    );
  }
}

/// The real `is_available` flag and nothing else. Available is a genuine
/// positive state, so it is the one place green appears on this screen;
/// unavailable is neutral rather than red, because an out-of-stock item is
/// not an error.
class _AvailabilityBadge extends StatelessWidget {
  const _AvailabilityBadge({required this.isAvailable});

  final bool isAvailable;

  @override
  Widget build(BuildContext context) {
    return isAvailable
        ? const StatusBadge(
            tone: BadgeTone.positive,
            label: 'Available',
            icon: BlynkIcons.check,
          )
        : const StatusBadge(
            tone: BadgeTone.neutral,
            label: 'Currently unavailable',
          );
  }
}

/// Description (only when the backend has one) and the product's real
/// catalogue attributes. Nothing here is generated copy, and a section with
/// no real content is not rendered at all — there is no empty "Nutrition" or
/// "Certifications" block, because there is no such data.
///
/// Sections are separated by space, never by a rule.
class _ProductSections extends StatelessWidget {
  const _ProductSections({required this.product});

  final ProductModel product;

  @override
  Widget build(BuildContext context) {
    final description = product.description?.trim() ?? '';
    final rows = <MapEntry<String, String>>[
      if (product.unit.trim().isNotEmpty) MapEntry('Unit', product.unit),
      if (product.packSize != null && product.packSize!.trim().isNotEmpty)
        MapEntry('Pack', product.packSize!),
      if (product.categoryName.isNotEmpty)
        MapEntry('Category', product.categoryName),
    ];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (description.isNotEmpty) ...[
          const SizedBox(height: BlynkSpace.s32),
          _DetailSection(
            title: 'About this product',
            child: Text(description, style: BlynkText.body),
          ),
        ],
        if (rows.isNotEmpty) ...[
          const SizedBox(height: BlynkSpace.s24),
          _DetailSection(
            title: 'Product details',
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                for (final row in rows) _AttributeRow(row: row),
              ],
            ),
          ),
        ],
      ],
    );
  }
}

/// One catalogue attribute, label above value rather than in a fixed-width
/// column: a 96 dp label column clipped "Category" the moment the text scale
/// went past 1.3x.
class _AttributeRow extends StatelessWidget {
  const _AttributeRow({required this.row});

  final MapEntry<String, String> row;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: BlynkSpace.s16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(row.key, style: BlynkType.productUnit),
          const SizedBox(height: BlynkSpace.s4),
          Text(row.value, style: BlynkText.label),
        ],
      ),
    );
  }
}

/// An expandable section. It opens expanded: with at most three short
/// attribute rows behind it, a collapsed-by-default section would hide real
/// content behind a tap for no gain. The header is a header *and* a button to
/// assistive technology, and its target is the shared 48 dp floor.
class _DetailSection extends StatefulWidget {
  const _DetailSection({required this.title, required this.child});

  final String title;
  final Widget child;

  @override
  State<_DetailSection> createState() => _DetailSectionState();
}

class _DetailSectionState extends State<_DetailSection> {
  bool _expanded = true;

  void _toggle() => setState(() => _expanded = !_expanded);

  @override
  Widget build(BuildContext context) {
    final duration = BlynkMotion.resolve(context, BlynkMotion.base);
    final body = Padding(
      padding: const EdgeInsets.only(top: BlynkSpace.s12),
      child: widget.child,
    );

    // AnimatedSize rather than AnimatedCrossFade: the latter keeps the hidden
    // child in the tree, so a "collapsed" section would still be there to be
    // read. This one genuinely removes it. (AnimatedSize asserts on a zero
    // duration, hence the reduced-motion branch.)
    final Widget reveal;
    if (duration == Duration.zero) {
      reveal = _expanded ? body : const SizedBox.shrink();
    } else {
      reveal = AnimatedSize(
        duration: duration,
        curve: BlynkMotion.easeOut,
        alignment: Alignment.topLeft,
        child: _expanded ? body : const SizedBox(width: double.infinity),
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Semantics(
          header: true,
          button: true,
          expanded: _expanded,
          label: widget.title,
          onTap: _toggle,
          excludeSemantics: true,
          child: InkWell(
            onTap: _toggle,
            child: ConstrainedBox(
              constraints:
                  const BoxConstraints(minHeight: BlynkControl.minHeight),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      widget.title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: BlynkText.sectionHeader,
                    ),
                  ),
                  AnimatedRotation(
                    turns: _expanded ? 0.5 : 0,
                    duration: duration,
                    child: const Icon(
                      Icons.keyboard_arrow_down,
                      size: BlynkIcons.md,
                      color: BlynkColors.ink2,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
        reveal,
      ],
    );
  }
}

/// "2 in cart" once the product is in the cart - the confirmation that the
/// tap landed, driven by CartProvider rather than a one-off toast.
class _CartFeedback extends StatelessWidget {
  const _CartFeedback({required this.product});

  final ProductModel product;

  @override
  Widget build(BuildContext context) {
    final quantity = context.select<CartProvider, int>(
      (cart) => cart.quantityOf(product.id),
    );

    return AnimatedSwitcher(
      duration: BlynkMotion.resolve(context, BlynkMotion.base),
      // The outgoing label drops out at once so the two never overlap.
      switchOutCurve: const Threshold(1),
      transitionBuilder: (child, animation) => FadeTransition(
        opacity: animation,
        child: SizeTransition(sizeFactor: animation, child: child),
      ),
      child: quantity > 0
          ? Padding(
              key: const ValueKey('in-cart'),
              padding: const EdgeInsets.only(bottom: BlynkSpace.s8),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(
                    BlynkIcons.check,
                    size: BlynkIcons.xs,
                    color: BlynkColors.positive,
                  ),
                  const SizedBox(width: BlynkSpace.s4),
                  Flexible(
                    child: Text(
                      '$quantity in cart',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: BlynkText.microLabel
                          .copyWith(color: BlynkColors.positiveInk),
                    ),
                  ),
                ],
              ),
            )
          : const SizedBox(key: ValueKey('empty')),
    );
  }
}

/// The sticky phone CTA, pinned under the content
/// (`Scaffold.bottomNavigationBar`) so it sits inside the safe area and the
/// global floating cart stacks above it rather than on top of it.
///
/// It is the screen's **one** yellow action: a flat [BlynkCta.fill] surface
/// with an ink label, full width, no gradient. The price is not repeated here
/// — it is stated once, in the summary, at hero size.
class _BottomCtaBar extends StatelessWidget {
  const _BottomCtaBar({required this.product});

  final ProductModel product;

  @override
  Widget build(BuildContext context) {
    return _Entrance(
      slideFrom: 24,
      child: DecoratedBox(
        decoration: const BoxDecoration(
          color: BlynkColors.paper,
          border: Border(top: BorderSide(color: BlynkColors.line)),
        ),
        child: SafeArea(
          top: false,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(
              BlynkSpace.s16,
              BlynkSpace.s12,
              BlynkSpace.s16,
              BlynkSpace.s12,
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Align(
                  alignment: Alignment.centerLeft,
                  child: _CartFeedback(product: product),
                ),
                _CtaRow(product: product),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// The bottom bar's action row. With an empty cart it is the full-width
/// add-to-cart control and nothing else — the screen's one job. The moment
/// the cart holds anything it splits: the add/stepper control keeps the
/// yellow and the left, and a **secondary** (outlined) "View cart" takes the
/// right.
///
/// "View cart" is deliberately *not* a second yellow. The add control is
/// already this screen's signal-yellow moment, and two yellow actions in one
/// bar leave no primary. This is also why the global floating cart bar — a
/// whole second bar, ink, with its own yellow pill — no longer overlays this
/// screen: one bar, one primary.
class _CtaRow extends StatelessWidget {
  const _CtaRow({required this.product});

  final ProductModel product;

  /// Matches `AddToCartButton`'s expanded height so the two sit level.
  static const double _height = 52;

  @override
  Widget build(BuildContext context) {
    final hasCart = context.select<CartProvider, bool>((cart) => cart.itemCount > 0);

    final add = AddToCartButton(
      product: product,
      compact: false,
      expanded: true,
    );
    if (!hasCart) return add;

    return Row(
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        Expanded(child: add),
        const SizedBox(width: BlynkSpace.s12),
        Expanded(
          child: SizedBox(
            height: _height,
            child: BlynkButton.secondary(
              label: 'View cart',
              expand: true,
              onPressed: () => Navigator.of(context).pushNamed('/cart'),
            ),
          ),
        ),
      ],
    );
  }
}

/// One-shot entrance: fade plus a small slide or scale. Plays when the
/// widget first mounts (content replacing the skeleton), never on rebuilds,
/// and not at all when the platform asks for reduced motion.
class _Entrance extends StatelessWidget {
  const _Entrance({
    required this.child,
    this.delay = 0,
    this.slideFrom = 12,
  });

  final Widget child;
  final int delay;
  final double slideFrom;

  @override
  Widget build(BuildContext context) {
    if (BlynkMotion.resolve(context, BlynkMotion.base) == Duration.zero) {
      return child;
    }
    final total = BlynkMotion.slow.inMilliseconds + delay;
    return TweenAnimationBuilder<double>(
      tween: Tween(begin: 0, end: 1),
      duration: Duration(milliseconds: total),
      curve: Interval(delay / total, 1, curve: BlynkMotion.easeOut),
      child: child,
      builder: (context, t, child) => Opacity(
        opacity: t,
        child: Transform.translate(
          offset: Offset(0, (1 - t) * slideFrom),
          child: child,
        ),
      ),
    );
  }
}

/// The loading state, laid out like the loaded page: a square hero, then the
/// eyebrow / name / unit / price / badge stack, then the CTA. One shared pulse
/// drives every block.
class _DetailsSkeleton extends StatelessWidget {
  const _DetailsSkeleton({required this.wide});

  final bool wide;

  static const Widget _info = Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      AppSkeleton(width: 90, height: 12),
      SizedBox(height: BlynkSpace.s8),
      AppSkeleton(height: 28),
      SizedBox(height: BlynkSpace.s8),
      AppSkeleton(width: 180, height: 28),
      SizedBox(height: BlynkSpace.s12),
      AppSkeleton(width: 120, height: 16),
      SizedBox(height: BlynkSpace.s24),
      AppSkeleton(width: 140, height: 32),
      SizedBox(height: BlynkSpace.s32),
      AppSkeleton(height: 52, radius: BlynkRadius.lg),
    ],
  );

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: 'Loading product',
      child: SkeletonScope.ensure(
        child: LayoutBuilder(
          builder: (context, constraints) {
            if (!wide) {
              final gutter = BlynkSpace.gutterFor(constraints.maxWidth);
              final hero = ProductHero.detailSizeFor(
                constraints.maxWidth - gutter * 2,
                constraints.maxHeight * _DetailsBody._heroHeightShare,
              );
              return ListView(
                padding: EdgeInsets.fromLTRB(
                  gutter,
                  BlynkSpace.s8,
                  gutter,
                  BlynkSpace.s48,
                ),
                physics: const NeverScrollableScrollPhysics(),
                children: [
                  Center(
                    child: AppSkeleton(
                      width: hero.width,
                      height: hero.height,
                      radius: BlynkRadius.lg,
                    ),
                  ),
                  const SizedBox(height: BlynkSpace.s24),
                  _info,
                ],
              );
            }
            final width = math.min(
                  constraints.maxWidth,
                  _DetailsBody._wideContentCap,
                ) -
                BlynkSpace.s32 * 2;
            final hero = ProductHero.detailSizeFor(
              math.max(
                _DetailsBody._heroMinSide,
                (width - BlynkSpace.s48) * _DetailsBody._heroColumnShare,
              ),
              math.max(
                _DetailsBody._heroMinSide * ProductCard.imageRatio,
                constraints.maxHeight - BlynkSpace.s24 * 2 - BlynkSpace.s16,
              ),
            );
            return Padding(
              padding: const EdgeInsets.symmetric(
                horizontal: BlynkSpace.s32,
                vertical: BlynkSpace.s24,
              ),
              child: Align(
                alignment: Alignment.topCenter,
                child: SizedBox(
                  width: width,
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      AppSkeleton(
                        width: hero.width,
                        height: hero.height,
                        radius: BlynkRadius.lg,
                      ),
                      const SizedBox(width: BlynkSpace.s48),
                      const Expanded(child: _info),
                    ],
                  ),
                ),
              ),
            );
          },
        ),
      ),
    );
  }
}
