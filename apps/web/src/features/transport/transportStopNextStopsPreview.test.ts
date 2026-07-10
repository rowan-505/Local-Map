import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  capNextStopPreviewStops,
  formatPreviewDirectionLabel,
  formatPreviewRouteTitle,
  hasNextStopsPreviewContent,
} from './transportStopNextStopsPreview';
import type { NextStopPreview, NextStopPreviewStop } from '@/types';

const stop = (sequence: number): NextStopPreviewStop => ({
  stopSequence: sequence,
  id: String(sequence),
  publicId: `00000000-0000-4000-8000-00000000000${sequence}`,
  name: `Stop ${sequence}`,
  nameMm: null,
  nameEn: `Stop ${sequence}`,
  latitude: 16.8,
  longitude: 96.1,
});

const baseGroup: NextStopPreview = {
  routeId: '1',
  routePublicId: '11111111-1111-4111-8111-111111111111',
  routeCode: 'YBS-9',
  publicName: 'Line Nine',
  variantId: '2',
  variantPublicId: '22222222-2222-4222-8222-222222222222',
  variantCode: 'YBS-9-A',
  directionName: 'Outbound',
  destinationName: 'Hledan',
  stopSequence: 4,
  stops: [stop(5), stop(6), stop(7), stop(8)],
};

describe('transportStopNextStopsPreview', () => {
  it('caps downstream stops at three', () => {
    const capped = capNextStopPreviewStops(baseGroup.stops);
    assert.equal(capped.length, 3);
    assert.deepEqual(
      capped.map((item) => item.stopSequence),
      [5, 6, 7],
    );
  });

  it('detects when preview content exists', () => {
    assert.equal(hasNextStopsPreviewContent([baseGroup]), true);
    assert.equal(hasNextStopsPreviewContent([{ ...baseGroup, stops: [] }]), false);
    assert.equal(hasNextStopsPreviewContent([]), false);
  });

  it('formats route title with public name', () => {
    assert.equal(formatPreviewRouteTitle('YBS-9', 'Line Nine'), 'YBS-9 · Line Nine');
    assert.equal(formatPreviewRouteTitle('YBS-9', null), 'YBS-9');
  });

  it('formats direction and destination label', () => {
    assert.equal(formatPreviewDirectionLabel(baseGroup), 'Outbound · Hledan');
    assert.equal(
      formatPreviewDirectionLabel({ ...baseGroup, destinationName: null }),
      'Outbound',
    );
    assert.equal(
      formatPreviewDirectionLabel({ ...baseGroup, directionName: null }),
      'Hledan',
    );
  });
});
