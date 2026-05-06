/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Optional origin + base path if you self-host multiscript `.pbf` ranges (otherwise the default GitHub Pages mirror is used). */
  readonly VITE_MULTISCRIPT_GLYPH_BASE_URL?: string;
}
