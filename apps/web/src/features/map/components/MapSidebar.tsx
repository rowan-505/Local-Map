import type { ReactNode } from 'react';

export type RouteDestination = {
  readonly label: string;
  readonly coordinates: readonly [number, number];
};

export type SidebarMode =
  | 'search'
  | 'placeDetail'
  | 'address'
  | 'route'
  | 'bus'
  | 'saved'
  | 'more';

type MapSidebarProps = {
  readonly isOpen: boolean;
  readonly activeMode: SidebarMode;
  readonly onCollapse: () => void;
  readonly bottomSheetState: BottomSheetState;
  readonly onBottomSheetStateChange: (state: BottomSheetState) => void;
  readonly searchPanel: ReactNode;
  readonly placeDetailPanel?: ReactNode;
  readonly addressPanel?: ReactNode;
  readonly routePanel?: ReactNode;
  readonly routeDestination?: RouteDestination | null;
  readonly busPanel?: ReactNode;
  readonly savedPanel?: ReactNode;
  readonly morePanel?: ReactNode;
};

export type BottomSheetState = 'collapsed' | 'half' | 'expanded';

export function MapSidebar({
  isOpen,
  activeMode,
  onCollapse,
  bottomSheetState,
  onBottomSheetStateChange,
  searchPanel,
  placeDetailPanel = <PlaceDetailEmptyState />,
  addressPanel = <AddressPanelEmptyState />,
  routePanel,
  routeDestination = null,
  busPanel = <BusPanelPlaceholder />,
  savedPanel = <SavedPanelPlaceholder />,
  morePanel = <MorePanelPlaceholder />,
}: MapSidebarProps) {
  const meta = sidebarModeMeta(activeMode);

  if (!isOpen) return null;

  return (
    <aside
      className={`pointer-events-auto absolute bottom-0 left-0 right-0 z-30 flex min-h-0 flex-col overflow-visible rounded-t-4xl border border-white/85 bg-white/95 shadow-[0_-16px_40px_rgba(15,23,42,0.14)] backdrop-blur-xl transition-all duration-300 ease-out lg:bottom-4 lg:left-22 lg:right-auto lg:top-4 lg:h-auto lg:w-96 lg:rounded-3xl lg:shadow-[0_18px_50px_rgba(15,23,42,0.16)] ${bottomSheetHeightClass(
        bottomSheetState,
      )}`}
      aria-label="Map sidebar"
      aria-expanded={isOpen}
    >
      <div className="shrink-0 border-b border-neutral-100 bg-white/90 px-4 py-2.5 lg:py-3">
        <button
          type="button"
          className="mx-auto mb-2 block h-1.5 w-11 rounded-full bg-neutral-300 transition-colors hover:bg-neutral-400 lg:hidden"
          aria-label="Set bottom sheet to half height"
          onClick={() => onBottomSheetStateChange('half')}
        />
        <SidebarHeader
          eyebrow={meta.eyebrow}
          title={meta.title}
        />
        <BottomSheetControls
          state={bottomSheetState}
          onStateChange={onBottomSheetStateChange}
        />
      </div>

      <button
        type="button"
        className="absolute right-0 top-1/2 z-10 hidden h-9 w-9 translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-neutral-200 bg-white text-neutral-600 shadow-lg shadow-neutral-950/15 transition-colors hover:bg-neutral-50 hover:text-neutral-950 lg:grid"
        aria-label="Collapse sidebar"
        onClick={onCollapse}
      >
        <ChevronLeftIcon />
      </button>

      <div
        className={`min-h-0 flex-1 overflow-y-auto overscroll-contain transition-opacity ${
          bottomSheetState === 'collapsed'
            ? 'pointer-events-none opacity-0 lg:pointer-events-auto lg:opacity-100'
            : 'opacity-100'
        }`}
      >
        <SidebarModeContent
          activeMode={activeMode}
          searchPanel={searchPanel}
          placeDetailPanel={placeDetailPanel}
          addressPanel={addressPanel}
          routePanel={routePanel ?? <RoutePanelPlaceholder destination={routeDestination} />}
          busPanel={busPanel}
          savedPanel={savedPanel}
          morePanel={morePanel}
        />
      </div>
    </aside>
  );
}

function bottomSheetHeightClass(state: BottomSheetState): string {
  if (state === 'collapsed') return 'h-[5.75rem]';
  if (state === 'expanded') return 'h-[86vh]';
  return 'h-[48vh]';
}

export function SidebarHeader({
  eyebrow,
  title,
}: {
  readonly eyebrow: string;
  readonly title: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-sky-600 lg:text-[11px]">
          {eyebrow}
        </p>
        <h1 className="mt-0.5 truncate text-sm font-semibold leading-5 text-neutral-950 lg:text-base">
          {title}
        </h1>
      </div>
    </div>
  );
}

function ChevronLeftIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M10 3.5 5.5 8l4.5 4.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function BottomSheetControls({
  state,
  onStateChange,
}: {
  readonly state: BottomSheetState;
  readonly onStateChange: (state: BottomSheetState) => void;
}) {
  const options: readonly {
    readonly state: BottomSheetState;
    readonly label: string;
  }[] = [
    { state: 'collapsed', label: 'Min' },
    { state: 'half', label: 'Half' },
    { state: 'expanded', label: 'Full' },
  ];

  return (
    <div className="mt-2 grid grid-cols-3 gap-1 rounded-full bg-neutral-100 p-1 lg:hidden">
      {options.map((option) => (
        <button
          type="button"
          key={option.state}
          className={`rounded-full px-2 py-1 text-[11px] font-semibold transition-colors ${
            state === option.state
              ? 'bg-white text-neutral-950 shadow-sm'
              : 'text-neutral-600 hover:bg-white/70'
          }`}
          aria-pressed={state === option.state}
          onClick={() => onStateChange(option.state)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function RoutePanelPlaceholder({
  destination = null,
}: {
  readonly destination?: RouteDestination | null;
}) {
  return (
    <PlaceholderPanel
      eyebrow="Routing"
      title="Routing coming soon"
      body={
        destination
          ? `Destination set: ${destination.label}. Turn-by-turn route planning will live here.`
          : 'Turn-by-turn route planning will live here without covering the map.'
      }
    />
  );
}

export function BusPanelPlaceholder() {
  return (
    <PlaceholderPanel
      eyebrow="Transit"
      title="Bus planner coming soon"
      body="Bus routes, stops, and service details will appear here."
    />
  );
}

export function SavedPanelPlaceholder() {
  return (
    <PlaceholderPanel
      eyebrow="Saved"
      title="Saved places coming soon"
      body="Bookmarks and favorite map locations will appear here."
    />
  );
}

export function MorePanelPlaceholder() {
  return (
    <PlaceholderPanel
      eyebrow="More"
      title="More map tools coming soon"
      body="Additional layers, settings, and Local Map tools will appear here."
    />
  );
}

export function SidebarModeContent({
  activeMode,
  searchPanel,
  placeDetailPanel,
  addressPanel,
  routePanel,
  busPanel,
  savedPanel,
  morePanel,
}: {
  readonly activeMode: SidebarMode;
  readonly searchPanel: ReactNode;
  readonly placeDetailPanel: ReactNode;
  readonly addressPanel: ReactNode;
  readonly routePanel: ReactNode;
  readonly busPanel: ReactNode;
  readonly savedPanel: ReactNode;
  readonly morePanel: ReactNode;
}) {
  if (activeMode === 'placeDetail') return placeDetailPanel;
  if (activeMode === 'address') return addressPanel;
  if (activeMode === 'route') return routePanel;
  if (activeMode === 'bus') return busPanel;
  if (activeMode === 'saved') return savedPanel;
  if (activeMode === 'more') return morePanel;
  return searchPanel;
}

function sidebarModeMeta(mode: SidebarMode): {
  readonly eyebrow: string;
  readonly title: string;
} {
  switch (mode) {
    case 'placeDetail':
      return { eyebrow: 'Place', title: 'Place details' };
    case 'address':
      return { eyebrow: 'Location', title: 'Inspect location' };
    case 'route':
      return { eyebrow: 'Route', title: 'Route planner' };
    case 'bus':
      return { eyebrow: 'Bus', title: 'Bus and transit' };
    case 'saved':
      return { eyebrow: 'Saved', title: 'Saved places' };
    case 'more':
      return { eyebrow: 'More', title: 'More tools' };
    case 'search':
    default:
      return { eyebrow: 'Local Map', title: 'Kyauktan' };
  }
}

function AddressPanelEmptyState() {
  return (
    <PlaceholderPanel
      eyebrow="Location"
      title="Click anywhere on the map"
      body="Inspect coordinates and future address intelligence for a map location."
    />
  );
}

function PlaceDetailEmptyState() {
  return (
    <PlaceholderPanel
      eyebrow="Place"
      title="Select a place"
      body="Choose a place from the list or map to view details."
    />
  );
}

function PlaceholderPanel({
  eyebrow,
  title,
  body,
}: {
  readonly eyebrow: string;
  readonly title: string;
  readonly body: string;
}) {
  return (
    <section className="p-4">
      <div className="rounded-2xl border border-dashed border-neutral-200 bg-neutral-50 p-5">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-neutral-400">
          {eyebrow}
        </p>
        <h2 className="mt-3 text-lg font-semibold text-neutral-950">{title}</h2>
        <p className="mt-2 text-sm leading-6 text-neutral-600">{body}</p>
      </div>
    </section>
  );
}
