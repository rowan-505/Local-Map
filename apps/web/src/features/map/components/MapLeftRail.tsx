import type { ReactNode } from 'react';
import type { SidebarMode } from './MapSidebar';

type RailMode = Extract<SidebarMode, 'search' | 'route' | 'saved' | 'more'>;

type MapLeftRailProps = {
  readonly activeMode: SidebarMode;
  readonly onModeChange: (mode: RailMode) => void;
  /** Account control (sign-in / profile). Pinned to the end of the rail. */
  readonly accountSlot?: ReactNode;
};

const RAIL_ITEMS: readonly {
  readonly mode: RailMode;
  readonly label: string;
  readonly icon: ReactNode;
}[] = [
  { mode: 'search', label: 'Search', icon: <SearchIcon /> },
  { mode: 'route', label: 'Directions', icon: <RouteIcon /> },
  // TODO: Surface bus transit inside Route results instead of the main map rail.
  { mode: 'saved', label: 'Saved', icon: <SavedIcon /> },
  { mode: 'more', label: 'More', icon: <MoreIcon /> },
];

export function MapLeftRail({ activeMode, onModeChange, accountSlot }: MapLeftRailProps) {
  return (
    <nav
      className="pointer-events-auto absolute left-3 top-3 z-40 flex w-auto scale-90 gap-1 rounded-3xl border border-white/80 bg-white/95 p-1 shadow-xl shadow-neutral-950/15 backdrop-blur-xl origin-top-left lg:bottom-4 lg:left-4 lg:top-4 lg:w-16 lg:scale-100 lg:flex-col lg:items-center lg:p-1.5"
      aria-label="Map navigation"
    >
      <div className="hidden h-11 w-11 place-items-center rounded-2xl bg-sky-600 text-sm font-bold text-white shadow-sm shadow-sky-900/20 lg:grid">
        LM
      </div>
      <div className="flex gap-1 lg:min-h-0 lg:flex-1 lg:flex-col lg:items-center lg:pt-2">
        {RAIL_ITEMS.map((item) => {
          const active = isRailItemActive(activeMode, item.mode);

          return (
            <button
              type="button"
              key={item.mode}
              className={`group grid h-11 w-11 place-items-center rounded-2xl transition-all duration-150 ${
                active
                  ? 'bg-sky-600 text-white shadow-md shadow-sky-900/20'
                  : 'text-neutral-500 hover:bg-sky-50 hover:text-sky-700'
              }`}
              aria-label={item.label}
              aria-current={active ? 'page' : undefined}
              title={item.label}
              onClick={() => onModeChange(item.mode)}
            >
              {item.icon}
            </button>
          );
        })}
      </div>
      {accountSlot ? (
        <div className="flex items-center lg:mt-2 lg:flex-col lg:border-t lg:border-neutral-200/70 lg:pt-2">
          {accountSlot}
        </div>
      ) : null}
    </nav>
  );
}

function isRailItemActive(activeMode: SidebarMode, itemMode: RailMode): boolean {
  if (itemMode === 'search') {
    return activeMode === 'search' || activeMode === 'placeDetail' || activeMode === 'transportStopDetail' || activeMode === 'address';
  }

  return activeMode === itemMode;
}

function SearchIcon() {
  return (
    <svg className="h-5 w-5 lg:h-4.5 lg:w-4.5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M10.8 17.1a6.3 6.3 0 1 0 0-12.6 6.3 6.3 0 0 0 0 12.6Z"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path d="m15.3 15.3 4.2 4.2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function RouteIcon() {
  return (
    <svg className="h-5 w-5 lg:h-4.5 lg:w-4.5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M7 17.5c3.7 0 2.2-11 7-11h2.7"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="m14.8 3.8 3 2.7-3 2.7"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M6.8 20.2a2.7 2.7 0 1 0 0-5.4 2.7 2.7 0 0 0 0 5.4Z"
        stroke="currentColor"
        strokeWidth="1.9"
      />
      <path
        d="M7 5.8a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"
        stroke="currentColor"
        strokeWidth="1.9"
      />
      <path
        d="M7 7.8v2.7"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SavedIcon() {
  return (
    <svg className="h-5 w-5 lg:h-4.5 lg:w-4.5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M7 5.5A2.5 2.5 0 0 1 9.5 3h5A2.5 2.5 0 0 1 17 5.5v15L12 17l-5 3.5v-15Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg className="h-5 w-5 lg:h-4.5 lg:w-4.5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M5 12h.01M12 12h.01M19 12h.01"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
      />
    </svg>
  );
}
