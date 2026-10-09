import 'dart:ui' show Tristate;

import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:ecom/Screens/Auth/birthday_prompt_screen.dart';
import 'package:ecom/Screens/about_you_screen.dart';
import 'package:ecom/Services/Exceptions/api_exception.dart';
import 'package:ecom/Services/Providers/auth.provider.dart';
import 'package:ecom/Services/Providers/product.provider.dart';
import 'package:ecom/Services/Providers/profile.provider.dart';
import 'package:ecom/Services/Providers/store_info.provider.dart';
import 'package:ecom/UI/Widgets/Organisms/date_of_birth_picker.dart';
import 'package:ecom/UI/Widgets/Organisms/favourite_category_chips.dart';
import 'package:ecom/app_theme.dart';

import 'fixtures/session_fakes.dart';

/// Profile > About you and the one sign-up birthday prompt (owner,
/// 2026-10-09): name, date of birth (Blynk's own wheel picker, optional and
/// clearable) and favourite categories + free text, all optional, saved with
/// PATCH /me.

final _today = DateTime(2026, 10, 10);

/// GET /me answers [profile]; PATCH merges the body into it like the backend
/// and answers the full profile, with the gift open once a date is saved.
class _FakeMe {
  _FakeMe(this.profile);

  final Map<String, dynamic> profile;
  final calls = <Map<String, dynamic>>[];
  Object? patchError;

  Future<dynamic> call({String? methodType, String? url, dynamic body}) async {
    calls.add({'method': methodType, 'url': url, 'body': body});
    if (methodType == 'PATCH') {
      if (patchError != null) throw patchError!;
      profile.addAll((body as Map).cast<String, dynamic>());
      final ids = profile['favourite_category_ids'];
      if (ids is List) {
        profile['favourite_categories'] = [
          for (final id in ids) {'id': id, 'name': _names[id] ?? id},
        ];
      }
      if (profile['date_of_birth'] != null) {
        profile['birthday_offer'] = {
          'enabled': true,
          'percent': 10,
          'has_birthday': true,
          'in_window': true,
          'used': false,
          'eligible': true,
        };
      }
    }
    return {
      'success': true,
      'data': {'profile': Map<String, dynamic>.of(profile)},
    };
  }

  List<Map<String, dynamic>> get patches => calls.where((c) => c['method'] == 'PATCH').toList();
}

const _names = {'c1': 'Snacks', 'c2': 'Dairy & Eggs', 'c3': 'Beverages'};

ProductProvider _products() => ProductProvider(
      request: (url, query) async => {
        'success': true,
        'data': {
          'categories': [
            for (final e in _names.entries) {'id': e.key, 'name': e.value, 'slug': e.key},
          ],
        },
      },
    );

Map<String, dynamic> _profile({String? dob, List<String> favs = const [], String? note}) => {
      'id': 'u1',
      'phone': '+94771234567',
      'role': 'CUSTOMER',
      'full_name': 'Nimal Perera',
      'created_at': '2026-01-01',
      'date_of_birth': dob,
      'favourite_category_ids': favs,
      'favourite_categories': [for (final id in favs) {'id': id, 'name': _names[id]}],
      'favourites_note': note,
      'birthday_offer': {
        'enabled': true,
        'percent': 10,
        'has_birthday': dob != null,
        'in_window': false,
        'used': false,
        'eligible': false,
      },
    };

Future<StoreInfoProvider> _pumpAboutYou(WidgetTester tester, _FakeMe api) async {
  final store = StoreInfoProvider(
    request: (_) async => {'success': true, 'data': {}},
    readCache: () async => null,
    writeCache: (_) async {},
  );
  tester.view.physicalSize = const Size(420, 1400);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    MultiProvider(
      providers: [
        ChangeNotifierProvider<AuthProvider>.value(value: SignedInAuth()),
        ChangeNotifierProvider.value(value: _products()),
        ChangeNotifierProvider.value(value: store),
      ],
      child: MaterialApp(
        theme: AppTheme.appTHeme,
        home: AboutYouScreen(provider: ProfileProvider(request: api.call), today: _today),
      ),
    ),
  );
  await tester.pumpAndSettle();
  return store;
}

Future<void> _scrollTo(WidgetTester tester, Finder f) async {
  await tester.scrollUntilVisible(f, 200, scrollable: find.byType(Scrollable).first);
  await tester.pumpAndSettle();
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  FlutterSecureStorage.setMockInitialValues({});

  group('About you', () {
    testWidgets('fills from GET /me, with the live categories as chips; Save waits for a change', (tester) async {
      final api = _FakeMe(_profile(dob: '1995-03-14', favs: ['c1'], note: 'Milo'));
      await _pumpAboutYou(tester, api);

      expect(find.text('About you'), findsOneWidget);
      expect(find.text('Nimal Perera'), findsOneWidget);
      expect(find.text('14 March 1995'), findsOneWidget);
      expect(find.text('Milo'), findsOneWidget);
      for (final name in _names.values) {
        expect(find.text(name), findsOneWidget, reason: name);
      }
      final chip = tester.getSemantics(find.byKey(FavouriteCategoryChips.chipKey('c1')));
      expect(chip.flagsCollection.isToggled, Tristate.isTrue);
      expect(find.text('You get 10% off one order in your birthday week.'), findsOneWidget);

      await _scrollTo(tester, find.byKey(AboutYouScreen.saveKey));
      final save = tester.widget<ButtonStyleButton>(
          find.descendant(of: find.byKey(AboutYouScreen.saveKey), matching: find.byWidgetPredicate((w) => w is ButtonStyleButton)));
      expect(save.onPressed, isNull, reason: 'nothing changed yet');
    });

    testWidgets('picks a date on the wheels, ticks favourites, writes a note and saves only the changes',
        (tester) async {
      final api = _FakeMe(_profile());
      final store = await _pumpAboutYou(tester, api);
      expect(find.text('Add your date of birth'), findsOneWidget);
      expect(find.text('Add it for 10% off one order in your birthday week.'), findsOneWidget);

      await tester.tap(find.byKey(DateOfBirthField.fieldKey));
      await tester.pumpAndSettle();
      expect(find.text('Your date of birth'), findsOneWidget);
      // Starts at 1 January, 25 years back: move the day by 2 and the month by 2.
      await tester.drag(find.byKey(DateOfBirthWheels.dayWheel), const Offset(0, -DateOfBirthWheels.rowExtent * 2));
      await tester.pumpAndSettle();
      await tester.drag(find.byKey(DateOfBirthWheels.monthWheel), const Offset(0, -DateOfBirthWheels.rowExtent * 2));
      await tester.pumpAndSettle();
      expect(find.text('3 March 2001'), findsOneWidget);
      await tester.tap(find.byKey(DateOfBirthWheels.doneKey));
      await tester.pumpAndSettle();
      expect(find.text('3 March 2001'), findsOneWidget);

      await tester.tap(find.byKey(FavouriteCategoryChips.chipKey('c2')));
      await tester.pump();
      await tester.tap(find.byKey(FavouriteCategoryChips.chipKey('c3')));
      await tester.pump();
      await _scrollTo(tester, find.byKey(AboutYouScreen.noteKey));
      await tester.enterText(
          find.descendant(of: find.byKey(AboutYouScreen.noteKey), matching: find.byType(TextField)), ' Spicy murukku ');
      await _scrollTo(tester, find.byKey(AboutYouScreen.saveKey));
      await tester.tap(find.byKey(AboutYouScreen.saveKey));
      await tester.pumpAndSettle();

      expect(api.patches, hasLength(1));
      expect(api.patches.single['body'], {
        'date_of_birth': '2001-03-03',
        'favourite_category_ids': ['c2', 'c3'],
        'favourites_note': 'Spicy murukku',
      });
      expect(find.text('Saved'), findsOneWidget);
      // The saved date opened the gift: Home / cart / checkout hear it at once.
      expect(store.birthdayOffer?.eligible, isTrue);
    });

    testWidgets('the date of birth is clearable, and a clear is saved as null', (tester) async {
      final api = _FakeMe(_profile(dob: '1995-03-14'));
      await _pumpAboutYou(tester, api);
      await tester.tap(find.byKey(DateOfBirthField.clearKey));
      await tester.pump();
      expect(find.text('Add your date of birth'), findsOneWidget);
      await _scrollTo(tester, find.byKey(AboutYouScreen.saveKey));
      await tester.tap(find.byKey(AboutYouScreen.saveKey));
      await tester.pumpAndSettle();
      expect(api.patches.single['body'], {'date_of_birth': null});
    });

    testWidgets('a refusal keeps what was typed and says why', (tester) async {
      final api = _FakeMe(_profile())
        ..patchError = ApiException(400, 'x', code: 'UNKNOWN_CATEGORY');
      await _pumpAboutYou(tester, api);
      await tester.tap(find.byKey(FavouriteCategoryChips.chipKey('c1')));
      await tester.pump();
      await _scrollTo(tester, find.byKey(AboutYouScreen.saveKey));
      await tester.tap(find.byKey(AboutYouScreen.saveKey));
      await tester.pumpAndSettle();
      expect(find.text("One of your favourites isn't in the shop any more. Untick it and save again."), findsOneWidget);
      final chip = tester.getSemantics(find.byKey(FavouriteCategoryChips.chipKey('c1')));
      expect(chip.flagsCollection.isToggled, Tristate.isTrue);
    });

    testWidgets('a guest is sent to log in', (tester) async {
      final pushed = <String>[];
      await tester.pumpWidget(ChangeNotifierProvider<AuthProvider>.value(
        value: AuthProvider(),
        child: MaterialApp(
          home: Builder(
            builder: (context) => TextButton(onPressed: () => AboutYouScreen.open(context), child: const Text('go')),
          ),
          onGenerateRoute: (s) {
            pushed.add(s.name ?? '');
            return MaterialPageRoute(builder: (_) => const SizedBox());
          },
        ),
      ));
      await tester.tap(find.text('go'));
      await tester.pumpAndSettle();
      expect(pushed, ['/login']);
    });
  });

  group('sign-up birthday prompt', () {
    Future<List<String>> pumpPrompt(WidgetTester tester, _FakeMe api) async {
      final pushed = <String>[];
      tester.view.physicalSize = const Size(420, 1000);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(MaterialApp(
        theme: AppTheme.appTHeme,
        home: BirthdayPromptScreen(provider: ProfileProvider(request: api.call), today: _today),
        onGenerateRoute: (s) {
          pushed.add(s.name ?? '');
          return MaterialPageRoute(builder: (_) => Text('route:${s.name}'));
        },
      ));
      await tester.pumpAndSettle();
      return pushed;
    }

    testWidgets('Skip goes to the shop and saves nothing', (tester) async {
      final api = _FakeMe(_profile());
      final pushed = await pumpPrompt(tester, api);
      expect(find.text('Tell us your birthday for a gift'), findsOneWidget);
      await tester.tap(find.byKey(BirthdayPromptScreen.skipKey));
      await tester.pumpAndSettle();
      expect(pushed, ['/home']);
      expect(api.calls, isEmpty);
    });

    testWidgets('a chosen date is saved (just the date) and then the shop opens', (tester) async {
      final api = _FakeMe(_profile());
      final pushed = await pumpPrompt(tester, api);
      final save = find.descendant(
          of: find.byKey(BirthdayPromptScreen.saveKey), matching: find.byWidgetPredicate((w) => w is ButtonStyleButton));
      expect(tester.widget<ButtonStyleButton>(save).onPressed, isNull, reason: 'no date yet');

      await tester.tap(find.byKey(DateOfBirthField.fieldKey));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(DateOfBirthWheels.doneKey));
      await tester.pumpAndSettle();
      expect(find.text('1 January 2001'), findsOneWidget);
      await tester.tap(find.byKey(BirthdayPromptScreen.saveKey));
      await tester.pumpAndSettle();
      expect(api.patches.single['body'], {'date_of_birth': '2001-01-01'});
      expect(pushed, ['/home']);
    });
  });

  group('the wheels', () {
    testWidgets('never offer a date the backend refuses, and keep the day inside the month', (tester) async {
      DateTime? picked;
      tester.view.physicalSize = const Size(420, 1000);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(MaterialApp(
        theme: AppTheme.appTHeme,
        home: Scaffold(
          body: Builder(
            builder: (context) => TextButton(
              onPressed: () async => picked = await showDateOfBirthPicker(context,
                  initial: DateTime(2000, 1, 31), today: _today),
              child: const Text('open'),
            ),
          ),
        ),
      ));
      await tester.tap(find.text('open'));
      await tester.pumpAndSettle();
      expect(find.text('31 January 2000'), findsOneWidget);
      // January -> February: 31 is pulled back to 29 (2000 is a leap year).
      await tester.drag(find.byKey(DateOfBirthWheels.monthWheel), const Offset(0, -DateOfBirthWheels.rowExtent));
      await tester.pumpAndSettle();
      expect(find.text('29 February 2000'), findsOneWidget);
      await tester.tap(find.byKey(DateOfBirthWheels.doneKey));
      await tester.pumpAndSettle();
      expect(picked, DateTime(2000, 2, 29));
    });
  });
}
