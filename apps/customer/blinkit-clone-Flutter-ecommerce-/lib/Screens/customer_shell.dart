import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../Models/order_model.dart';
import '../Services/Providers/auth.provider.dart';
import '../Services/Providers/order.provider.dart';
import '../Services/Providers/product.provider.dart';
import '../Services/catalog_live_updates.dart';
import '../UI/Widgets/Organisms/adaptive_scaffold.dart';
import '../UI/Widgets/Organisms/cart_bar.dart';
import '../UI/Widgets/Atoms/snackbar_helper.dart';
import '../design/tokens.dart';
import 'help_screen.dart';
import 'home_screen.dart';
import 'profile_screen.dart';
import 'user_orders_screen.dart';

/// Persistent shell for the four top-level customer destinations. Each tab
/// keeps its own state (scroll position, loaded data) via IndexedStack, so
/// switching tabs doesn't lose where you were.
///
/// Because Home is never rebuilt, the shell is also where the catalog is
/// re-validated: coming back to the Shop tab and bringing the app back to
/// the foreground both ask ProductProvider to refresh, so edits made in the
/// Admin app reach a customer who already has the app open.
///
/// Navigation is an [AdaptiveScaffold] (bottom bar, rail or extended rail by
/// width) and the one cart bar lives here, above the four tabs. Back on
/// Orders, Help or Profile returns to Shop; back on Shop leaves the app.
///
/// Detail screens (product list, cart, order detail, address form) are still
/// pushed on top of this shell as full routes, which is why they keep their
/// own back buttons.
class CustomerShell extends StatefulWidget {
  /// How long the "Press back again to exit" second press is accepted.
  static const Duration exitWindow = Duration(seconds: 2);
  static const String exitHint = 'Press back again to exit';

  const CustomerShell({
    super.key,
    this.initialTab = 0,
    this.tabs,
    this.catalogEvents,
  });

  final int initialTab;

  /// Opens the live catalog event stream. Null: the real
  /// `GET /catalog/events` (none at all under `flutter test`).
  @visibleForTesting
  final Stream<String> Function()? catalogEvents;

  /// Replaces the four destinations; tests use it to exercise the shell's
  /// own behaviour without mounting every screen and its providers.
  @visibleForTesting
  final List<Widget>? tabs;

  // Lets a pushed route (e.g. the empty cart) or another tab send the
  // customer to a tab of the shell that's already underneath it.
  static final _TabRequests _tabRequests = _TabRequests();

  /// Returns to the existing shell's Shop tab, or starts a fresh shell if
  /// this navigation stack doesn't have one (e.g. a deep-linked route).
  static void openShop(BuildContext context) => selectTab(context, 0);

  /// Shows tab [index] (0 Shop, 1 Orders, 2 Help, 3 Profile) of the existing
  /// shell, closing anything pushed above it; starts a shell on that tab if
  /// this navigation stack doesn't have one.
  static void selectTab(BuildContext context, int index) {
    final navigator = Navigator.of(context);
    var hasShell = false;
    navigator.popUntil((route) {
      if (route.settings.name == '/home') hasShell = true;
      return route.settings.name == '/home' || route.isFirst;
    });
    if (hasShell) {
      _tabRequests.request(index);
    } else {
      navigator.pushNamedAndRemoveUntil('/home', (_) => false, arguments: index);
    }
  }

  @override
  State<CustomerShell> createState() => _CustomerShellState();
}

class _TabRequests extends ChangeNotifier {
  int index = 0;

  void request(int tab) {
    index = tab;
    notifyListeners();
  }
}

class _CustomerShellState extends State<CustomerShell>
    with WidgetsBindingObserver {
  late int _index = widget.initialTab;

  /// Back on Shop (owner, 2026-10-07: "back exits the app"): the first press
  /// says "Press back again to exit" and arms [CustomerShell.exitWindow]; a
  /// second press inside it leaves. Armed means canPop, so Android's
  /// predictive back still sees the truth.
  bool _exitArmed = false;
  Timer? _exitTimer;

  @override
  void initState() {
    super.initState();
    CustomerShell._tabRequests.addListener(_onTabRequest);
    WidgetsBinding.instance.addObserver(this);
    _startLiveRefresh();
    final open = widget.catalogEvents ??
        (catalogLiveUpdatesSupported ? openCatalogEvents : null);
    if (open != null) {
      _live = CatalogLiveUpdates(
        open: open,
        // Forced: the server says something changed, so the throttle that
        // guards against focus flicker must not swallow it.
        onChange: () {
          if (mounted) context.read<ProductProvider>().refreshCatalog(force: true);
        },
      )..start();
    }
  }

  /// Pushed catalog changes from the backend - the fast path. The periodic
  /// [_liveRefresh] below is the safety net if the stream cannot be held.
  CatalogLiveUpdates? _live;

  /// Re-reads the catalog every [ProductProvider.liveRefreshEvery] while the
  /// app is in the foreground, so Ops changes appear without the customer
  /// doing anything. Stopped in the background; restarted on resume.
  Timer? _liveRefresh;

  void _startLiveRefresh() {
    _liveRefresh?.cancel();
    _liveRefresh = Timer.periodic(ProductProvider.liveRefreshEvery, (_) {
      if (mounted) _refreshCatalog();
    });
  }

  @override
  void dispose() {
    _exitTimer?.cancel();
    _liveRefresh?.cancel();
    _live?.stop();
    WidgetsBinding.instance.removeObserver(this);
    CustomerShell._tabRequests.removeListener(_onTabRequest);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _refreshCatalog();
      _startLiveRefresh();
      _live?.start();
    } else if (state == AppLifecycleState.paused ||
        state == AppLifecycleState.hidden) {
      _liveRefresh?.cancel();
      _live?.stop();
    }
  }

  // Unforced: ProductProvider skips it if the catalog was refreshed a
  // moment ago, so window focus flicker doesn't turn into polling.
  void _refreshCatalog() => context.read<ProductProvider>().refreshCatalog();

  // Orders change on the server (a new order, a status move) while another tab
  // is showing: selecting the tab asks again, unless a load just happened. A
  // guest has no orders, so no request is made for them.
  void _refreshOrders() {
    if (!context.read<AuthProvider>().isAuthenticated) return;
    context.read<OrderProvider>().refreshOrders();
  }

  void _selectTab(int index) {
    if (index == 0 && _index != 0) _refreshCatalog();
    if (index == 1 && _index != 1) _refreshOrders();
    setState(() => _index = index);
  }

  void _onTabRequest() {
    if (mounted) _selectTab(CustomerShell._tabRequests.index);
  }

  static const _tabs = [
    HomeScreen(),
    OrdersScreen(),
    HelpScreen(),
    ProfileScreen(),
  ];

  // Delivered, cancelled and failed orders are finished; anything else
  // (including a problem that needs the customer) is still open.
  static bool _isOpen(OrderModel o) =>
      o.status != OrderStatus.delivered &&
      o.status != OrderStatus.cancelled &&
      o.status != OrderStatus.failed &&
      o.status != OrderStatus.unknown;

  @override
  Widget build(BuildContext context) {
    // Only the orders already in memory: the badge never triggers a fetch.
    final hasOpenOrder = context.select<OrderProvider, bool>((p) => p.orders.any(_isOpen));

    return PopScope(
      canPop: _index == 0 && _exitArmed,
      onPopInvokedWithResult: (didPop, _) {
        if (didPop) return;
        if (_index != 0) {
          _selectTab(0);
          return;
        }
        setState(() => _exitArmed = true);
        _exitTimer?.cancel();
        _exitTimer = Timer(CustomerShell.exitWindow, () {
          if (mounted) setState(() => _exitArmed = false);
        });
        showBlynkSnackBar(context: context, message: CustomerShell.exitHint);
      },
      child: AdaptiveScaffold(
        selectedIndex: _index,
        onSelected: _selectTab,
        destinations: [
          const AdaptiveDestination(
            icon: BlynkIcons.shop,
            selectedIcon: BlynkIcons.shopSelected,
            label: 'Shop',
          ),
          AdaptiveDestination(
            icon: BlynkIcons.orders,
            selectedIcon: BlynkIcons.ordersSelected,
            label: 'Orders',
            hasBadge: hasOpenOrder,
            badgeDescription: 'order in progress',
          ),
          const AdaptiveDestination(
            icon: BlynkIcons.help,
            selectedIcon: BlynkIcons.helpSelected,
            label: 'Help',
          ),
          const AdaptiveDestination(
            icon: BlynkIcons.profile,
            selectedIcon: BlynkIcons.profileSelected,
            label: 'Profile',
          ),
        ],
        body: IndexedStack(index: _index, children: widget.tabs ?? _tabs),
        cartBar: const CartBar(),
      ),
    );
  }
}
