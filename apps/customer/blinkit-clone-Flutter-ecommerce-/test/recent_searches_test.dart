import 'package:flutter_test/flutter_test.dart';

import 'package:ecom/Infrastructure/LocalStorage/recent_searches_storage.dart';

void main() {
  group('addRecentSearch', () {
    test('puts the newest search first', () {
      expect(addRecentSearch(['bread'], 'milk'), ['milk', 'bread']);
    });

    test('trims and ignores empty queries', () {
      expect(addRecentSearch(['bread'], '  milk  '), ['milk', 'bread']);
      expect(addRecentSearch(['bread'], '   '), ['bread']);
      expect(addRecentSearch(const [], ''), isEmpty);
    });

    test('de-duplicates case-insensitively, keeping the latest spelling', () {
      expect(addRecentSearch(['milk', 'bread'], 'Milk'), ['Milk', 'bread']);
    });

    test('caps the history length', () {
      final full = List.generate(kMaxRecentSearches, (i) => 'q$i');
      final next = addRecentSearch(full, 'new');
      expect(next, hasLength(kMaxRecentSearches));
      expect(next.first, 'new');
      expect(next, isNot(contains('q${kMaxRecentSearches - 1}')));
    });

    test('does not mutate the input list', () {
      final current = ['bread'];
      addRecentSearch(current, 'milk');
      expect(current, ['bread']);
    });
  });
}
