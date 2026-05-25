import type { ReactNode } from 'react';

type Props = {
  leftRail?: ReactNode;
  map: ReactNode;
  sidebar: ReactNode;
  floatingControls?: ReactNode;
};

export function MapShell({ leftRail, map, sidebar, floatingControls }: Props) {
  return (
    <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-neutral-100">
      {map}
      {leftRail}
      {sidebar}
      {floatingControls}
    </div>
  );
}

export function MapViewport({ children }: { readonly children: ReactNode }) {
  return <main className="absolute inset-0 min-h-0">{children}</main>;
}
