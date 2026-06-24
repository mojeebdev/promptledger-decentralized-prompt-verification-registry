/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PROMPT_LEDGER_ADDRESS?: string;
  readonly VITE_0G_API_KEY?: string;
  readonly VITE_0G_ROUTER_API?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}