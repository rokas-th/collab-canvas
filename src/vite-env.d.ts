/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SYNC_HOST?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
