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
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {filter}
      <div className="flex min-h-0 min-w-0 flex-1">
        <div className="relative min-h-0 min-w-0 flex-1">
          <div className="absolute inset-0 min-h-0">{map}</div>
        </div>
        {sidebar}
      </div>
    </div>
  );
}
