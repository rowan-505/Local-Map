import { SidebarSectionTitle } from '@/components/ui/sidebarUi';
import { sidebarCard } from '@/components/ui/sidebarTokens';
import {
  capNextStopPreviewStops,
  formatPreviewDirectionLabel,
  formatPreviewRouteTitle,
  hasNextStopsPreviewContent,
} from '@/features/transport/transportStopNextStopsPreview';
import type { NextStopPreview, NextStopPreviewStop } from '@/types';
import { getLocalizedName, type LanguageMode } from '@local-map/localized-name';

export type TransportStopNextStopsSectionProps = {
  readonly currentStopName: string;
  readonly previews: readonly NextStopPreview[];
  readonly languageMode: LanguageMode;
};

export function TransportStopNextStopsSection({
  currentStopName,
  previews,
  languageMode,
}: TransportStopNextStopsSectionProps) {
  const groupsWithStops = previews.filter((group) => group.stops.length > 0);

  return (
    <article className={sidebarCard} aria-label="Next stops direction preview">
      <div className="px-4 py-3.5">
        <SidebarSectionTitle>Next stops / direction preview</SidebarSectionTitle>

        {hasNextStopsPreviewContent(previews) ? (
          <ul className="mt-3 space-y-3" role="list">
            {groupsWithStops.map((group) => (
              <li key={variantPreviewKey(group)}>
                <VariantNextStopsPreview
                  group={group}
                  currentStopName={currentStopName}
                  languageMode={languageMode}
                />
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm leading-6 text-neutral-500">
            Next stop information is not available yet.
          </p>
        )}
      </div>
    </article>
  );
}

function VariantNextStopsPreview({
  group,
  currentStopName,
  languageMode,
}: {
  readonly group: NextStopPreview;
  readonly currentStopName: string;
  readonly languageMode: LanguageMode;
}) {
  const nextStops = capNextStopPreviewStops(group.stops);
  const routeTitle = formatPreviewRouteTitle(
    group.routeCode,
    group.publicName
      ? getLocalizedName(
          {
            name_mm: null,
            name_en: group.publicName,
            name: group.publicName,
          },
          languageMode,
        )
      : null,
  );
  const directionLabel = formatPreviewDirectionLabel(group);

  return (
    <div className="rounded-xl border border-neutral-200 bg-neutral-50/80 px-3 py-2.5">
      <div className="mb-2.5">
        <p className="text-sm font-medium leading-5 text-neutral-900">{routeTitle}</p>
        {directionLabel ? (
          <p className="mt-0.5 text-xs leading-5 text-neutral-600">{directionLabel}</p>
        ) : null}
      </div>

      <ol className="relative m-0 list-none p-0" aria-label={`Next stops on ${routeTitle}`}>
        <TimelineStop
          label={currentStopName}
          tone="current"
          isLast={nextStops.length === 0}
        />
        {nextStops.map((stop, index) => (
          <TimelineStop
            key={stop.publicId}
            label={localizedStopName(stop, languageMode)}
            tone="next"
            isLast={index === nextStops.length - 1}
          />
        ))}
      </ol>
    </div>
  );
}

function TimelineStop({
  label,
  tone,
  isLast,
}: {
  readonly label: string;
  readonly tone: 'current' | 'next';
  readonly isLast: boolean;
}) {
  const isCurrent = tone === 'current';

  return (
    <li className="relative flex gap-2.5 pb-3 last:pb-0">
      <div className="flex w-3 shrink-0 flex-col items-center pt-1">
        <span
          className={`block rounded-full ring-2 ring-white ${
            isCurrent ? 'h-2.5 w-2.5 bg-sky-600' : 'h-2 w-2 bg-neutral-300'
          }`}
          aria-hidden="true"
        />
        {!isLast ? (
          <span className="mt-0.5 w-px flex-1 bg-neutral-200" aria-hidden="true" />
        ) : null}
      </div>
      <div className="min-w-0 flex-1 pt-0.5">
        {isCurrent ? (
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-neutral-400">
            Current stop
          </span>
        ) : (
          <span className="text-[10px] font-medium text-neutral-400" aria-hidden="true">
            ↓
          </span>
        )}
        <p
          className={`wrap-break-word text-sm leading-5 ${
            isCurrent ? 'mt-0.5 font-medium text-neutral-900' : 'text-neutral-700'
          }`}
        >
          {label}
        </p>
      </div>
    </li>
  );
}

function localizedStopName(stop: NextStopPreviewStop, languageMode: LanguageMode): string {
  return getLocalizedName(
    {
      name_mm: stop.nameMm,
      name_en: stop.nameEn,
      name: stop.name,
    },
    languageMode,
  );
}

function variantPreviewKey(group: NextStopPreview): string {
  return `${group.routePublicId}:${group.variantPublicId}:${group.stopSequence}`;
}
