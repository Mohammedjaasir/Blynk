// Small local formatting helpers - no `intl` dependency (Global Constraints).
import 'order_model.dart';
import 'order_status_labels.dart';

const _months = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

const _weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/// 'Rs. 1,955' when the amount is a whole number, 'Rs. 1,214.50' when it
/// carries cents - it is the cash the rider collects (C5).
///
/// The whole-vs-cents decision and the digits shown both come from the same
/// rounded-to-cents integer, so a value like 999.999 (which displays as
/// 1000.00) is correctly treated as whole rather than showing spurious
/// cents from the pre-rounding fractional part.
String formatLkr(double amount) {
  final cents = (amount * 100).round();
  final whole = cents % 100 == 0;
  final wholePart = (cents ~/ 100).toString();
  final withCommas = wholePart.replaceAllMapped(
    RegExp(r'\B(?=(\d{3})+(?!\d))'),
    (match) => ',',
  );
  if (whole) return 'Rs. $withCommas';
  final fraction = (cents % 100).toString().padLeft(2, '0');
  return 'Rs. $withCommas.$fraction';
}

String _time12h(DateTime d) {
  final hour12 = d.hour % 12 == 0 ? 12 : d.hour % 12;
  final ampm = d.hour < 12 ? 'AM' : 'PM';
  final minute = d.minute.toString().padLeft(2, '0');
  return '$hour12:$minute $ampm';
}

/// '19 Sep, 3:42 PM' in the device's local time - the backend sends UTC or
/// local ISO strings and this always renders what the customer's clock says.
String formatOrderTime(DateTime utcOrLocal) {
  final d = utcOrLocal.toLocal();
  final month = _months[d.month - 1];
  return '${d.day} $month, ${_time12h(d)}';
}

/// 'from 8:00 AM, Sun 20 Sep' - the scheduled delivery window.
String formatScheduled(DateTime at) {
  final d = at.toLocal();
  final weekday = _weekdays[d.weekday - 1];
  final month = _months[d.month - 1];
  return 'from ${_time12h(d)}, $weekday ${d.day} $month';
}

/// The one-line status copy under the status header (C3/C4). Assignment
/// wording is shown only when the backend explicitly said so via
/// `delivery.assignmentStatus` - never inferred from timestamps, the order
/// status alone, or the absence of a delivery block (C4).
String orderStatusSentence(OrderModel o) {
  final assignmentStatus = o.showsDelivery ? o.delivery!.assignmentStatus : null;
  switch (o.status) {
    case OrderStatus.placed:
      return o.isScheduled
          ? "We'll start preparing it when deliveries open."
          : "We've received your order.";
    case OrderStatus.itemUnavailable:
      return "Something couldn't be sourced. Your total has been updated.";
    case OrderStatus.packed:
      if (assignmentStatus == 'ASSIGNED' || assignmentStatus == 'ACCEPTED') {
        return 'A rider has been assigned.';
      }
      return 'Your order is packed.';
    case OrderStatus.outForDelivery:
      if (assignmentStatus == 'ARRIVED_AT_CUSTOMER') {
        return 'Your rider has arrived.';
      }
      return 'Your order is on its way.';
    case OrderStatus.delivered:
      return 'Delivered. Thank you!';
    case OrderStatus.cancelled:
      return 'This order was cancelled.';
    case OrderStatus.failed:
      return "We couldn't complete this delivery.";
    case OrderStatus.customerUnavailable:
      return "The rider couldn't reach you at the address.";
    case OrderStatus.unknown:
      return 'Pull down to refresh.';
  }
}

/// The label for one `history[]` row in the "What happened" timeline. A
/// PACKED row whose old status is a failure reads as a redelivery attempt,
/// not a fresh pack.
String timelineLabel(OrderStatusEvent e) {
  final restaged = e.newStatus == OrderStatus.packed &&
      (e.oldStatus == OrderStatus.failed || e.oldStatus == OrderStatus.customerUnavailable);
  if (restaged) return 'Packed again for redelivery';
  return orderStatusLabel(e.newStatus);
}

/// The one payment line on the bill.
String paymentLine(OrderModel o) {
  if (o.status == OrderStatus.cancelled) return 'Nothing to pay';
  if (o.paymentStatus == 'PAID') return 'Paid in cash';
  final failedToCollect =
      o.status == OrderStatus.failed || o.status == OrderStatus.customerUnavailable;
  if (failedToCollect) return 'Not paid';
  return 'Cash on delivery — pay ${formatLkr(o.totalAmount)} to the rider';
}
