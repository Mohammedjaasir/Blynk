/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  /** Dev builds only: admin phone used by the login page's Skip button. */
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
