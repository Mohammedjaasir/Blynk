import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../Services/Providers/cart.provider.dart';
import '../Services/Providers/product.provider.dart';
import '../app_colors.dart';
import '../app_design.dart';
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
/// Detail screens (product list, cart, order detail, address form) are still
/// pushed on top of this shell as full routes, which is why they keep their
/// own back buttons.
class CustomerShell extends StatefulWidget {
  const CustomerShell({super.key, this.initialTab = 0, this.tabs});

  final int initialTab;

  /// Replaces the four destinations; tests use it to exercise the shell's
  /// own behaviour without mounting every screen and its providers.
  @visibleForTesting
  final List<Widget>? tabs;

  // Lets a pushed route (e.g. the empty cart) send the customer back to the
  // Shop tab of the shell that's already underneath it.
  static final _ShopTabRequests _tabRequests = _ShopTabRequests();

  /// Returns to the existing shell's Shop tab, or starts a fresh shell if
  /// this navigation stack doesn't have one (e.g. a deep-linked route).
  static void openShop(BuildContext context) {
    final navigator = Navigator.of(context);
    var hasShell = false;
    navigator.popUntil((route) {
      if (route.settings.name == '/home') hasShell = true;
      return route.settings.name == '/home' || route.isFirst;
    });
    if (hasShell) {
      _tabRequests.request();
    } else {
      navigator.pushNamedAndRemoveUntil('/home', (_) => false);
    }
  }

  @override
  State<CustomerShell> createState() => _CustomerShellState();
}

class _ShopTabRequests extends ChangeNotifier {
  void request() => notifyListeners();
}

class _CustomerShellState extends State<CustomerShell>
    with WidgetsBindingObserver {
  late int _index = widget.initialTab;

  @override
  void initState() {
    super.initState();
    CustomerShell._tabRequests.addListener(_onTabRequest);
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    CustomerShell._tabRequests.removeListener(_onTabRequest);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _refreshCatalog();
  }

  // Unforced: ProductProvider skips it if the catalog was refreshed a
  // moment ago, so window focus flicker doesn't turn into polling.
  void _refreshCatalog() => context.read<ProductProvider>().refreshCatalog();

  void _selectTab(int index) {
    if (index == 0 && _index != 0) _refreshCatalog();
    setState(() => _index = index);
  }

  void _onTabRequest() {
    if (mounted) _selectTab(0);
  }

  static const _tabs = [
    HomeScreen(),
    OrdersScreen(),
    HelpScreen(),
    ProfileScreen(),
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: IndexedStack(index: _index, children: widget.tabs ?? _tabs),
      bottomNavigationBar: _BlynkBottomNav(
        index: _index,
        onChanged: _selectTab,
      ),
    );
  }
}

class _BlynkBottomNav extends StatelessWidget {
  const _BlynkBottomNav({required this.index, required this.onChanged});

  final int index;
  final ValueChanged<int> onChanged;

  @override
  Widget build(BuildContext context) {
    final cartCount = context.watch<CartProvider>().itemCount;

    return Container(
      decoration: const BoxDecoration(
        color: Colors.white,
        border: Border(top: BorderSide(color: AppSurfaces.border)),
      ),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: AppSpacing.sm),
          child: Row(
            children: [
              _NavItem(
                icon: Icons.storefront_outlined,
                activeIcon: Icons.storefront,
                label: 'Shop',
                isActive: index == 0,
                onTap: () => onChanged(0),
                badgeCount: cartCount,
              ),
              _NavItem(
                icon: Icons.receipt_long_outlined,
                activeIcon: Icons.receipt_long,
                label: 'Orders',
                isActive: index == 1,
                onTap: () => onChanged(1),
              ),
              _NavItem(
                icon: Icons.help_outline_rounded,
                activeIcon: Icons.help_rounded,
                label: 'Help',
                isActive: index == 2,
                onTap: () => onChanged(2),
              ),
              _NavItem(
                icon: Icons.person_outline_rounded,
                activeIcon: Icons.person_rounded,
                label: 'Profile',
                isActive: index == 3,
                onTap: () => onChanged(3),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _NavItem extends StatelessWidget {
  const _NavItem({
    required this.icon,
    required this.activeIcon,
    required this.label,
    required this.isActive,
    required this.onTap,
    this.badgeCount = 0,
  });

  final IconData icon;
  final IconData activeIcon;
  final String label;
  final bool isActive;
  final VoidCallback onTap;
  final int badgeCount;

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Semantics(
        button: true,
        selected: isActive,
        label: label,
        child: InkWell(
          onTap: onTap,
          borderRadius: AppRadius.buttonBorder,
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 6),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                AnimatedContainer(
                  duration: const Duration(milliseconds: 200),
                  padding: const EdgeInsets.symmetric(
                    horizontal: AppSpacing.lg,
                    vertical: AppSpacing.xs + 1,
                  ),
                  decoration: BoxDecoration(
                    // Blynk Yellow marks the active destination.
                    color: isActive
                        ? AppColors.primaryYellowColor
                        : Colors.transparent,
                    borderRadius: BorderRadius.circular(AppRadius.chip),
                  ),
                  child: Stack(
                    clipBehavior: Clip.none,
                    children: [
                      Icon(
                        isActive ? activeIcon : icon,
                        size: 21,
                        color: isActive
                            ? AppTextColors.onYellow
                            : AppTextColors.secondary,
                      ),
                      if (badgeCount > 0)
                        Positioned(
                          right: -6,
                          top: -4,
                          child: Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 5,
                              vertical: 1,
                            ),
                            decoration: BoxDecoration(
                              color: AppColors.primaryGreenColor,
                              borderRadius:
                                  BorderRadius.circular(AppRadius.chip),
                            ),
                            child: Text(
                              '$badgeCount',
                              style: const TextStyle(
                                color: Colors.white,
                                fontSize: 10,
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                          ),
                        ),
                    ],
                  ),
                ),
                const SizedBox(height: 3),
                Text(
                  label,
                  style: TextStyle(
                    fontSize: 11,
                    fontWeight: isActive ? FontWeight.w800 : FontWeight.w600,
                    color: isActive
                        ? AppTextColors.primary
                        : AppTextColors.secondary,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
