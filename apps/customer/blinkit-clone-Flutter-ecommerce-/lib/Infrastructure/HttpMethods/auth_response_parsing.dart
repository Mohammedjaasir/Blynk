// Shared by AuthProvider and the Dio 401-refresh interceptor so both parse
// the real backend's auth responses identically, instead of two copies
// that can silently drift apart.
//
// The real backend (auth.service.ts) returns access_token/refresh_token
// flat on the response's `data` object, not nested under a `tokens`
// object - verified directly against a running instance. The nested shape
// is kept only as a defensive fallback.
class AuthTokenPair {
  const AuthTokenPair(this.accessToken, this.refreshToken);
  final String? accessToken;
  final String? refreshToken;
  bool get isComplete => accessToken != null && refreshToken != null;
}

AuthTokenPair extractAuthTokens(Map<String, dynamic> data) {
  final tokens = data['tokens'] as Map<String, dynamic>?;
  final accessToken = data['access_token'] ??
      data['accessToken'] ??
      tokens?['accessToken'] ??
      tokens?['access_token'];
  final refreshToken = data['refresh_token'] ??
      data['refreshToken'] ??
      tokens?['refreshToken'] ??
      tokens?['refresh_token'];
  return AuthTokenPair(accessToken?.toString(), refreshToken?.toString());
}

// GET /auth/me returns the user object flat on `data` (data.id, data.phone,
// ...) - verified directly against a running instance - unlike
// verifyOtp()'s response, which nests it under data.user. Handles both.
Map<String, dynamic>? extractUserJson(Map<String, dynamic> data) {
  final candidate = data['user'] ?? data;
  if (candidate is Map && candidate['id'] != null) {
    return candidate.cast<String, dynamic>();
  }
  return null;
}
