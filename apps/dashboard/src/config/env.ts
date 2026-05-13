/* eslint-disable @typescript-eslint/no-namespace, @typescript-eslint/no-unused-vars -- ProcessEnv augmentation */
export {};

declare namespace NodeJS {
  interface ProcessEnv {
    /** Optional `current.json` URL for basemap resolution (see `dashboardBasemapCurrentJsonUrl.ts`). */
    NEXT_PUBLIC_BASEMAP_CURRENT_JSON_URL?: string;
    /** Optional direct `.pmtiles` HTTP(S) URL — when set, skips fetching `current.json`. */
    NEXT_PUBLIC_BASEMAP_PMTILES_URL?: string;
  }
}
