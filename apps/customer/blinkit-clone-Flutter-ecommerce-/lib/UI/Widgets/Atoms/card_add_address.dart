import 'package:flutter/material.dart';

import '../../../app_colors.dart';
import '../../../Screens/add_edit_address_screen.dart';

class AddNewAddressCard extends StatelessWidget {
  const AddNewAddressCard({
    super.key,
  });

  @override
  Widget build(BuildContext context) {
    return InkWell(
      borderRadius: BorderRadius.circular(10.0),
      onTap: () => Navigator.of(context).push(
        MaterialPageRoute(builder: (_) => const AddEditAddressScreen()),
      ),
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 8),
        margin: const EdgeInsets.symmetric(vertical: 10),
        decoration: BoxDecoration(
            color: Colors.white, borderRadius: BorderRadius.circular(10.0)),
        child: const Row(
          children: [
            Icon(
              Icons.add,
              color: AppColors.primaryGreenColor,
            ),
            SizedBox(width: 8),
            Text(
              'Add new address',
              style: TextStyle(fontWeight: FontWeight.bold),
            )
          ],
        ),
      ),
    );
  }
}
