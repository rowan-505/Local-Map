import type { ReactNode } from 'react';
import { useMapUiText } from '@/features/map/i18n/mapUiText';
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
  readonly labelMy: string;
  readonly labelEn: string;
  readonly icon: ReactNode;
}[] = [
  { mode: 'search', labelMy: 'ရှာဖွေရန်', labelEn: 'Search', icon: <SearchIcon /> },
  { mode: 'route', labelMy: 'လမ်းညွှန်', labelEn: 'Directions', icon: <RouteIcon /> },
  // TODO: Surface bus transit inside Route results instead of the main map rail.
  { mode: 'saved', labelMy: 'သိမ်းထားသည်', labelEn: 'Saved', icon: <SavedIcon /> },
  { mode: 'more', labelMy: 'နောက်ထပ်', labelEn: 'More', icon: <MoreIcon /> },
];

export function MapLeftRail({ activeMode, onModeChange, accountSlot }: MapLeftRailProps) {
  const t = useMapUiText();

  return (
    <nav
      className="pointer-events-auto absolute left-3 top-3 z-40 flex w-auto gap-1 rounded-3xl border border-white/85 bg-white/92 p-1 shadow-map-float backdrop-blur-xl lg:bottom-4 lg:left-4 lg:top-4 lg:w-16 lg:flex-col lg:items-center lg:p-1.5"
      aria-label={t('မြေပုံလမ်းညွှန်', 'Map navigation')}
    >
      <div className="hidden h-11 w-11 place-items-center rounded-2xl bg-[linear-gradient(135deg,#0f68e8,#087c8f)] text-sm font-bold tracking-tight text-white shadow-map-control ring-1 ring-white/35 lg:grid">
        CM
      </div>
      <div className="flex gap-1 lg:min-h-0 lg:flex-1 lg:flex-col lg:items-center lg:pt-2">
        {RAIL_ITEMS.map((item) => {
          const active = isRailItemActive(activeMode, item.mode);
          const label = t(item.labelMy, item.labelEn);

          return (
            <button
              type="button"
              key={item.mode}
              className={`group relative grid h-11 w-11 place-items-center rounded-2xl transition-[color,background-color,border-color,box-shadow,opacity,filter] duration-150 ${
                active
                  ? 'bg-map-primary text-white shadow-map-control'
                  : 'text-map-muted hover:bg-map-primary-soft hover:text-map-primary'
              }`}
              aria-label={label}
              aria-current={active ? 'page' : undefined}
              title={label}
              onClick={() => onModeChange(item.mode)}
            >
              {item.icon}
            </button>
          );
        })}
      </div>
      {accountSlot ? (
        <div className="flex items-center lg:mt-2 lg:flex-col lg:border-t lg:border-map-border/70 lg:pt-2">
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
