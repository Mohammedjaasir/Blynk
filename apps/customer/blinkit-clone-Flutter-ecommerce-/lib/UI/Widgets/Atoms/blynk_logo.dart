import 'package:flutter/material.dart';

/// The Blynk logo: the multicolour B mark followed by the 'blynk' wordmark.
///
/// Both pieces are cut from the supplied brand artwork (see
/// Assets/Images/blynk_mark.png and blynk_wordmark.png). [height] is the
/// height of the mark; the wordmark is sized against it.
class BlynkLogo extends StatelessWidget {
  const BlynkLogo({super.key, this.height = 32, this.showWordmark = true});

  final double height;
  final bool showWordmark;

  static const String markAsset = 'Assets/Images/blynk_mark.png';
  static const String wordmarkAsset = 'Assets/Images/blynk_wordmark.png';

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: 'Blynk',
      image: true,
      child: ExcludeSemantics(
        child: Row(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            Image.asset(markAsset, height: height, filterQuality: FilterQuality.medium),
            if (showWordmark) ...[
              SizedBox(width: height * 0.22),
              Image.asset(
                wordmarkAsset,
                height: height * 0.62,
                filterQuality: FilterQuality.medium,
              ),
            ],
          ],
        ),
      ),
    );
  }
}
