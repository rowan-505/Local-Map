/**
 * Kyauktan-only: shapes expected from an Overpass API `out json` export.
 * Not a nationwide or general OSM schema — extend here only as Kyauktan imports need it.
 */

export type OverpassOsmNode = {
  readonly type: 'node';
  readonly id: number;
  readonly lat: number;
  readonly lon: number;
  readonly tags?: Readonly<Record<string, string>>;
};

export type OverpassDocument = {
  readonly elements?: readonly unknown[];
};
