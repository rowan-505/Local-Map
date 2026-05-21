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

/** Core-review map card header (slate tint). */
export const MAP_PREVIEW_CARD_HEADER_CORE_CLASS =
    "border-b border-slate-200 bg-slate-50 px-3 py-2";

/** Editor map viewport inside {@link MAP_PREVIEW_CARD_CLASS}. */
export const MAP_EDITOR_VIEWPORT_CLASS =
    "relative h-[min(28rem,calc(100vh-22rem))] w-full overflow-hidden rounded-lg border border-slate-200 bg-slate-100 shadow-inner";

/** Building editor slightly taller default. */
export const MAP_EDITOR_VIEWPORT_BUILDING_CLASS =
    "relative h-[420px] w-full overflow-hidden rounded-lg border border-slate-200 bg-slate-100 shadow-inner";

/** Toolbar row below map header on editor cards. */
export const MAP_EDITOR_TOOLBAR_CLASS =
    "flex flex-wrap items-center gap-1.5 border-b border-slate-100 bg-white px-2 py-2";

export function mapEditorBtnBase(active: boolean): string {
    return `rounded-md px-3 py-1.5 text-xs font-medium transition ${
        active
            ? "bg-slate-800 text-white shadow-sm"
            : "bg-white text-slate-800 ring-1 ring-slate-300 hover:bg-slate-50"
    }`;
}

export function mapEditorBtnPrimary(active: boolean): string {
    return `rounded-md px-3 py-1.5 text-xs font-medium transition ${
        active
            ? "bg-sky-800 text-white shadow-sm"
            : "bg-white text-slate-800 ring-1 ring-slate-300 hover:bg-slate-50"
    }`;
}

export function mapEditorBtnSuccess(): string {
    return "rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-emerald-800";
}

export function mapEditorBtnDanger(enabled: boolean): string {
    return `rounded-md px-3 py-1.5 text-xs font-medium ring-1 ring-slate-300 ${
        enabled
            ? "bg-white text-red-800 hover:bg-red-50"
            : "cursor-not-allowed bg-slate-100 text-slate-400"
    }`;
}
