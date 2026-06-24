/**
 * Stage J/K entity mapping: local staging package items → Supabase import_review.*
 * Read-only upload workspace — never promotes to core.
 *
 * Candidate tables (Stage 12):
 *   admin_areas → import_review.admin_area_candidates
 *   roads       → import_review.road_candidates
 */

export const REMOTE_REVIEW_ENTITY_FAMILIES = [
  'buildings',
  'places',
  'roads',
  'landuse',
  'water_lines',
  'water_polygons',
  'addresses',
  'address_components',
  'place_address_links',
  'admin_areas',
  'routing_barriers',
] as const;

export type EntityFamilySlug = (typeof REMOTE_REVIEW_ENTITY_FAMILIES)[number];

export type ChildStagingRelation = {
  /** Staging child table (names or components). */
  childTable: string;
  /** FK column on child pointing to parent staging row. */
  parentFkColumn: string;
  /** Key stored under normalized_data / source_refs on the package item. */
  packageKey: string;
  /** Child row shape for promotion (subset of columns). */
  childColumns: string[];
};

export type EntityFamilyUploadConfig = {
  entityFamily: EntityFamilySlug;
  stagingTable: string;
  importReviewTable: string;
  matchedCoreTable: string | null;
  /** Diff run entity_family slug (usually same as entityFamily). */
  diffEntityFamily: EntityFamilySlug;
  /** Primary geometry column on import_review (null = no required geom). */
  primaryGeomColumn: string | null;
  /** Staging geometry source: point_geom | geom | point_geom+geom */
  stagingGeomMode: 'geom' | 'point_geom' | 'geom_and_centroid' | 'point_or_geom' | 'none';
  requiredImportColumns: string[];
  optionalImportColumns: string[];
  childRelations: ChildStagingRelation[];
  /** Non-candidate child/link uploads do not use the generic candidate flush path. */
  uploadMode?: 'candidate' | 'address_components' | 'place_address_links';
};

const childNameColumns = [
  'id',
  'external_id',
  'name',
  'language_code',
  'script_code',
  'name_type',
  'is_primary',
  'search_weight',
  'source_refs',
  'normalized_data',
] as const;

const childAddressComponentColumns = [
  'id',
  'component_type_code',
  'component_value',
  'language_code',
  'sort_order',
  'source_tag',
  'source_refs',
  'normalized_data',
] as const;

export const ENTITY_FAMILY_UPLOAD_CONFIG: Record<EntityFamilySlug, EntityFamilyUploadConfig> = {
  buildings: {
    entityFamily: 'buildings',
    stagingTable: 'staging_building_candidates',
    importReviewTable: 'building_candidates',
    matchedCoreTable: 'core_map_buildings',
    diffEntityFamily: 'buildings',
    primaryGeomColumn: 'geom',
    stagingGeomMode: 'geom',
    requiredImportColumns: [
      'review_batch_id',
      'source_snapshot_version',
      'local_staging_id',
      'entity_family',
      'normalized_data',
      'source_refs',
    ],
    optionalImportColumns: ['name', 'building_type', 'building_type_id', 'admin_area_id', 'levels', 'height_m', 'area_m2', 'geom', 'centroid'],
    childRelations: [],
  },
  places: {
    entityFamily: 'places',
    stagingTable: 'staging_place_candidates',
    importReviewTable: 'place_candidates',
    matchedCoreTable: 'core_places',
    diffEntityFamily: 'places',
    primaryGeomColumn: 'point_geom',
    stagingGeomMode: 'point_geom',
    requiredImportColumns: [
      'review_batch_id',
      'source_snapshot_version',
      'local_staging_id',
      'entity_family',
      'normalized_data',
      'source_refs',
    ],
    optionalImportColumns: ['primary_name', 'display_name', 'category_id', 'place_class_id', 'admin_area_id', 'point_geom', 'lat', 'lng'],
    childRelations: [
      {
        childTable: 'staging_place_name_candidates',
        parentFkColumn: 'place_candidate_id',
        packageKey: 'place_name_candidates',
        childColumns: [...childNameColumns],
      },
    ],
  },
  roads: {
    entityFamily: 'roads',
    stagingTable: 'staging_road_candidates',
    importReviewTable: 'road_candidates',
    matchedCoreTable: 'core_streets',
    diffEntityFamily: 'roads',
    primaryGeomColumn: 'geom',
    stagingGeomMode: 'geom',
    requiredImportColumns: [
      'review_batch_id',
      'source_snapshot_version',
      'local_staging_id',
      'entity_family',
      'normalized_data',
      'source_refs',
    ],
    optionalImportColumns: [
      'road_class_id',
      'road_class',
      'surface',
      'is_oneway',
      'bridge',
      'tunnel',
      'layer',
      'length_m',
      'geom',
    ],
    childRelations: [
      {
        childTable: 'staging_road_name_candidates',
        parentFkColumn: 'road_candidate_id',
        packageKey: 'road_name_candidates',
        childColumns: [...childNameColumns],
      },
    ],
  },
  landuse: {
    entityFamily: 'landuse',
    stagingTable: 'staging_landuse_candidates',
    importReviewTable: 'landuse_candidates',
    matchedCoreTable: 'core_map_landuse',
    diffEntityFamily: 'landuse',
    primaryGeomColumn: 'geom',
    stagingGeomMode: 'geom',
    requiredImportColumns: [
      'review_batch_id',
      'source_snapshot_version',
      'local_staging_id',
      'entity_family',
      'normalized_data',
      'source_refs',
    ],
    optionalImportColumns: ['name', 'geom', 'centroid'],
    childRelations: [],
  },
  water_lines: {
    entityFamily: 'water_lines',
    stagingTable: 'staging_water_line_candidates',
    importReviewTable: 'water_line_candidates',
    matchedCoreTable: 'core_map_water_lines',
    diffEntityFamily: 'water_lines',
    primaryGeomColumn: 'geom',
    stagingGeomMode: 'geom',
    requiredImportColumns: [
      'review_batch_id',
      'source_snapshot_version',
      'local_staging_id',
      'entity_family',
      'normalized_data',
      'source_refs',
    ],
    optionalImportColumns: ['name', 'geom'],
    childRelations: [],
  },
  water_polygons: {
    entityFamily: 'water_polygons',
    stagingTable: 'staging_water_polygon_candidates',
    importReviewTable: 'water_polygon_candidates',
    matchedCoreTable: 'core_map_water_polygons',
    diffEntityFamily: 'water_polygons',
    primaryGeomColumn: 'geom',
    stagingGeomMode: 'geom_and_centroid',
    requiredImportColumns: [
      'review_batch_id',
      'source_snapshot_version',
      'local_staging_id',
      'entity_family',
      'normalized_data',
      'source_refs',
    ],
    optionalImportColumns: ['name', 'geom', 'centroid'],
    childRelations: [],
  },
  addresses: {
    entityFamily: 'addresses',
    stagingTable: 'staging_address_candidates',
    importReviewTable: 'address_candidates',
    matchedCoreTable: 'core_addresses',
    diffEntityFamily: 'addresses',
    primaryGeomColumn: 'point_geom',
    stagingGeomMode: 'point_or_geom',
    requiredImportColumns: [
      'review_batch_id',
      'source_snapshot_version',
      'local_staging_id',
      'entity_family',
      'normalized_data',
      'source_refs',
    ],
    optionalImportColumns: [
      'full_address',
      'house_number',
      'unit_number',
      'street_name',
      'quarter',
      'suburb',
      'township',
      'city',
      'district',
      'state_region',
      'postcode',
      'country',
      'postal_code',
      'plus_code',
      'point_geom',
      'entrance_geom',
    ],
    childRelations: [
      {
        childTable: 'staging_address_component_candidates',
        parentFkColumn: 'address_candidate_id',
        packageKey: 'address_components',
        childColumns: [...childAddressComponentColumns],
      },
    ],
  },
  address_components: {
    entityFamily: 'address_components',
    stagingTable: 'staging_address_component_candidates',
    importReviewTable: 'address_components',
    matchedCoreTable: null,
    diffEntityFamily: 'addresses',
    primaryGeomColumn: null,
    stagingGeomMode: 'none',
    requiredImportColumns: [
      'address_candidate_id',
      'component_type_code',
      'component_value',
      'language_code',
      'source_refs',
      'normalized_data',
    ],
    optionalImportColumns: ['source_tag', 'sort_order', 'confidence_score'],
    childRelations: [],
    uploadMode: 'address_components',
  },
  place_address_links: {
    entityFamily: 'place_address_links',
    stagingTable: 'staging_place_address_link_candidates',
    importReviewTable: 'place_address_links',
    matchedCoreTable: null,
    diffEntityFamily: 'addresses',
    primaryGeomColumn: null,
    stagingGeomMode: 'none',
    requiredImportColumns: [
      'review_batch_id',
      'place_candidate_id',
      'address_candidate_id',
      'relation_type',
      'source_refs',
      'normalized_data',
    ],
    optionalImportColumns: [
      'external_id',
      'is_primary',
      'confidence_score',
      'match_status',
      'auto_action',
      'review_status',
      'validation_status',
      'promotion_status',
    ],
    childRelations: [],
    uploadMode: 'place_address_links',
  },
  admin_areas: {
    entityFamily: 'admin_areas',
    stagingTable: 'staging_admin_area_candidates',
    importReviewTable: 'admin_area_candidates',
    matchedCoreTable: 'core_admin_areas',
    diffEntityFamily: 'admin_areas',
    primaryGeomColumn: 'geom',
    stagingGeomMode: 'geom_and_centroid',
    requiredImportColumns: [
      'review_batch_id',
      'source_snapshot_version',
      'local_staging_id',
      'entity_family',
      'normalized_data',
      'source_refs',
    ],
    optionalImportColumns: ['parent_id', 'admin_level_id', 'slug', 'geom', 'centroid'],
    childRelations: [
      {
        childTable: 'staging_admin_area_name_candidates',
        parentFkColumn: 'admin_area_candidate_id',
        packageKey: 'names',
        childColumns: [...childNameColumns],
      },
    ],
  },
  routing_barriers: {
    entityFamily: 'routing_barriers',
    stagingTable: 'staging_routing_barrier_candidates',
    importReviewTable: 'routing_barrier_candidates',
    matchedCoreTable: null,
    diffEntityFamily: 'routing_barriers',
    primaryGeomColumn: 'point_geom',
    stagingGeomMode: 'point_or_geom',
    requiredImportColumns: [
      'review_batch_id',
      'source_snapshot_version',
      'local_staging_id',
      'entity_family',
      'normalized_data',
      'source_refs',
    ],
    optionalImportColumns: ['barrier_type', 'point_geom'],
    childRelations: [],
  },
};

export function isEntityFamilySlug(v: string): v is EntityFamilySlug {
  return (REMOTE_REVIEW_ENTITY_FAMILIES as readonly string[]).includes(v);
}

/** Clamp/validate pipeline confidence scores (0–100 scale). */
export function parseConfidenceScore(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const s = typeof raw === 'number' ? String(raw) : raw.trim();
  if (s === '') return null;
  const n = Number(s);
  if (!Number.isFinite(n)) {
    throw new Error(`confidence_score is not numeric: ${String(raw).slice(0, 64)}`);
  }
  if (n < 0 || n > 100) {
    throw new Error(`confidence_score must be 0–100, got ${n}`);
  }
  return n;
}

/** Parse `--entity-family=all|admin_areas,roads` or env string. null = all families. */
export function parseEntityFamilyFilter(raw: string | undefined): EntityFamilySlug[] | null {
  const s = (raw ?? '').trim().toLowerCase();
  if (s === '' || s === 'all' || s === '*') return null;
  const parts = s.split(',').map((p) => p.trim()).filter(Boolean);
  const out: EntityFamilySlug[] = [];
  for (const p of parts) {
    if (!isEntityFamilySlug(p)) {
      throw new Error(
        `unsupported entity family "${p}"; allowed: ${REMOTE_REVIEW_ENTITY_FAMILIES.join(', ')}`
      );
    }
    if (!out.includes(p)) out.push(p);
  }
  if (out.length === 0) return null;
  return out;
}

/** Families with at least one package item row (source of truth for Stage 12). */
export function familiesFromPackageItemCounts(
  counts: Partial<Record<EntityFamilySlug, number>>
): EntityFamilySlug[] {
  return REMOTE_REVIEW_ENTITY_FAMILIES.filter((f) => (counts[f] ?? 0) > 0);
}

export function resolveEntityFamiliesForUpload(params: {
  /** Families present in system_remote_review_package_items (source of truth). */
  itemFamilies: EntityFamilySlug[];
  /** null = all itemFamilies; otherwise intersection with itemFamilies. */
  filter: EntityFamilySlug[] | null;
}): EntityFamilySlug[] {
  const itemSet = new Set(params.itemFamilies);
  const orderedItems = REMOTE_REVIEW_ENTITY_FAMILIES.filter((f) => itemSet.has(f));
  if (params.filter === null) {
    return orderedItems;
  }
  const filterSet = new Set(params.filter);
  return REMOTE_REVIEW_ENTITY_FAMILIES.filter((f) => filterSet.has(f) && itemSet.has(f));
}

/** Families requested by filter but absent from package_items (zero rows). */
export function filterFamiliesWithoutPackageItems(params: {
  filter: EntityFamilySlug[] | null;
  packageItemCounts: Record<EntityFamilySlug, number>;
}): EntityFamilySlug[] {
  if (params.filter === null) return [];
  return params.filter.filter((f) => (params.packageItemCounts[f] ?? 0) === 0);
}

export function importReviewTableQualified(family: EntityFamilySlug): string {
  return `import_review.${ENTITY_FAMILY_UPLOAD_CONFIG[family].importReviewTable}`;
}

export function emptyPerFamilyCounts(): Record<EntityFamilySlug, number> {
  return Object.fromEntries(
    REMOTE_REVIEW_ENTITY_FAMILIES.map((f) => [f, 0])
  ) as Record<EntityFamilySlug, number>;
}

export function emptyPerFamilyUploadStats(): Record<
  EntityFamilySlug,
  {
    selected: number;
    inserted: number;
    updated_pending: number;
    preserved_remote: number;
    skipped: number;
    failed: number;
  }
> {
  return Object.fromEntries(
    REMOTE_REVIEW_ENTITY_FAMILIES.map((f) => [
      f,
      { selected: 0, inserted: 0, updated_pending: 0, preserved_remote: 0, skipped: 0, failed: 0 },
    ])
  ) as Record<
    EntityFamilySlug,
    {
      selected: number;
      inserted: number;
      updated_pending: number;
      preserved_remote: number;
      skipped: number;
      failed: number;
    }
  >;
}
