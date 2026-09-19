import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:ecom/Services/Providers/auth.provider.dart';
import 'package:ecom/Services/Exceptions/api_exception.dart';
import 'package:ecom/Infrastructure/HttpMethods/token_storage.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  FlutterSecureStorage.setMockInitialValues({});

  group('AuthProvider State & Method Tests', () {
    late AuthProvider authProvider;

    setUp(() async {
      FlutterSecureStorage.setMockInitialValues({});
      await TokenStorage.clearAll();
      authProvider = AuthProvider();
    });

    test('Initial state is unauthenticated and not loading', () {
      expect(authProvider.isAuthenticated, isFalse);
      expect(authProvider.authToken, isNull);
      expect(authProvider.accessToken, isNull);
      expect(authProvider.rawRefreshToken, isNull);
      expect(authProvider.currentUser, isNull);
      expect(authProvider.isLoading, isFalse);
      expect(authProvider.isRequestingOtp, isFalse);
      expect(authProvider.isVerifyingOtp, isFalse);
      expect(authProvider.errorMessage, isNull);
    });

    test('Clear error message resets error state', () {
      authProvider.clearError();
      expect(authProvider.errorMessage, isNull);
    });

    test('TokenStorage saves and clears tokens cleanly', () async {
      await TokenStorage.saveTokens(
        accessToken: 'access_123',
        refreshToken: 'refresh_456',
      );

      expect(await TokenStorage.getAccessToken(), equals('access_123'));
      expect(await TokenStorage.getRefreshToken(), equals('refresh_456'));

      await TokenStorage.clearAll();

      expect(await TokenStorage.getAccessToken(), isNull);
      expect(await TokenStorage.getRefreshToken(), isNull);
    });

    test('Logout clears all local credentials and resets auth state', () async {
      await TokenStorage.saveTokens(
        accessToken: 'token_abc',
        refreshToken: 'refresh_abc',
      );

      await authProvider.logout();

      expect(authProvider.isAuthenticated, isFalse);
      expect(authProvider.currentUser, isNull);
      expect(authProvider.accessToken, isNull);
      expect(await TokenStorage.getAccessToken(), isNull);
    });

    test('Restore session returns false when no tokens stored', () async {
      final restored = await authProvider.restoreSession();
      expect(restored, isFalse);
      expect(authProvider.isAuthenticated, isFalse);
    });
  });

  group('ApiException Tests', () {
    test('Correctly captures status code and user-friendly error message', () {
      final exception = ApiException(401, 'Invalid OTP code', code: 'INVALID_OTP');
      expect(exception.statusCode, equals(401));
      expect(exception.message, equals('Invalid OTP code'));
      expect(exception.code, equals('INVALID_OTP'));
      expect(exception.toString(), equals('Invalid OTP code'));
    });
  });

  // Regression coverage for a real bug found via live backend verification:
  // extractAuthTokens() previously only looked for a nested `tokens` object
  // that the backend never actually sends, so every OTP verify / refresh
  // silently failed with "Invalid response from authentication server"
  // regardless of whether the OTP was correct. These use the exact response
  // shape captured from a running instance of auth.service.ts.
  group('extractAuthTokens (regression: real backend returns tokens flat)', () {
    test('parses the real POST /auth/otp/verify response shape', () {
      final data = {
        'access_token': 'eyJhbGciOiJIUzI1NiIs...',
        'refresh_token': '95939582d11516f19ec4149bd52b3b8bab436df',
        'token_type': 'Bearer',
        'expires_in': 900,
        'user': {
          'id': '4b9d5dee-4afd-4ec6-9e4e-fa5ee5973089',
          'phone': '+94719643633',
          'role': 'CUSTOMER',
          'full_name': null,
          'email': null,
        },
      };

      final pair = extractAuthTokens(data);

      expect(pair.isComplete, isTrue);
      expect(pair.accessToken, 'eyJhbGciOiJIUzI1NiIs...');
      expect(pair.refreshToken, '95939582d11516f19ec4149bd52b3b8bab436df');
    });

    test('parses the real POST /auth/refresh response shape', () {
      final data = {
        'access_token': 'eyJhbGciOiJIUzI1NiIs...new',
        'refresh_token': '48dfed2f9a882e9d6d61feddd134c3e06de52c6',
        'token_type': 'Bearer',
        'expires_in': 900,
      };

      final pair = extractAuthTokens(data);

      expect(pair.isComplete, isTrue);
      expect(pair.accessToken, 'eyJhbGciOiJIUzI1NiIs...new');
    });

    test('still accepts a nested tokens object as a defensive fallback', () {
      final data = {
        'tokens': {
          'accessToken': 'nested-access',
          'refreshToken': 'nested-refresh',
        },
      };

      final pair = extractAuthTokens(data);

      expect(pair.isComplete, isTrue);
      expect(pair.accessToken, 'nested-access');
      expect(pair.refreshToken, 'nested-refresh');
    });

    test('is incomplete when neither shape is present', () {
      final pair = extractAuthTokens({'message': 'something else'});
      expect(pair.isComplete, isFalse);
    });
  });

  group('extractUserJson (regression: GET /auth/me returns the user flat)', () {
    test('parses the real GET /auth/me response shape (flat, no user wrapper)', () {
      final data = {
        'id': '3fbc5e08-2410-4d3f-96dc-f6b672629d80',
        'phone': '+94719643663',
        'email': null,
        'full_name': null,
        'role': 'CUSTOMER',
        'is_active': true,
        'phone_verified_at': '2026-09-17T11:14:23.400Z',
        'created_at': '2026-09-17T11:14:23.399Z',
      };

      final userJson = extractUserJson(data);

      expect(userJson, isNotNull);
      expect(userJson!['id'], '3fbc5e08-2410-4d3f-96dc-f6b672629d80');
    });

    test('still accepts a nested user object (verifyOtp response shape)', () {
      final data = {
        'access_token': 'x',
        'user': {'id': 'nested-id', 'phone': '+94700000000', 'role': 'CUSTOMER'},
      };

      final userJson = extractUserJson(data);

      expect(userJson, isNotNull);
      expect(userJson!['id'], 'nested-id');
    });

    test('returns null when there is no identifiable user object', () {
      expect(extractUserJson({'message': 'ok'}), isNull);
    });
  });
}
