/* eslint-disable @typescript-eslint/no-namespace, @typescript-eslint/no-unused-vars -- ProcessEnv augmentation */
export {};

declare namespace NodeJS {
  interface ProcessEnv {
    /** Optional `current.json` URL for basemap resolution (see `dashboardBasemapCurrentJsonUrl.ts`). */
    NEXT_PUBLIC_BASEMAP_CURRENT_JSON_URL?: string;
    /** Optional direct `.pmtiles` HTTP(S) URL — when set, skips fetching `current.json`. */
    NEXT_PUBLIC_BASEMAP_PMTILES_URL?: string;
    /**
     * Optional direct overview (z0–z8 whole-country) `.pmtiles` HTTP(S) URL. When set, preview maps
     * layer this national base under the regional basemap; skips overview `current.json`.
     */
    NEXT_PUBLIC_OVERVIEW_PMTILES_URL?: string;
    /** Optional overview `current.json` URL (defaults to shared `DEFAULT_OVERVIEW_CURRENT_JSON_URL`). */
    NEXT_PUBLIC_OVERVIEW_CURRENT_JSON_URL?: string;
    /**
     * DEV ONLY flag ("true"/"1"). When enabled, preview maps load every regional `.pmtiles`
     * archive from the local tile server for full nationwide detail. Ignored in production.
     */
    NEXT_PUBLIC_LOAD_ALL_LOCAL_REGION_PMTILES?: string;
    /** Optional base URL for local region `.pmtiles` archives (default `http://localhost:8080/regions`). */
    NEXT_PUBLIC_LOCAL_REGION_PMTILES_BASE_URL?: string;
    /** Default source snapshot version string for `/import-review` (maps to API `source_snapshot_version`). */
    NEXT_PUBLIC_IMPORT_REVIEW_SNAPSHOT_VERSION?: string;
    /** Optional comma-separated source snapshot presets for `/import-review`. */
    NEXT_PUBLIC_IMPORT_REVIEW_SNAPSHOT_OPTIONS?: string;
    /**
     * @deprecated No longer required — development bypass uses NEXT_PUBLIC_IMPORT_REVIEW_ADMIN_TOKEN alone.
     */
    NEXT_PUBLIC_ALLOW_IMPORT_REVIEW_ADMIN_TOKEN_HEADER?: string;
    /**
     * DEV ONLY symmetric secret echoed as `x-import-review-admin-token` on `/api/import-review/*` and for
     * `/import-review` route bypass when NODE_ENV=development. Must equal API IMPORT_REVIEW_ADMIN_TOKEN.
     * ⚠ Compiled into browser bundle via NEXT_PUBLIC_ — prototyping only.
     */
    NEXT_PUBLIC_IMPORT_REVIEW_ADMIN_TOKEN?: string;
  }
}
