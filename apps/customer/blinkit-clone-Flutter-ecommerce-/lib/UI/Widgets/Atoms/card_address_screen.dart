import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../app_colors.dart';
import '../../../Models/address_model.dart';
import '../../../Screens/add_edit_address_screen.dart';
import '../../../Services/Providers/address.provider.dart';

class AddressCard extends StatelessWidget {
  const AddressCard({
    super.key,
    required this.address,
    this.onSelect,
  });

  final AddressModel address;
  // Set when this card is shown from checkout (tap to select as the
  // delivery address); null when shown from the plain address-management
  // list, where tapping does nothing but Edit/Delete/Default do.
  final VoidCallback? onSelect;

  Future<void> _confirmDelete(BuildContext context) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Delete address?'),
        content: Text('Remove "${address.label}" from your saved addresses?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Delete', style: TextStyle(color: Colors.redAccent)),
          ),
        ],
      ),
    );
    if (confirmed == true && context.mounted) {
      await context.read<AddressProvider>().deleteAddress(address.id);
    }
  }

  @override
  Widget build(BuildContext context) {
    return InkWell(
      borderRadius: BorderRadius.circular(10.0),
      onTap: onSelect,
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 8),
        margin: const EdgeInsets.symmetric(vertical: 10),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(10.0),
          border: address.isDefault
              ? Border.all(color: AppColors.primaryGreenColor, width: 1.5)
              : null,
        ),
        child: Column(
          children: [
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 8),
                  decoration: BoxDecoration(
                      color: AppColors.greyWhiteColor,
                      borderRadius: BorderRadius.circular(10.0)),
                  child: const Icon(
                    Icons.home,
                    color: Colors.deepOrangeAccent,
                  ),
                ),
                const SizedBox(
                  width: 20,
                ),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Row(
                        children: [
                          Text(
                            address.label,
                            style: const TextStyle(fontWeight: FontWeight.bold),
                          ),
                          if (address.isDefault) ...[
                            const SizedBox(width: 6),
                            const Text(
                              '· Default',
                              style: TextStyle(
                                fontSize: 11,
                                color: AppColors.primaryGreenColor,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                          ],
                        ],
                      ),
                      Text(
                        address.displaySummary,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontSize: 12),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(
              height: 5,
            ),
            Divider(
              thickness: 1,
              color: Colors.grey.shade300,
            ),
            const SizedBox(
              height: 5,
            ),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8.0),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                children: [
                  if (!address.isDefault)
                    TextButton(
                      onPressed: () =>
                          context.read<AddressProvider>().setDefaultAddress(address.id),
                      child: const Text(
                        'Set Default',
                        style: TextStyle(color: AppColors.primaryGreenColor),
                      ),
                    ),
                  TextButton(
                    onPressed: () => Navigator.of(context).push(
                      MaterialPageRoute(
                        builder: (_) => AddEditAddressScreen(existing: address),
                      ),
                    ),
                    child: const Text(
                      'Edit',
                      style: TextStyle(
                        color: AppColors.primaryGreenColor,
                      ),
                    ),
                  ),
                  TextButton(
                    onPressed: () => _confirmDelete(context),
                    child: const Text(
                      'Delete',
                      style: TextStyle(
                        color: Colors.redAccent,
                      ),
                    ),
                  ),
                ],
              ),
            )
          ],
        ),
      ),
    );
  }
}
