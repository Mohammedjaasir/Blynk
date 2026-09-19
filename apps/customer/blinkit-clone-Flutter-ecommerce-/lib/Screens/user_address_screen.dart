import 'package:ecom/app_colors.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../UI/Widgets/Atoms/card_add_address.dart';
import '../UI/Widgets/Atoms/card_address_screen.dart';
import '../Services/Providers/address.provider.dart';

class UserAddressScreen extends StatefulWidget {
  const UserAddressScreen({super.key});

  @override
  State<UserAddressScreen> createState() => _UserAddressScreenState();
}

class _UserAddressScreenState extends State<UserAddressScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<AddressProvider>().loadAddresses();
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.greyWhiteColor,
      appBar: AppBar(
        title: const Text('My Addresses'),
      ),
      body: Consumer<AddressProvider>(
        builder: (context, addressProvider, _) {
          return RefreshIndicator(
            onRefresh: addressProvider.loadAddresses,
            child: ListView(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
              children: [
                const AddNewAddressCard(),
                if (addressProvider.isLoading)
                  const Padding(
                    padding: EdgeInsets.symmetric(vertical: 32.0),
                    child: Center(child: CircularProgressIndicator()),
                  )
                else if (addressProvider.errorMessage != null)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 32.0),
                    child: Center(
                      child: Text(
                        'Could not load your addresses. Pull to refresh.',
                        style: TextStyle(color: Colors.grey.shade600),
                      ),
                    ),
                  )
                else if (addressProvider.addresses.isEmpty)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 32.0),
                    child: Center(
                      child: Text(
                        'No saved addresses yet.',
                        style: TextStyle(color: Colors.grey.shade600),
                      ),
                    ),
                  )
                else
                  ...addressProvider.addresses.map(
                    (address) => AddressCard(address: address),
                  ),
              ],
            ),
          );
        },
      ),
    );
  }
}
