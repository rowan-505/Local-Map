/** Detail strip for the active POI — presentation only. */
import { memo } from 'react';
import type { ReactNode } from 'react';
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
  const coordinates = formatCoordinates(poi.longitude, poi.latitude);
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${poi.latitude},${poi.longitude}`;

  return (
    <div className="space-y-4 text-sm">
      <div className="rounded-2xl bg-neutral-50 p-3 ring-1 ring-neutral-100">
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
          Place
        </p>
        <h3 className="text-base font-semibold leading-snug text-neutral-950">{poi.name}</h3>
        <p className="mt-1 text-xs text-neutral-500">
          {poiCategoryLabel(poi.category, poi.categoryName, poi.categoryCode)}
        </p>
        <p className="mt-1 font-mono text-xs text-neutral-600">{coordinates}</p>
      </div>
      {poi.address ? (
        <p className="text-xs text-neutral-600">
          <span className="text-neutral-500">Address: </span>
          {poi.address}
        </p>
      ) : null}
      {poi.isVerified ? (
        <p className="inline-flex rounded-full bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700">
          Verified place
        </p>
      ) : null}
      <div className="grid grid-cols-2 gap-2">
        <DetailActionButton onClick={() => copyText(coordinates)}>
          Copy coords
        </DetailActionButton>
        <a
          className="rounded-xl border border-neutral-200 bg-white px-3 py-2 text-center text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-50"
          href={mapsUrl}
          target="_blank"
          rel="noreferrer"
        >
          Google Maps
        </a>
        <DetailActionButton
          className="col-span-2"
          onClick={() => shareDetail(poi.name, coordinates, mapsUrl)}
        >
          Share
        </DetailActionButton>
      </div>
      <p className="text-xs text-neutral-400">Source: deployed API</p>
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

function formatCoordinates(lng: number, lat: number): string {
  return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
}

function copyText(text: string): void {
  void navigator.clipboard?.writeText(text);
}

function shareDetail(title: string, text: string, url?: string): void {
  if (navigator.share) {
    void navigator.share({ title, text, url });
    return;
  }

  void navigator.clipboard?.writeText([title, text, url].filter(Boolean).join('\n'));
}

function DetailActionButton({
  children,
  className = '',
  onClick,
}: {
  readonly children: ReactNode;
  readonly className?: string;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`rounded-xl border border-neutral-200 bg-white px-3 py-2 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-50 ${className}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
