import type { ReactNode } from 'react';
import { useMapUiText } from '@/features/map/i18n/mapUiText';

export type RouteDestination = {
  readonly label: string;
  readonly coordinates: readonly [number, number];
};

export type SidebarMode =
  | 'search'
  | 'placeDetail'
  | 'transportStopDetail'
  | 'address'
  | 'route'
  | 'bus'
  | 'saved'
  | 'reports'
  | 'more'
  | 'account';

type MapSidebarProps = {
  readonly isOpen: boolean;
  readonly activeMode: SidebarMode;
  readonly onCollapse: () => void;
  readonly bottomSheetState: BottomSheetState;
  readonly onBottomSheetStateChange: (state: BottomSheetState) => void;
  readonly searchPanel: ReactNode;
  readonly placeDetailPanel?: ReactNode;
  readonly transportStopDetailPanel?: ReactNode;
  readonly addressPanel?: ReactNode;
  readonly routePanel?: ReactNode;
  readonly routeDestination?: RouteDestination | null;
  /** Overrides the default "Stop details" sidebar title in transport detail mode. */
  readonly transportStopDetailTitle?: string;
  readonly busPanel?: ReactNode;
  readonly savedPanel?: ReactNode;
  readonly reportsPanel?: ReactNode;
  readonly morePanel?: ReactNode;
  readonly accountPanel?: ReactNode;
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
  transportStopDetailPanel = <TransportStopDetailEmptyState />,
  addressPanel = <AddressPanelEmptyState />,
  routePanel,
  routeDestination = null,
  transportStopDetailTitle,
  busPanel = <BusPanelPlaceholder />,
  savedPanel = <SavedPanelPlaceholder />,
  reportsPanel = null,
  morePanel = <MorePanelPlaceholder />,
  accountPanel = null,
}: MapSidebarProps) {
  const t = useMapUiText();
  const meta = sidebarModeMeta(activeMode, t);
  const headerTitle =
    activeMode === 'transportStopDetail' && transportStopDetailTitle
      ? transportStopDetailTitle
      : meta.title;

  if (!isOpen) return null;

  return (
    <div
      className={`pointer-events-auto absolute bottom-0 left-0 right-0 z-30 min-h-0 transition-all duration-300 ease-out lg:bottom-4 lg:left-22 lg:right-auto lg:top-4 lg:w-96 ${bottomSheetHeightClass(
        bottomSheetState,
      )}`}
    >
      <aside
        className="flex h-full min-h-0 flex-col overflow-hidden rounded-t-4xl border border-white/90 bg-map-bg/95 shadow-[0_-16px_40px_rgba(15,35,70,0.14)] backdrop-blur-xl lg:rounded-3xl lg:shadow-map-float"
        aria-label="Map sidebar"
        aria-expanded={isOpen}
      >
        <div className="shrink-0 border-b border-map-border/70 bg-[linear-gradient(135deg,rgba(255,255,255,0.96),rgba(234,244,255,0.88))] px-4 py-2.5 lg:py-3">
          <button
            type="button"
            className="group mx-auto mb-1 grid h-10 w-16 place-items-center lg:hidden"
            aria-label={t('အောက်ခြေစာမျက်နှာကို တစ်ဝက်ဖွင့်ရန်', 'Set bottom sheet to half height')}
            onClick={() => onBottomSheetStateChange('half')}
          >
            <span className="h-1 w-10 rounded-full bg-map-primary/25 transition-colors group-hover:bg-map-primary/45" />
          </button>
          <SidebarHeader
            eyebrow={meta.eyebrow}
            title={headerTitle}
          />
          <BottomSheetControls
            state={bottomSheetState}
            onStateChange={onBottomSheetStateChange}
          />
        </div>

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
            transportStopDetailPanel={transportStopDetailPanel}
            addressPanel={addressPanel}
            routePanel={routePanel ?? <RoutePanelPlaceholder destination={routeDestination} />}
            busPanel={busPanel}
            savedPanel={savedPanel}
            reportsPanel={reportsPanel}
            morePanel={morePanel}
            accountPanel={accountPanel}
          />
        </div>
      </aside>

      <button
        type="button"
        className="absolute right-0 top-1/2 z-10 hidden h-10 w-10 translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-map-border bg-map-surface text-map-muted shadow-map-control transition-[color,background-color,border-color,box-shadow,opacity,filter] duration-150 hover:border-map-primary/30 hover:bg-map-primary-soft hover:text-map-primary lg:grid"
        aria-label={t('ဘေးဘောင်ကို ပိတ်ရန်', 'Collapse sidebar')}
        onClick={onCollapse}
      >
        <ChevronLeftIcon />
      </button>
    </div>
  );
}

function bottomSheetHeightClass(state: BottomSheetState): string {
  if (state === 'collapsed') return 'h-[5.75rem] lg:h-auto';
  if (state === 'expanded') return 'h-[86vh] lg:h-auto';
  return 'h-[48vh] lg:h-auto';
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
        {eyebrow !== title ? (
          <p className="map-kicker text-map-primary">
            {eyebrow}
          </p>
        ) : null}
        <h1 className={`${eyebrow === title ? '' : 'mt-0.5'} truncate text-sm font-semibold leading-5 text-map-ink`}>
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
  const t = useMapUiText();
  const options: readonly {
    readonly state: BottomSheetState;
    readonly label: string;
  }[] = [
    { state: 'collapsed', label: t('ပိတ်', 'Min') },
    { state: 'half', label: t('တစ်ဝက်', 'Half') },
    { state: 'expanded', label: t('အပြည့်', 'Full') },
  ];

  return (
    <div className="mt-2 grid grid-cols-3 gap-1 rounded-full bg-blue-100/55 p-1 lg:hidden">
      {options.map((option) => (
        <button
          type="button"
          key={option.state}
          className={`min-h-10 rounded-full px-2 py-1.5 text-sm font-semibold transition-[color,background-color,border-color,box-shadow,opacity,filter] duration-150 ${
            state === option.state
              ? 'bg-map-primary text-white shadow-map-control'
              : 'text-map-muted hover:bg-white/80 hover:text-map-primary'
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
  const t = useMapUiText();
  return (
    <PlaceholderPanel
      eyebrow={t('လမ်းညွှန်', 'Routing')}
      title={t('မကြာမီ ရရှိမည်', 'Coming soon')}
      body={
        destination
          ? t(
              `သွားရာ: ${destination.label}`,
              `Destination: ${destination.label}`,
            )
          : t(
              'လမ်းညွှန်စနစ် ပြင်ဆင်နေသည်။',
              'Routing is being prepared.',
            )
      }
    />
  );
}

export function BusPanelPlaceholder() {
  const t = useMapUiText();
  return (
    <PlaceholderPanel
      eyebrow={t('အများသုံးယာဉ်', 'Transit')}
      title={t('မကြာမီ ရရှိမည်', 'Coming soon')}
      body={t(
        'ဘတ်စ်လမ်းကြောင်းနှင့် မှတ်တိုင်များ။',
        'Bus routes and stops.',
      )}
    />
  );
}

export function SavedPanelPlaceholder() {
  const t = useMapUiText();
  return (
    <PlaceholderPanel
      eyebrow={t('သိမ်းထားသည်', 'Saved')}
      title={t('မကြာမီ ရရှိမည်', 'Coming soon')}
      body={t(
        'နှစ်သက်သောနေရာများကို သိမ်းပါ။',
        'Save favorite places.',
      )}
    />
  );
}

export function MorePanelPlaceholder() {
  const t = useMapUiText();
  return (
    <PlaceholderPanel
      eyebrow={t('နောက်ထပ်', 'More')}
      title={t('နောက်ထပ် ကိရိယာများ', 'More tools')}
      body={t(
        'မြေပုံအလွှာများနှင့် ဆက်တင်များ။',
        'Layers and settings.',
      )}
    />
  );
}

export function SidebarModeContent({
  activeMode,
  searchPanel,
  placeDetailPanel,
  transportStopDetailPanel,
  addressPanel,
  routePanel,
  busPanel,
  savedPanel,
  reportsPanel,
  morePanel,
  accountPanel,
}: {
  readonly activeMode: SidebarMode;
  readonly searchPanel: ReactNode;
  readonly placeDetailPanel: ReactNode;
  readonly transportStopDetailPanel: ReactNode;
  readonly addressPanel: ReactNode;
  readonly routePanel: ReactNode;
  readonly busPanel: ReactNode;
  readonly savedPanel: ReactNode;
  readonly reportsPanel: ReactNode;
  readonly morePanel: ReactNode;
  readonly accountPanel: ReactNode;
}) {
  if (activeMode === 'placeDetail') return placeDetailPanel;
  if (activeMode === 'transportStopDetail') return transportStopDetailPanel;
  if (activeMode === 'address') return addressPanel;
  if (activeMode === 'route') return routePanel;
  if (activeMode === 'bus') return busPanel;
  if (activeMode === 'saved') return savedPanel;
  if (activeMode === 'reports') return reportsPanel;
  if (activeMode === 'more') return morePanel;
  if (activeMode === 'account') return accountPanel;
  return searchPanel;
}

function sidebarModeMeta(
  mode: SidebarMode,
  t: (myanmar: string, english: string) => string,
): {
  readonly eyebrow: string;
  readonly title: string;
} {
  switch (mode) {
    case 'placeDetail':
      return { eyebrow: t('နေရာ', 'Place'), title: t('နေရာအချက်အလက်', 'Place details') };
    case 'transportStopDetail':
      return {
        eyebrow: t('အများသုံးယာဉ်', 'Transit'),
        title: t('မှတ်တိုင်အချက်အလက်', 'Stop details'),
      };
    case 'address':
      return { eyebrow: t('တည်နေရာ', 'Location'), title: t('တည်နေရာစစ်ဆေးရန်', 'Inspect location') };
    case 'route':
      return { eyebrow: t('လမ်းညွှန်', 'Directions'), title: t('လမ်းညွှန်', 'Directions') };
    case 'bus':
      return { eyebrow: t('ဘတ်စ်', 'Bus'), title: t('ဘတ်စ်နှင့် အများသုံးယာဉ်', 'Bus and transit') };
    case 'saved':
      return { eyebrow: t('သိမ်းထားသည်', 'Saved'), title: t('သိမ်းထားသောနေရာများ', 'Saved places') };
    case 'reports':
      return { eyebrow: t('တိုင်ကြားချက်များ', 'Reports'), title: t('ကျွန်ုပ်၏ တိုင်ကြားချက်များ', 'My reports') };
    case 'more':
      return { eyebrow: t('နောက်ထပ်', 'More'), title: t('နောက်ထပ် ကိရိယာများ', 'More tools') };
    case 'account':
      return { eyebrow: t('အကောင့်', 'Account'), title: t('သင့်အကောင့်', 'Your account') };
    case 'search':
    default:
      return { eyebrow: t('ဒေသမြေပုံ', 'Local Map'), title: t('ကျောက်တန်း', 'Kyauktan') };
  }
}

function TransportStopDetailEmptyState() {
  const t = useMapUiText();
  return (
    <PlaceholderPanel
      eyebrow={t('အများသုံးယာဉ်', 'Transit')}
      title={t('မှတ်တိုင်ရွေးပါ', 'Select a stop')}
      body={t(
        'မြေပုံမှ မှတ်တိုင်ရွေးပါ။',
        'Choose a stop on the map.',
      )}
    />
  );
}

function AddressPanelEmptyState() {
  const t = useMapUiText();
  return (
    <PlaceholderPanel
      eyebrow={t('တည်နေရာ', 'Location')}
      title={t('မြေပုံပေါ်တွင် နှိပ်ပါ', 'Click anywhere on the map')}
      body={t(
        'လိပ်စာနှင့် ကိုဩဒိနိတ်ကြည့်ပါ။',
        'View address and coordinates.',
      )}
    />
  );
}

function PlaceDetailEmptyState() {
  const t = useMapUiText();
  return (
    <PlaceholderPanel
      eyebrow={t('နေရာ', 'Place')}
      title={t('နေရာရွေးပါ', 'Select a place')}
      body={t(
        'စာရင်း သို့မဟုတ် မြေပုံမှ ရွေးပါ။',
        'Choose from the list or map.',
      )}
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
      <div className="rounded-map-card border border-dashed border-map-primary/25 bg-map-primary-soft/55 p-5 shadow-map-card">
        <div className="mb-4 grid h-10 w-10 place-items-center rounded-2xl bg-map-primary text-white shadow-map-control">
          <PlaceholderIcon />
        </div>
        <p className="map-kicker text-map-primary">
          {eyebrow}
        </p>
        <h2 className="mt-2 text-sm font-semibold leading-5 text-map-ink">{title}</h2>
        <p className="mt-2 text-sm leading-5 text-map-muted">{body}</p>
      </div>
    </section>
  );
}

function PlaceholderIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M3.5 5.5 8 3l4 2 4.5-2.5v12L12 17l-4-2-4.5 2.5v-12Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M8 3v12M12 5v12" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}
