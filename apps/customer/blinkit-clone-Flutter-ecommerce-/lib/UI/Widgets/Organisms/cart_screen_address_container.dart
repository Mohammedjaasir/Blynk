import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../app_colors.dart';
import '../../../Services/Providers/address.provider.dart';

class CartScreenAddressContainer extends StatefulWidget {
  const CartScreenAddressContainer({
    super.key,
  });

  @override
  State<CartScreenAddressContainer> createState() => _CartScreenAddressContainerState();
}

class _CartScreenAddressContainerState extends State<CartScreenAddressContainer> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final addressProvider = context.read<AddressProvider>();
      if (addressProvider.addresses.isEmpty) {
        addressProvider.loadAddresses();
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final address = context.watch<AddressProvider>().defaultAddress;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
      decoration: const BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.only(
          topLeft: Radius.circular(20.0),
          topRight: Radius.circular(20.0),
        ),
      ),
      width: double.infinity,
      height: 70,
      child: Center(
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.center,
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Expanded(
              child: Row(
                children: [
                  const Icon(
                    Icons.home_filled,
                    color: Colors.orangeAccent,
                  ),
                  const SizedBox(
                    width: 15,
                  ),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Text(
                          address != null
                              ? 'Delivering to ${address.label}'
                              : 'No delivery address yet',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(fontWeight: FontWeight.bold),
                        ),
                        Text(
                          address?.displaySummary ?? 'Add an address to check out',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(fontWeight: FontWeight.w300),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            GestureDetector(
              onTap: () {
                Navigator.of(context).pushNamed('/user/address');
              },
              child: Text(
                address != null ? "Change" : "Add",
                style: const TextStyle(
                  color: AppColors.primaryGreenColor,
                ),
              ),
            )
          ],
        ),
      ),
    );
  }
}
