/**
 * Page chrome only: filter strip + main/side split. Map content is injected as a child
 * so `MapView` stays free of route-level layout concerns.
 */
import type { ReactNode } from 'react';

type Props = {
  filter: ReactNode;
  map: ReactNode;
  sidebar: ReactNode;
};

export function HomePageLayout({ filter, map, sidebar }: Props) {
  return (
    <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-neutral-100">
      <div className="absolute inset-0 min-h-0">{map}</div>
      <div className="pointer-events-none absolute inset-x-0 top-0 z-30 px-3 pt-3 sm:px-4 sm:pt-4">
        {filter}
      </div>
      {sidebar}
    </div>
  );
}
