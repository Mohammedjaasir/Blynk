/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  /** Dev builds only: operator phone used by the sign-in page's Skip button. */
  readonly VITE_DEV_OPERATOR_PHONE?: string;
  /** LAN test builds only: show Skip sign-in (works only against a development API). */
  readonly VITE_ENABLE_DEV_SKIP?: string;
  /** Optional Google Maps Platform "Static Maps" key for the clinic
   * location pin (task F9, plan §21) - unset in every environment this task
   * can see. Read `components/ClinicLocationMap.tsx`'s doc comment and
   * `docs/06-deployment/google-maps-platform-setup.md` §3 before ever
   * setting this in a real environment - that doc currently says not to
   * enable the Static Maps API project-wide. */
  readonly VITE_GOOGLE_MAPS_STATIC_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
