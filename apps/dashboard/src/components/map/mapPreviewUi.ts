/**
 * Shared dashboard map preview chrome.
 *
 * MapLibre `NavigationControl` is attached **top-right** by `createPlaceBaseMap()` (and by any
 * component that matches that pattern). Use these tokens so Places, Buildings, and pickers
 * stay visually aligned.
 */

/** Places list / detail sidebar preview (MapLibre container). */
export const MAP_PREVIEW_VIEWPORT_PLACES_SIDEBAR =
    "h-[60vh] min-h-[320px] w-full overflow-hidden rounded-lg lg:min-h-[500px]";

/** Create-place coordinate picker and similar form-adjacent maps. */
export const MAP_PREVIEW_VIEWPORT_FORM =
    "h-[400px] w-full overflow-hidden rounded-lg lg:h-[60vh] lg:min-h-[420px]";

/** Streets preview in the admin list/detail aside. */
export const MAP_PREVIEW_VIEWPORT_STREET =
    "h-[45vh] min-h-[360px] w-full overflow-hidden rounded-lg";

/** Compact map in building link/search panels (pick + highlight). */
export const MAP_PREVIEW_VIEWPORT_BUILDING_PANEL =
    "h-[280px] w-full overflow-hidden rounded-lg border border-gray-200 bg-gray-200 shadow-inner";

/** Default outer shell for preview maps (card). */
export const MAP_PREVIEW_CARD_CLASS =
    "overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm";

/** Optional header row inside {@link MAP_PREVIEW_CARD_CLASS}. */
export const MAP_PREVIEW_CARD_HEADER_CLASS =
    "border-b border-gray-100 bg-gray-50 px-3 py-2";
