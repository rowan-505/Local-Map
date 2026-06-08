import { describe, expect, it } from 'vitest';
import {
  isYangonRegionalBasemapUrl,
  shouldUseYangonRoadLabelsOverlay,
} from './yangonRoadLabelsOverlayConfig';

describe('isYangonRegionalBasemapUrl', () => {
  it('matches Yangon regional paths and filenames', () => {
    expect(
      isYangonRegionalBasemapUrl('http://localhost:8080/regions/yangon/yangon-v2.pmtiles'),
    ).toBe(true);
    expect(isYangonRegionalBasemapUrl('https://cdn.example/yangon-v1.pmtiles')).toBe(true);
    expect(isYangonRegionalBasemapUrl('http://localhost:8080/regions/bago/bago-v1.pmtiles')).toBe(
      false,
    );
  });
});

describe('shouldUseYangonRoadLabelsOverlay', () => {
  it('is off unless VITE_YANGON_ROAD_LABELS_OVERLAY is explicitly enabled', () => {
    expect(shouldUseYangonRoadLabelsOverlay()).toBe(false);
  });
});
