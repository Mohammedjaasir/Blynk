/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  /** Dev builds only: rider phone used by the sign-in page's Skip button. */
  readonly VITE_DEV_RIDER_PHONE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
