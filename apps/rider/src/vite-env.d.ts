/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Required (https, not localhost) for production builds - vite.config.ts fails the build otherwise. */
  readonly VITE_API_BASE_URL?: string;
  /** MapLibre style for the delivery map; defaults to OpenFreeMap Liberty (lib/route.ts). */
  readonly VITE_MAP_STYLE_URL?: string;
  /** Dev builds only: rider phone used by the sign-in page's Skip button. */
  readonly VITE_DEV_RIDER_PHONE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
