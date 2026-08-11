import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, it } from 'node:test';

import {
  assertReviewOnlyPackageItems,
  importReviewTableQualified,
  IMPORT_REVIEW_CLASSES,
  isImportReviewClass,
  type EntityFamilySlug,
} from './remote-review-entity-config.js';

const CUTOVER_FAMILIES = [
  'places',
  'roads',
  'buildings',
  'landuse',
  'water_lines',
  'water_polygons',
  'routing_barriers',
] as const satisfies readonly EntityFamilySlug[];

const EXPECTED_TABLES: Record<(typeof CUTOVER_FAMILIES)[number], string> = {
  places: 'import_review.place_candidates',
  roads: 'import_review.road_candidates',
  buildings: 'import_review.building_candidates',
  landuse: 'import_review.landuse_candidates',
  water_lines: 'import_review.water_line_candidates',
  water_polygons: 'import_review.water_polygon_candidates',
  routing_barriers: 'import_review.routing_barrier_candidates',
};

describe('Import Review class routing', () => {
  it('accepts only genuine human-review classes', () => {
    assert.deepEqual(IMPORT_REVIEW_CLASSES, [
      'duplicate',
      'conflict',
      'manual_protected',
      'verified_conflict',
      'possible_delete',
    ]);
    for (const importClass of IMPORT_REVIEW_CLASSES) {
      assert.equal(isImportReviewClass(importClass), true);
    }
  });

  it('rejects direct-Core, no-write, invalid, and PMTiles classes', () => {
    for (const importClass of [
      'safe_new',
      'safe_update',
      'unchanged',
      'invalid',
      'pmtiles_only',
      '',
      null,
      undefined,
    ]) {
      assert.equal(isImportReviewClass(importClass), false);
    }
  });

  it('maps every cutover family to its existing candidate table', () => {
    for (const family of CUTOVER_FAMILIES) {
      assert.equal(importReviewTableQualified(family), EXPECTED_TABLES[family]);
    }
  });

  it('accepts one genuine review package item per family', () => {
    assert.doesNotThrow(() =>
      assertReviewOnlyPackageItems(
        CUTOVER_FAMILIES.map((family, index) => ({
          entity_family: family,
          local_staging_id: String(index + 1),
          payload: {
            import_class: IMPORT_REVIEW_CLASSES[index % IMPORT_REVIEW_CLASSES.length],
          },
        }))
      )
    );
  });

  it('fails closed before upload when any package item is not review-only', () => {
    for (const importClass of [
      'safe_new',
      'safe_update',
      'unchanged',
      'invalid',
      'pmtiles_only',
      undefined,
    ]) {
      assert.throws(
        () =>
          assertReviewOnlyPackageItems([
            {
              entity_family: 'places',
              local_staging_id: '1',
              payload: { import_class: importClass },
            },
          ]),
        /Stage K refuses non-review package item/
      );
    }
  });

  it('keeps the Stage J exporter conflict-only and the Stage K guard before remote writes', () => {
    const stageJ = fs.readFileSync(
      new URL('./11_prepare_remote_review_package.sql', import.meta.url),
      'utf8'
    );
    const stageK = fs.readFileSync(
      new URL('./12_upload_remote_review_package.ts', import.meta.url),
      'utf8'
    );
    const runner = fs.readFileSync(
      new URL('./run_local_osm_pipeline.sh', import.meta.url),
      'utf8'
    );

    assert.match(stageJ, /full-candidate Import Review packages are retired/);
    assert.match(stageJ, /pipeline_ir_conflict_classes/);
    assert.match(stageJ, /'import_class', 'possible_delete'/);

    const fetchIndex = stageK.indexOf('const itemsAll = await fetchItems');
    const guardIndex = stageK.indexOf('assertReviewOnlyPackageItems(itemsAll)');
    const writeIndex = stageK.indexOf(
      'const batchId = await upsertReviewBatch'
    );
    assert.ok(fetchIndex >= 0);
    assert.ok(guardIndex > fetchIndex);
    assert.ok(writeIndex > guardIndex);

    assert.match(runner, /-v conflict_only=true/);
    assert.match(runner, /full-candidate Import Review packages are retired/);
  });
});
