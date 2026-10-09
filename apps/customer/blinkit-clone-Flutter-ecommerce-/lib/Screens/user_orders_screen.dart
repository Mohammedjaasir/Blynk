import 'package:ecom/Services/reorder.dart';
import 'package:ecom/UI/Widgets/Organisms/order_again_button.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'package:ecom/app_colors.dart';
import 'package:ecom/app_design.dart' show appCardDecoration, AppRadius;
import '../Models/order_format.dart';
import '../Models/order_model.dart';
import '../Models/order_status_labels.dart';
import '../Services/Providers/auth.provider.dart';
import '../Services/Providers/order.provider.dart';
import '../Services/store_info.dart';
import '../UI/Widgets/Atoms/app_skeleton.dart';
import '../UI/Widgets/Atoms/app_state_views.dart';
import '../UI/Widgets/Atoms/blynk_spinner.dart';
import '../UI/Widgets/Atoms/failure_states.dart';
import '../UI/Widgets/Atoms/image_well.dart';
import '../UI/Widgets/Atoms/money_text.dart';
import '../UI/Widgets/Atoms/status_badge.dart';
import '../app_responsive.dart';
import '../design/tokens.dart';

/// How close to the end of the list (in pixels) a scroll has to get before
/// the next page is requested.
const double _loadMoreThreshold = 200;

class OrdersScreen extends StatefulWidget {
  const OrdersScreen({super.key});

  @override
  State<OrdersScreen> createState() => _OrdersScreenState();
}

class _OrdersScreenState extends State<OrdersScreen> with WidgetsBindingObserver {
  bool? _wasAuthenticated;

  // Orders are an account endpoint: a browsing guest never triggers the
  // request (and so never sees a 401), and gets a log-in prompt instead.
  bool get _isAuthenticated => context.read<AuthProvider>().isAuthenticated;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted && _isAuthenticated) context.read<OrderProvider>().refreshOrders(force: true);
    });
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    // Signed in while this tab is already showing: load their orders now.
    final signedIn = context.watch<AuthProvider>().isAuthenticated;
    if (signedIn && _wasAuthenticated == false) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) context.read<OrderProvider>().refreshOrders(force: true);
      });
    }
    _wasAuthenticated = signedIn;
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // The list can go stale while the app is backgrounded (an order moves
    // on, a new one arrives) - coming back to the foreground is the moment
    // to ask again, same as the order detail screen. Always refetches page
    // 1, which is fine: that is also what pull-to-refresh does.
    if (state == AppLifecycleState.resumed && _isAuthenticated) {
      context.read<OrderProvider>().loadOrders();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.greyWhiteColor,
      appBar: AppBar(
        automaticallyImplyLeading: true,
        title: const Text("Your orders"),
      ),
      body: !context.watch<AuthProvider>().isAuthenticated
          ? AppStateView.empty(
              title: 'Log in to see your orders',
              message: 'Your past and current orders appear here.',
              actionLabel: 'Log in',
              onAction: () => Navigator.of(context).pushNamed('/login'),
            )
          : ContentFrame(
        maxWidth: 720,
        gutter: false,
        child: Consumer<OrderProvider>(
        builder: (context, orderProvider, _) {
          final orders = orderProvider.orders;
          // Only the very first load (nothing on screen yet) shows a
          // full-screen spinner - a pull-to-refresh with orders already
          // shown keeps the list visible instead of replacing it.
          final isInitialLoading = orderProvider.isLoadingOrders && orders.isEmpty;
          final failure = orderProvider.ordersFailure;
          final hasError = !isInitialLoading && failure != null && orders.isEmpty;
          final isEmpty = !isInitialLoading && !hasError && orders.isEmpty;
          final showsList = !isInitialLoading && !hasError && !isEmpty;

          // A refresh that fails with orders already on screen must not go
          // silent: the list stays (it is real, just possibly stale) and
          // the failure is said out loud above it, as the first list item -
          // same pattern as order_summary_screen's _RefreshFailedNotice.
          final showsRefreshFailedNotice = showsList && failure != null;
          final noticeOffset = showsRefreshFailedNotice ? 1 : 0;

          final itemCount = showsList ? orders.length + 1 + noticeOffset : 1;

          return NotificationListener<ScrollNotification>(
            onNotification: (notification) {
              if (showsList &&
                  orderProvider.hasMoreOrders &&
                  !orderProvider.isLoadingMore &&
                  notification.metrics.maxScrollExtent - notification.metrics.pixels <=
                      _loadMoreThreshold) {
                orderProvider.loadMoreOrders();
              }
              return false;
            },
            child: RefreshIndicator(
              onRefresh: orderProvider.loadOrders,
              child: ListView.builder(
                physics: const AlwaysScrollableScrollPhysics(),
                itemCount: itemCount,
                itemBuilder: (context, index) {
                  if (isInitialLoading) {
                    // W9: skeleton rows, not a centred spinner. Every other
                    // list in the app (addresses, clinics, appointments) loads
                    // with `ListRowSkeleton` - whose own doc names orders
                    // first - and holds the shape the real rows will take.
                    // Orders was the one list that blanked to a spinner.
                    //
                    // The skeleton is decoration to an assistive technology,
                    // so the whole block carries the announcement the spinner
                    // used to make as visible text - as a live region, the
                    // way `AppStateView` announces its error and offline
                    // states.
                    return Semantics(
                      label: 'Loading your orders',
                      liveRegion: true,
                      container: true,
                      excludeSemantics: true,
                      child: const SkeletonScope(
                        child: Column(
                          children: [
                            ListRowSkeleton(),
                            ListRowSkeleton(),
                            ListRowSkeleton(),
                          ],
                        ),
                      ),
                    );
                  }
                  if (hasError) {
                    return FailureState(
                      failure: failure,
                      title: "Couldn't load your orders.",
                      retryKey: const Key('orders-retry'),
                      onRetry: orderProvider.loadOrders,
                    );
                  }
                  if (isEmpty) {
                    return const PullableState(
                      child: AppStateView.empty(
                        title: "You haven't placed any orders yet.",
                        message: 'Everything you order appears here, with its status.',
                      ),
                    );
                  }
                  if (showsRefreshFailedNotice && index == 0) {
                    return RefreshFailedNotice(
                      key: const Key('orders-refresh-failed'),
                      message: "Couldn't refresh your orders. Pull down to try again.",
                      offline: failure.isOffline,
                    );
                  }
                  final listIndex = index - noticeOffset;
                  if (listIndex == orders.length) {
                    return _ListFooter(provider: orderProvider);
                  }
                  return _OrderRow(order: orders[listIndex]);
                },
              ),
            ),
          );
        },
      ),
      ),
    );
  }
}

class _ListFooter extends StatelessWidget {
  const _ListFooter({required this.provider});

  final OrderProvider provider;

  @override
  Widget build(BuildContext context) {
    if (provider.isLoadingMore) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: BlynkSpace.s16),
        child: Center(child: BlynkSpinner(size: BlynkIcons.md, strokeWidth: 2.5)),
      );
    }
    if (provider.loadMoreError != null) {
      return Semantics(
        button: true,
        label: 'Retry loading more orders',
        excludeSemantics: true,
        onTap: provider.loadMoreOrders,
        child: InkWell(
          onTap: provider.loadMoreOrders,
          child: Container(
            constraints: const BoxConstraints(minHeight: BlynkControl.minHeight),
            alignment: Alignment.center,
            padding: const EdgeInsets.symmetric(vertical: BlynkSpace.s16, horizontal: BlynkSpace.s16),
            child: Text(
              "Couldn't load more orders. Tap to retry.",
              textAlign: TextAlign.center,
              style: BlynkText.caption.copyWith(color: BlynkColors.ink3),
            ),
          ),
        ),
      );
    }
    return const SizedBox(height: BlynkSpace.s16);
  }
}

/// The orders list uses the shared [StatusBadge] rather than a second status
/// system, so an order reads the same here as anywhere else in the app. The
/// tone comes from the backend's own status through [orderStatusTone]; the
/// glyph is the same one [orderStatusIcon] already pairs with that status, so
/// colour is never the only signal and no new status wording is invented.
BadgeTone badgeToneFor(OrderTone tone) {
  switch (tone) {
    case OrderTone.success:
      return BadgeTone.positive;
    case OrderTone.problem:
      return BadgeTone.problem;
    case OrderTone.active:
      return BadgeTone.notice;
    case OrderTone.neutral:
      return BadgeTone.neutral;
  }
}

/// One order as an identity block rather than a table row: a thumbnail well,
/// the order number, the real status as a [StatusBadge], what was in it, when
/// it was placed and what it cost.
///
/// Every value comes from the list payload the backend already sends. There is
/// no ETA, no delivery estimate, no rider and no progress state beyond the
/// status the backend recorded. Order items carry no image field, so the
/// thumbnail is the shared no-image well — the app's default product
/// appearance — and never a fabricated picture.
class _OrderRow extends StatelessWidget {
  const _OrderRow({required this.order});

  final OrderModel order;

  static const double _thumb = 56;

  @override
  Widget build(BuildContext context) {
    // A combo pack is named once, not product by product (owner, 2026-10-09).
    final names = order.lineNames;
    final shownNames = names.take(2).join(', ');
    final remaining = names.length - 2;
    final namesLine = remaining > 0 ? '$shownNames +$remaining more' : shownNames;

    final itemQty = order.items.fold<int>(0, (sum, i) => sum + i.quantity);
    final paymentLabel = order.paymentMethod == 'COD' ? StoreInfo.paymentMethodLabel : order.paymentMethod;
    final total = formatLkr(order.totalAmount);
    final statusLabel = orderStatusLabel(order.status);

    // A finished order (delivered / cancelled) is reference, not news: it
    // keeps every word, at a quieter weight of ink, so a live order is the
    // one the eye lands on first.
    final tone = orderStatusTone(order.status);
    final isClosed = tone == OrderTone.success || tone == OrderTone.neutral;
    final bodyColor = isClosed ? BlynkColors.ink2 : BlynkColors.ink;
    final metaStyle = BlynkText.caption.copyWith(color: BlynkColors.ink2);

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: BlynkSpace.s16, vertical: BlynkSpace.s8),
      child: DecoratedBox(
        // The app's one card recipe (paper, radius 16, soft elevation, an
        // outside hairline that takes no layout space) rather than a second
        // one invented here.
        decoration: appCardDecoration(),
        child: Material(
          color: BlynkColors.clear,
          borderRadius: AppRadius.cardBorder,
          clipBehavior: Clip.antiAlias,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // The card reads as one button; "Order again" sits outside it
              // so screen readers reach it as its own button.
              Semantics(
            button: true,
            label: '${order.orderNumber}, $statusLabel, $total',
            excludeSemantics: true,
            child: InkWell(
              onTap: () => Navigator.of(context).pushNamed('/order', arguments: order.id),
              child: Container(
                constraints: const BoxConstraints(minHeight: BlynkControl.minHeight),
                padding: const EdgeInsets.all(BlynkSpace.s16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        // Order items carry no image on the backend, so this is
                        // the shared no-image well at the card's own radius:
                        // identical geometry to a real photo, decorative only.
                        const SizedBox(
                          width: _thumb,
                          height: _thumb,
                          child: BlynkImageWell(glyph: BlynkIcons.product),
                        ),
                        const SizedBox(width: BlynkSpace.s12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              // Wrap (not Row+Spacer) so a long status label on
                              // a narrow screen drops the badge to its own line
                              // instead of overflowing - neither the order
                              // number nor the badge text gets squeezed.
                              Wrap(
                                alignment: WrapAlignment.spaceBetween,
                                crossAxisAlignment: WrapCrossAlignment.center,
                                spacing: BlynkSpace.s8,
                                runSpacing: BlynkSpace.s4,
                                children: [
                                  Text(order.orderNumber, style: BlynkText.label.copyWith(color: bodyColor)),
                                  StatusBadge(
                                    tone: badgeToneFor(tone),
                                    label: statusLabel,
                                    icon: orderStatusIcon(order.status),
                                  ),
                                ],
                              ),
                              if (namesLine.isNotEmpty) ...[
                                const SizedBox(height: BlynkSpace.s4),
                                Text(
                                  namesLine,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: BlynkText.caption.copyWith(color: bodyColor),
                                ),
                              ],
                            ],
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: BlynkSpace.s12),
                    // Wrap, like the number+badge row above: every fact keeps
                    // its intrinsic width, so nothing is force-split by a flex
                    // share, and at 360px it is the timestamp that drops to a
                    // second line rather than any label losing its tail.
                    Wrap(
                      crossAxisAlignment: WrapCrossAlignment.center,
                      spacing: BlynkSpace.s4,
                      runSpacing: BlynkSpace.s4,
                      children: [
                        Text(
                          '$itemQty ${itemQty == 1 ? 'item' : 'items'} · $paymentLabel',
                          style: metaStyle,
                        ),
                        if (order.placedAt != null) ...[
                          Text('·', style: metaStyle),
                          Text(formatOrderTime(order.placedAt!), style: metaStyle),
                        ],
                      ],
                    ),
                    if (order.showsScheduleNotice) ...[
                      const SizedBox(height: BlynkSpace.s4),
                      Row(
                        children: [
                          const Icon(Icons.schedule, size: BlynkIcons.xs, color: BlynkColors.ink2),
                          const SizedBox(width: BlynkSpace.s4),
                          Expanded(
                            child: Text(
                              'Scheduled · ${formatScheduled(order.scheduledFor!)}',
                              overflow: TextOverflow.ellipsis,
                              style: BlynkText.caption.copyWith(color: BlynkColors.ink2),
                            ),
                          ),
                        ],
                      ),
                    ],
                    const SizedBox(height: BlynkSpace.s12),
                    MoneyText(
                      order.totalAmount,
                      style: BlynkText.price.copyWith(color: bodyColor),
                    ),
                  ],
                ),
              ),
            ),
              ),
              if (canReorder(order))
                Padding(
                  padding: const EdgeInsets.fromLTRB(BlynkSpace.s16, 0, BlynkSpace.s16, BlynkSpace.s16),
                  child: Align(
                    alignment: Alignment.centerLeft,
                    child: OrderAgainButton(order: order, compact: true),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
