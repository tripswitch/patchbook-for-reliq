/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_SYNC_URL?: string;
  readonly VITE_SYNC_ANON_KEY?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
