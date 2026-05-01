/** Category codes come from the deployed API/database and drive public filtering. */
export type PoiCategoryCode = string;
export type PoiCategoryId = string;

export type PoiCategory = {
  readonly id: string;
  readonly code: PoiCategoryCode;
  readonly name: string;
  readonly nameMm: string | null;
  readonly nameLocal: string | null;
  readonly sortOrder: number;
};
