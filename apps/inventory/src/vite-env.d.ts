/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  /** Dev builds only: staff phone used by the login page's Skip button. */
  readonly VITE_DEV_INVENTORY_PHONE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
