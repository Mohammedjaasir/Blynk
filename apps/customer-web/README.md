# Blynk customer web (PWA)

The new, light customer shop (React + Vite), replacing the Flutter web build at blynk.lk/app in Phase 4.

- `npm run dev` — http://localhost:5177/app/ (needs the API on :4000 and `http://localhost:5177` in its CORS_ORIGINS)
- `npm test` — unit and screen tests
- `npm run build` — production build; `VITE_API_BASE_URL` must be the https API address

Design: docs/redesign/prototype/index.html. Must-keep features: docs/customer-app-redesign-contract.md.
Plans: docs/superpowers/plans/2026-10-13-blynk-customer-web-phase1.md (this phase); phases 2-4 to follow.
