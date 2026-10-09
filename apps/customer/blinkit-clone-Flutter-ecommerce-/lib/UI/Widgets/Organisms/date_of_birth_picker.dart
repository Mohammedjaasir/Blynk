import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../Models/birthday_offer_model.dart';
import '../../../design/tokens.dart';
import '../Atoms/adaptive_sheet.dart';
import '../Atoms/blynk_button.dart';

/// Opens Blynk's own date-of-birth picker (owner, 2026-10-09: "in the app's
/// own design", not the stock Material calendar): a sheet (a dialog from
/// 600 dp up, via [showAdaptiveSheet]) with three wheels - day, month, year -
/// over one quiet `well` band that marks the chosen row.
///
/// Only dates the backend accepts can be chosen: an age of 5 to 120, never
/// in the future ([dateOfBirthRange]). Resolves to the chosen date, or null
/// when the sheet is closed without "Done".
Future<DateTime?> showDateOfBirthPicker(
  BuildContext context, {
  DateTime? initial,
  DateTime? today,
}) {
  return showAdaptiveSheet<DateTime>(
    context,
    semanticLabel: 'Choose your date of birth',
    builder: (_) => DateOfBirthWheels(initial: initial, today: today),
  );
}

/// The sheet's body: the three wheels, then Done / Cancel. Public so a test
/// can pump it on its own.
class DateOfBirthWheels extends StatefulWidget {
  const DateOfBirthWheels({super.key, this.initial, this.today});

  final DateTime? initial;

  /// Injectable for tests; defaults to now.
  final DateTime? today;

  static const Key dayWheel = Key('dob-day-wheel');
  static const Key monthWheel = Key('dob-month-wheel');
  static const Key yearWheel = Key('dob-year-wheel');
  static const Key doneKey = Key('dob-done');

  /// One row of a wheel. 44 + the band's own radius reads as one tap row.
  static const double rowExtent = 44;

  /// Five rows visible: two either side of the chosen one.
  static const double wheelHeight = rowExtent * 5;

  @override
  State<DateOfBirthWheels> createState() => _DateOfBirthWheelsState();
}

class _DateOfBirthWheelsState extends State<DateOfBirthWheels> {
  late final ({DateTime earliest, DateTime latest}) _range = dateOfBirthRange(widget.today);
  late int _year;
  late int _month; // 1-12
  late int _day; // 1-31

  late final FixedExtentScrollController _dayController;
  late final FixedExtentScrollController _monthController;
  late final FixedExtentScrollController _yearController;

  int get _firstYear => _range.earliest.year;
  int get _yearCount => _range.latest.year - _firstYear + 1;
  int get _daysThisMonth => daysInMonth(_year, _month);

  @override
  void initState() {
    super.initState();
    final now = widget.today ?? DateTime.now();
    // No date yet: start somewhere plausible rather than at a 5-year-old.
    final start = _clamp(widget.initial ?? DateTime(now.year - 25, 1, 1));
    _year = start.year;
    _month = start.month;
    _day = start.day;
    _dayController = FixedExtentScrollController(initialItem: _day - 1);
    _monthController = FixedExtentScrollController(initialItem: _month - 1);
    _yearController = FixedExtentScrollController(initialItem: _year - _firstYear);
  }

  @override
  void dispose() {
    _dayController.dispose();
    _monthController.dispose();
    _yearController.dispose();
    super.dispose();
  }

  DateTime _clamp(DateTime date) {
    if (date.isBefore(_range.earliest)) return _range.earliest;
    if (date.isAfter(_range.latest)) return _range.latest;
    return DateTime(date.year, date.month, date.day);
  }

  /// A month or year change can leave the day past the month's end
  /// (31 -> February): pull it back and move the day wheel with it.
  void _keepDayInMonth() {
    final max = _daysThisMonth;
    if (_day > max) {
      _day = max;
      if (_dayController.hasClients) _dayController.jumpToItem(_day - 1);
    }
  }

  void _done() {
    Navigator.of(context).pop(_clamp(DateTime(_year, _month, _day)));
  }

  @override
  Widget build(BuildContext context) {
    // What Done saves: the wheels can show a day past the range's end (this
    // month, five years ago), which is pulled back to the last allowed day.
    final chosen = _clamp(DateTime(_year, _month, _day));
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(BlynkSpace.s16, 0, BlynkSpace.s16, BlynkSpace.s16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          Semantics(header: true, child: const Text('Your date of birth', style: BlynkText.title)),
          const SizedBox(height: BlynkSpace.s4),
          Text(
            'For a birthday gift from Blynk. Only you and Blynk see it.',
            style: BlynkText.body.copyWith(color: BlynkColors.ink2),
          ),
          const SizedBox(height: BlynkSpace.s16),
          SizedBox(
            height: DateOfBirthWheels.wheelHeight,
            child: Stack(
              alignment: Alignment.center,
              children: [
                // The chosen row: a quiet band behind all three wheels.
                const IgnorePointer(
                  child: SizedBox(
                    height: DateOfBirthWheels.rowExtent,
                    width: double.infinity,
                    child: DecoratedBox(
                      decoration: BoxDecoration(color: BlynkColors.well, borderRadius: BlynkRadius.mdAll),
                    ),
                  ),
                ),
                Row(
                  children: [
                    Expanded(
                      flex: 2,
                      child: _Wheel(
                        key: DateOfBirthWheels.dayWheel,
                        label: 'Day',
                        controller: _dayController,
                        count: _daysThisMonth,
                        selected: _day - 1,
                        labelOf: (i) => '${i + 1}',
                        onChanged: (i) => setState(() => _day = i + 1),
                      ),
                    ),
                    Expanded(
                      flex: 4,
                      child: _Wheel(
                        key: DateOfBirthWheels.monthWheel,
                        label: 'Month',
                        controller: _monthController,
                        count: 12,
                        selected: _month - 1,
                        labelOf: (i) => monthNames[i],
                        onChanged: (i) => setState(() {
                          _month = i + 1;
                          _keepDayInMonth();
                        }),
                      ),
                    ),
                    Expanded(
                      flex: 3,
                      child: _Wheel(
                        key: DateOfBirthWheels.yearWheel,
                        label: 'Year',
                        controller: _yearController,
                        count: _yearCount,
                        selected: _year - _firstYear,
                        labelOf: (i) => '${_firstYear + i}',
                        onChanged: (i) => setState(() {
                          _year = _firstYear + i;
                          _keepDayInMonth();
                        }),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(height: BlynkSpace.s12),
          // Says what Done will save, so the wheels never have to be read.
          Semantics(
            liveRegion: true,
            child: Text(
              formatBirthday(chosen),
              key: const Key('dob-chosen'),
              textAlign: TextAlign.center,
              style: BlynkText.heading,
            ),
          ),
          const SizedBox(height: BlynkSpace.s16),
          BlynkButton.primary(key: DateOfBirthWheels.doneKey, label: 'Done', expand: true, onPressed: _done),
          const SizedBox(height: BlynkSpace.s8),
          BlynkButton.tertiary(
            label: 'Cancel',
            expand: true,
            onPressed: () => Navigator.of(context).pop(),
          ),
        ],
      ),
    );
  }
}

/// One wheel. The chosen row is ink and bold; the rest fade to `ink2`.
class _Wheel extends StatelessWidget {
  const _Wheel({
    super.key,
    required this.label,
    required this.controller,
    required this.count,
    required this.selected,
    required this.labelOf,
    required this.onChanged,
  });

  final String label;
  final FixedExtentScrollController controller;
  final int count;
  final int selected;
  final String Function(int index) labelOf;
  final ValueChanged<int> onChanged;

  @override
  Widget build(BuildContext context) {
    final value = labelOf(selected.clamp(0, count - 1));
    // Screen readers get an adjustable control, not a list of numbers.
    return Semantics(
      label: label,
      value: value,
      increasedValue: selected + 1 < count ? labelOf(selected + 1) : null,
      decreasedValue: selected > 0 ? labelOf(selected - 1) : null,
      onIncrease: selected + 1 < count ? () => _step(1) : null,
      onDecrease: selected > 0 ? () => _step(-1) : null,
      excludeSemantics: true,
      child: ListWheelScrollView.useDelegate(
        controller: controller,
        itemExtent: DateOfBirthWheels.rowExtent,
        physics: const FixedExtentScrollPhysics(),
        diameterRatio: 1.8,
        overAndUnderCenterOpacity: 0.6,
        onSelectedItemChanged: (i) {
          HapticFeedback.selectionClick();
          onChanged(i);
        },
        childDelegate: ListWheelChildBuilderDelegate(
          childCount: count,
          builder: (context, i) => Center(
            child: Text(
              labelOf(i),
              maxLines: 1,
              overflow: TextOverflow.fade,
              softWrap: false,
              style: i == selected
                  ? BlynkText.heading
                  : BlynkText.body.copyWith(color: BlynkColors.ink2),
            ),
          ),
        ),
      ),
    );
  }

  void _step(int by) {
    final next = (selected + by).clamp(0, count - 1);
    controller.jumpToItem(next);
  }
}

/// The date-of-birth field: the chosen date (or a prompt to add one) in the
/// app's field look, which opens [showDateOfBirthPicker], and a Clear button
/// while a date is set - the date of birth is optional and clearable
/// (owner, 2026-10-09).
class DateOfBirthField extends StatelessWidget {
  const DateOfBirthField({
    super.key,
    required this.value,
    required this.onChanged,
    this.label = 'Date of birth',
    this.enabled = true,
    this.today,
  });

  final DateTime? value;
  final ValueChanged<DateTime?> onChanged;
  final String label;
  final bool enabled;

  /// Injectable for tests.
  final DateTime? today;

  static const Key fieldKey = Key('dob-field');
  static const Key clearKey = Key('dob-clear');

  Future<void> _pick(BuildContext context) async {
    final picked = await showDateOfBirthPicker(context, initial: value, today: today);
    if (picked != null) onChanged(picked);
  }

  @override
  Widget build(BuildContext context) {
    final date = value;
    final text = date == null ? 'Add your date of birth' : formatBirthday(date);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        ExcludeSemantics(child: Text(label, style: BlynkText.label)),
        const SizedBox(height: BlynkSpace.s8),
        Row(
          children: [
            Expanded(
              child: Semantics(
                button: true,
                enabled: enabled,
                label: label,
                value: date == null ? 'Not set' : text,
                excludeSemantics: true,
                child: Material(
                  color: enabled ? BlynkColors.well : BlynkColors.paper,
                  shape: RoundedRectangleBorder(
                    borderRadius: BlynkRadius.mdAll,
                    side: BorderSide(color: enabled ? BlynkColors.lineStrong : BlynkColors.line),
                  ),
                  clipBehavior: Clip.antiAlias,
                  child: InkWell(
                    key: fieldKey,
                    onTap: enabled ? () => _pick(context) : null,
                    child: ConstrainedBox(
                      constraints: const BoxConstraints(minHeight: BlynkControl.minHeight),
                      child: Padding(
                        padding: const EdgeInsets.symmetric(horizontal: BlynkSpace.s16, vertical: BlynkSpace.s12),
                        child: Row(
                          children: [
                            Expanded(
                              child: Text(
                                text,
                                style: date == null ? BlynkText.body.copyWith(color: BlynkColors.ink2) : BlynkText.body,
                              ),
                            ),
                            const SizedBox(width: BlynkSpace.s8),
                            const Icon(BlynkIcons.calendar, size: BlynkIcons.sm, color: BlynkColors.ink2),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
            if (date != null) ...[
              const SizedBox(width: BlynkSpace.s8),
              BlynkButton.tertiary(
                key: clearKey,
                label: 'Clear',
                semanticLabel: 'Clear date of birth',
                onPressed: enabled ? () => onChanged(null) : null,
              ),
            ],
          ],
        ),
      ],
    );
  }
}
