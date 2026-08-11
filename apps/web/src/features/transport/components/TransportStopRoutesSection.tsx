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
          <p className="mt-2 text-sm leading-6 text-map-muted">
            No route data.
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
      className="flex w-full flex-col gap-0.5 rounded-map-control border border-map-border bg-map-bg px-3 py-2.5 text-left transition-[color,background-color,border-color,box-shadow,opacity,filter] duration-150 hover:border-map-primary/30 hover:bg-map-surface"
      aria-label={buildRouteChipAriaLabel(route, title, corridor)}
      onClick={() => {
        // Route open-on-map selection is not wired yet; keep the chip stable.
      }}
    >
      <span className="text-sm font-medium leading-5 text-map-ink">{title}</span>
      {route.directionName ? (
        <span className="text-xs leading-5 text-map-muted">{route.directionName}</span>
      ) : null}
      {corridor ? (
        <span className="text-xs leading-5 text-map-muted">{corridor}</span>
      ) : null}
      <span className="map-kicker text-map-muted">
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
