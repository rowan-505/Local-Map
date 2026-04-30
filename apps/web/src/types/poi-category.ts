/** Category ids come from the deployed API/database. */
export type PoiCategoryId = string;

export type PoiCategory = {
  readonly id: PoiCategoryId;
  readonly code: string;
  readonly name: string;
  readonly nameLocal: string | null;
  readonly iconKey: string | null;
  readonly sortOrder: number;
};
