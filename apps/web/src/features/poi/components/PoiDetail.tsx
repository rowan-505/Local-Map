/** Detail strip for the active POI — presentation only. */
import { memo } from 'react';
import type { Poi } from '@/types';
import { poiCategoryLabel } from '../categoryLabel';

export type PoiDetailProps = {
  readonly poi: Poi | undefined;
  readonly isLoading?: boolean;
  readonly error?: Error | null;
};

function PoiDetailInner({ poi, isLoading = false, error = null }: PoiDetailProps) {
  if (isLoading) {
    return <p className="text-xs leading-relaxed text-neutral-500">Loading place details…</p>;
  }

  if (error) {
    return <p className="text-xs leading-relaxed text-red-600">Could not load place details.</p>;
  }

  if (!poi) {
    return (
      <p className="text-xs leading-relaxed text-neutral-500">
        Select a place from the list or map.
      </p>
    );
  }

  const tagPreview = Object.entries(poi.osm_tags)
    .slice(0, 8)
    .map(([k, v]) => `${k}=${v}`)
    .join(', ');

  return (
    <div className="space-y-2 text-sm">
      <div>
        <h3 className="font-semibold leading-snug text-neutral-900">{poi.name}</h3>
        <p className="mt-0.5 text-xs text-neutral-500">
          {poiCategoryLabel(poi.category, poi.categoryName, poi.categoryCode)}
        </p>
        <p className="mt-0.5 text-xs text-neutral-600">{poi.subcategory}</p>
      </div>
      {poi.address ? (
        <p className="text-xs text-neutral-600">
          <span className="text-neutral-500">Address: </span>
          {poi.address}
        </p>
      ) : null}
      {poi.isVerified ? (
        <p className="text-xs font-medium text-emerald-700">Verified place</p>
      ) : null}
      <p className="text-xs text-neutral-500">Source: deployed API</p>
      {tagPreview.length > 0 ? (
        <p className="text-xs leading-relaxed text-neutral-600">
          <span className="text-neutral-500">OSM tags: </span>
          {tagPreview}
          {Object.keys(poi.osm_tags).length > 8 ? '…' : ''}
        </p>
      ) : null}
    </div>
  );
}

export const PoiDetail = memo(PoiDetailInner);
