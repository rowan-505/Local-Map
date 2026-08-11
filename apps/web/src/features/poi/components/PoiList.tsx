/** Scrollable list of visible POIs — click selects the same id the map uses. */
import { memo } from 'react';
import { useMapUiText } from '@/features/map/i18n/mapUiText';
import { useMapUiStore } from '@/features/map/state/mapUiStore';
import { ResultRow } from '@/components/ui/sidebarUi';
import { resultTitleClass } from '@/components/ui/sidebarTokens';
import type { Poi } from '@/types';
import { getLocalizedName } from '@local-map/localized-name';
import { poiCategoryLabel } from '../categoryLabel';
import { getPlaceCategoryStyle } from '../placeCategoryStyle';

export type PoiListProps = {
  readonly pois: readonly Poi[];
  readonly selectedPoiId: string | null;
  readonly onSelectPoiId: (id: string) => void;
  readonly isLoading?: boolean;
  readonly error?: Error | null;
};

function PoiListInner({
  pois,
  selectedPoiId,
  onSelectPoiId,
  isLoading = false,
  error = null,
}: PoiListProps) {
  const t = useMapUiText();
  const languageMode = useMapUiStore((s) => s.languageMode);

  if (isLoading) {
    return (
      <div className="px-4 py-6 text-center text-xs text-map-muted">
        <span className="mx-auto mb-2 block h-5 w-5 animate-spin rounded-full border-2 border-map-primary/20 border-t-map-primary" />
        {t('နေရာများ ဖွင့်နေသည်…', 'Loading places…')}
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50/60 px-4 py-6 text-center text-xs leading-5 text-red-700">
        <p className="font-medium">{t('နေရာများကို ဖွင့်၍မရပါ။', 'Could not load places.')}</p>
        <p className="mt-0.5 text-red-600">
          {t('ချိတ်ဆက်မှုကို စစ်ဆေးပါ။', 'Check your connection.')}
        </p>
      </div>
    );
  }

  if (pois.length === 0) {
    return (
      <div className="px-4 py-6 text-center text-xs text-map-muted">
        <span className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-2xl bg-map-primary-soft text-map-primary">
          <EmptyPlacesIcon />
        </span>
        <p className="font-semibold text-map-ink">{t('နေရာမတွေ့ပါ', 'No places found')}</p>
        <p className="mt-1">{t('စစ်ထုတ်မှု ပြောင်းပါ။', 'Change the filter.')}</p>
      </div>
    );
  }

  return (
    <ul
      className="divide-y divide-map-border/65"
      role="listbox"
      aria-label={t('မြင်ရသောနေရာများ', 'Visible places')}
    >
      {pois.map((poi) => {
        const selected = poi.id === selectedPoiId;
        const title = getLocalizedName(poi, languageMode);
        const categoryLabel = poiCategoryLabel(
          poi.category,
          poi.categoryName,
          poi.categoryCode,
        );
        const avatar = getPlaceCategoryStyle(poi.category, poi.categoryName, poi.categoryCode);

        return (
          <li key={poi.id}>
            <ResultRow
              selected={selected}
              align="center"
              onClick={() => onSelectPoiId(poi.id)}
              leading={
                <span
                  className={`grid h-9 w-9 shrink-0 place-items-center rounded-full border text-xs font-semibold ${avatar.className}`}
                >
                  {avatar.initial}
                </span>
              }
              title={<span className={resultTitleClass(languageMode === 'both')}>{title}</span>}
              subtitle={
                <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-map-muted">
                  <span className="truncate">{categoryLabel}</span>
                  <span className="h-1 w-1 shrink-0 rounded-full bg-map-primary/30" />
                  <span className="shrink-0 text-map-muted/75">{t('အနီးအနား', 'Nearby')}</span>
                </span>
              }
              trailing={
                selected ? (
                  <span className="h-2 w-2 shrink-0 rounded-full bg-map-primary shadow-[0_0_0_3px_rgba(15,104,232,0.12)]" />
                ) : null
              }
            />
          </li>
        );
      })}
    </ul>
  );
}

export const PoiList = memo(PoiListInner);

function EmptyPlacesIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M10 17s5-4.3 5-9a5 5 0 1 0-10 0c0 4.7 5 9 5 9Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M8 8h4M10 6v4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
