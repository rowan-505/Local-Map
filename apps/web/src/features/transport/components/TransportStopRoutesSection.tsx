import { SidebarSectionTitle } from '@/components/ui/sidebarUi';
import { sidebarCard } from '@/components/ui/sidebarTokens';
import type { RouteServingStop } from '@/types';
import { getLocalizedName, type LanguageMode } from '@local-map/localized-name';

export type TransportStopRoutesSectionProps = {
  readonly routes: readonly RouteServingStop[];
  readonly languageMode: LanguageMode;
};

export function TransportStopRoutesSection({
  routes,
  languageMode,
}: TransportStopRoutesSectionProps) {
  return (
    <article className={sidebarCard} aria-label="Routes serving this stop">
      <div className="px-4 py-3.5">
        <SidebarSectionTitle>Routes serving this stop</SidebarSectionTitle>

        {routes.length > 0 ? (
          <ul className="mt-3 grid gap-2" role="list">
            {routes.map((route) => (
              <li key={routeKey(route)}>
                <RouteServingChip route={route} languageMode={languageMode} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm leading-6 text-neutral-500">
            No route information available yet.
          </p>
        )}
      </div>
    </article>
  );
}

function RouteServingChip({
  route,
  languageMode,
}: {
  readonly route: RouteServingStop;
  readonly languageMode: LanguageMode;
}) {
  const publicName = route.publicName
    ? getLocalizedName(
        {
          name_mm: null,
          name_en: route.publicName,
          name: route.publicName,
        },
        languageMode,
      )
    : null;
  const title =
    publicName && publicName !== route.routeCode
      ? `${route.routeCode} · ${publicName}`
      : route.routeCode;
  const corridor =
    route.originName && route.destinationName
      ? `${route.originName} → ${route.destinationName}`
      : route.originName ?? route.destinationName ?? null;

  return (
    <button
      type="button"
      className="flex w-full flex-col gap-0.5 rounded-xl border border-neutral-200 bg-neutral-50/80 px-3 py-2.5 text-left transition-colors hover:border-neutral-300 hover:bg-white"
      aria-label={buildRouteChipAriaLabel(route, title, corridor)}
      onClick={() => {
        // Route open-on-map selection is not wired yet; keep the chip stable.
      }}
    >
      <span className="text-sm font-medium leading-5 text-neutral-900">{title}</span>
      {route.directionName ? (
        <span className="text-xs leading-5 text-neutral-600">{route.directionName}</span>
      ) : null}
      {corridor ? (
        <span className="text-xs leading-5 text-neutral-500">{corridor}</span>
      ) : null}
      <span className="text-[11px] font-medium uppercase tracking-wide text-neutral-400">
        Stop #{route.stopSequence}
      </span>
    </button>
  );
}

function routeKey(route: RouteServingStop): string {
  return `${route.routePublicId}:${route.variantPublicId}:${route.stopSequence}`;
}

function buildRouteChipAriaLabel(
  route: RouteServingStop,
  title: string,
  corridor: string | null,
): string {
  const parts = [title];
  if (route.directionName) parts.push(route.directionName);
  if (corridor) parts.push(corridor);
  parts.push(`stop sequence ${route.stopSequence}`);
  return parts.join(', ');
}
