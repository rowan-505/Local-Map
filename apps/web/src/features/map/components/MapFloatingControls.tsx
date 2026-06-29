import { forwardRef, useEffect, useRef, useState, type ReactNode } from 'react';
import { isMapModeAvailable, type MapMode } from '@/features/map/config';
import type { PlaceLanguageMode } from '@/features/poi/api/publicMapApi';
import { useMapUiStore } from '@/features/map/state/mapUiStore';
import type { BottomSheetState } from './MapSidebar';

type MapFloatingControlsProps = {
  readonly selectedLanguageMode: PlaceLanguageMode;
  readonly onSelectLanguageMode: (mode: PlaceLanguageMode) => void;
  readonly isSidebarOpen: boolean;
  readonly bottomSheetState: BottomSheetState;
  /** Own-user location control, anchored bottom-right with bottom-sheet-aware offset. */
  readonly locationSlot?: ReactNode;
};

type OpenControlsPanel = 'map' | 'language' | null;

const LANGUAGE_OPTIONS: readonly {
  readonly mode: PlaceLanguageMode;
  readonly label: string;
  readonly displayLabel: string;
  readonly popoverLabel: string;
  readonly icon?: ReactNode;
}[] = [
  {
    mode: 'my',
    label: 'Myanmar labels',
    displayLabel: 'မြန်မာ',
    popoverLabel: 'မြန်မာ',
    icon: <LanguageIcon />,
  },
  { mode: 'en', label: 'English labels', displayLabel: 'EN', popoverLabel: 'English' },
  { mode: 'both', label: 'Both label languages', displayLabel: 'Both', popoverLabel: 'Both' },
];

const MAP_TYPE_OPTIONS: readonly {
  readonly id: MapMode;
  readonly label: string;
  readonly displayLabel: string;
  readonly popoverLabel: string;
  readonly icon: ReactNode;
  readonly title?: string;
}[] = [
  { id: 'normal', label: 'Map', displayLabel: 'Map', popoverLabel: 'Map', icon: <MapIcon /> },
  {
    id: 'satellite',
    label: 'Satellite',
    displayLabel: 'Sat',
    popoverLabel: 'Satellite',
    icon: <ImageIcon />,
  },
  {
    id: 'hybrid',
    label: 'Hybrid',
    displayLabel: 'Hybrid',
    popoverLabel: 'Hybrid',
    icon: <LayersIcon />,
  },
];

export function MapFloatingControls({
  selectedLanguageMode,
  onSelectLanguageMode,
  isSidebarOpen,
  bottomSheetState,
  locationSlot,
}: MapFloatingControlsProps) {
  const [openPanel, setOpenPanel] = useState<OpenControlsPanel>(null);
  const controlsDockRef = useRef<HTMLDivElement | null>(null);
  const dispatchUtilityAction = useMapUiStore((s) => s.dispatchUtilityAction);
  const mapMode = useMapUiStore((s) => s.mapMode);
  const setMapMode = useMapUiStore((s) => s.setMapMode);
  const transportOverlayVisible = useMapUiStore((s) => s.transportOverlayVisible);
  const toggleTransportOverlay = useMapUiStore((s) => s.toggleTransportOverlay);
  useEffect(() => {
    if (openPanel === null) return;

    const onPointerDown = (event: PointerEvent) => {
      if (controlsDockRef.current?.contains(event.target as Node)) return;
      setOpenPanel(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenPanel(null);
    };

    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [openPanel]);

  const selectedMapOption =
    MAP_TYPE_OPTIONS.find((option) => option.id === mapMode) ?? MAP_TYPE_OPTIONS[0];
  const selectedLanguageOption =
    LANGUAGE_OPTIONS.find((option) => option.mode === selectedLanguageMode) ??
    LANGUAGE_OPTIONS[0];

  return (
    <div className="pointer-events-none absolute right-3 top-3 z-20 flex origin-top-right flex-col items-end gap-1.5 lg:right-4 lg:top-4">
      <MapRightControls ref={controlsDockRef}>
        <LayerModeSelect
          selectedOption={selectedMapOption}
          isOpen={openPanel === 'map'}
          selectedMode={mapMode}
          onOpenChange={(nextOpen) => setOpenPanel(nextOpen ? 'map' : null)}
          onSelect={(nextMode) => {
            setMapMode(nextMode);
            setOpenPanel(null);
          }}
        />
        <LanguageModeSelect
          selectedOption={selectedLanguageOption}
          isOpen={openPanel === 'language'}
          selectedMode={selectedLanguageMode}
          onOpenChange={(nextOpen) => setOpenPanel(nextOpen ? 'language' : null)}
          onSelect={(nextMode) => {
            onSelectLanguageMode(nextMode);
            setOpenPanel(null);
          }}
        />
        <TransportToggle
          active={transportOverlayVisible}
          onToggle={toggleTransportOverlay}
        />
        <ZoomControls
          onZoomIn={() => dispatchUtilityAction('zoomIn')}
          onZoomOut={() => dispatchUtilityAction('zoomOut')}
        />
      </MapRightControls>
      {locationSlot ? (
        <div
          className={`pointer-events-none fixed right-3 z-20 transition-all duration-300 lg:bottom-8 lg:right-4 ${locateButtonMobilePositionClass(
            isSidebarOpen,
            bottomSheetState,
          )}`}
        >
          {locationSlot}
        </div>
      ) : null}
    </div>
  );
}

const MapRightControls = forwardRef<HTMLDivElement, { readonly children: ReactNode }>(
  function MapRightControls({ children }, ref) {
    return (
      <div
        ref={ref}
        className="pointer-events-auto flex flex-col items-end gap-1.5"
        aria-label="Map controls"
      >
        {children}
      </div>
    );
  },
);

function LayerModeSelect({
  selectedOption,
  selectedMode,
  isOpen,
  onOpenChange,
  onSelect,
}: {
  readonly selectedOption: (typeof MAP_TYPE_OPTIONS)[number];
  readonly selectedMode: MapMode;
  readonly isOpen: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSelect: (mode: MapMode) => void;
}) {
  return (
    <CompactControlSelect
      icon={selectedOption.icon}
      label={selectedOption.displayLabel}
      title="Map mode"
      isOpen={isOpen}
      onOpenChange={onOpenChange}
    >
      {MAP_TYPE_OPTIONS.map((option) => {
        const active = option.id === selectedMode;
        const available = isMapModeAvailable(option.id);

        return (
          <ControlOptionButton
            key={option.id}
            label={option.popoverLabel}
            icon={option.icon}
            active={active}
            disabled={!available}
            title={available ? option.label : option.title ?? `${option.label} coming soon`}
            onClick={() => {
              if (!available) return;
              onSelect(option.id);
            }}
          />
        );
      })}
    </CompactControlSelect>
  );
}

function LanguageModeSelect({
  selectedOption,
  selectedMode,
  isOpen,
  onOpenChange,
  onSelect,
}: {
  readonly selectedOption: (typeof LANGUAGE_OPTIONS)[number];
  readonly selectedMode: PlaceLanguageMode;
  readonly isOpen: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSelect: (mode: PlaceLanguageMode) => void;
}) {
  return (
    <CompactControlSelect
      icon={<LanguageIcon />}
      label={selectedOption.displayLabel}
      title="Label language"
      isOpen={isOpen}
      onOpenChange={onOpenChange}
    >
      {LANGUAGE_OPTIONS.map((option) => (
        <ControlOptionButton
          key={option.mode}
          label={option.popoverLabel}
          icon={option.icon}
          active={option.mode === selectedMode}
          title={option.label}
          onClick={() => onSelect(option.mode)}
        />
      ))}
    </CompactControlSelect>
  );
}

function CompactControlSelect({
  icon,
  label,
  title,
  isOpen,
  children,
  onOpenChange,
}: {
  readonly icon: ReactNode;
  readonly label: string;
  readonly title: string;
  readonly children: ReactNode;
  readonly isOpen: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const openOnHover = () => {
    if (typeof window === 'undefined') return;
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    onOpenChange(true);
  };

  return (
    <div className="relative">
      <button
        type="button"
        className={`flex h-10 w-10 items-center justify-center gap-1.5 rounded-2xl border text-xs font-semibold shadow-lg shadow-neutral-900/10 backdrop-blur-xl transition-colors lg:h-9 lg:w-auto lg:min-w-18 lg:px-2.5 ${
          isOpen
            ? 'border-sky-500 bg-sky-600 text-white shadow-sky-900/20'
            : 'border-white/80 bg-white/95 text-neutral-700 hover:bg-neutral-100'
        }`}
        aria-expanded={isOpen}
        title={title}
        onMouseEnter={openOnHover}
        onClick={() => onOpenChange(!isOpen)}
      >
        <span className="grid h-4.5 w-4.5 shrink-0 place-items-center lg:h-4 lg:w-4">
          {icon}
        </span>
        <span className="hidden min-w-0 truncate lg:block">{label}</span>
      </button>
      {isOpen ? (
        <div className="absolute right-full top-0 z-10 mr-2 grid min-w-32 gap-0.5 rounded-2xl border border-white/80 bg-white/95 p-1 shadow-xl shadow-neutral-900/15 backdrop-blur-xl">
          {children}
        </div>
      ) : null}
    </div>
  );
}

function TransportToggle({
  active,
  onToggle,
}: {
  readonly active: boolean;
  readonly onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className={`flex h-10 w-10 items-center justify-center gap-1.5 rounded-2xl border text-xs font-semibold shadow-lg shadow-neutral-900/10 backdrop-blur-xl transition-colors lg:h-9 lg:w-auto lg:min-w-18 lg:px-2.5 ${
        active
          ? 'border-sky-500 bg-sky-600 text-white shadow-sky-900/20'
          : 'border-white/80 bg-white/95 text-neutral-700 hover:bg-neutral-100'
      }`}
      aria-pressed={active}
      title="Transport overlay"
      onClick={onToggle}
    >
      <span className="grid h-4.5 w-4.5 shrink-0 place-items-center lg:h-4 lg:w-4">
        <TransportIcon />
      </span>
      <span className="hidden min-w-0 truncate lg:block">Transport</span>
    </button>
  );
}

function ZoomControls({
  onZoomIn,
  onZoomOut,
}: {
  readonly onZoomIn: () => void;
  readonly onZoomOut: () => void;
}) {
  return (
    <div
      className="grid rounded-2xl border border-white/80 bg-white/95 p-1 shadow-lg shadow-neutral-900/10 backdrop-blur-xl"
      aria-label="Map zoom controls"
    >
      <UtilityButton label="Zoom in" onClick={onZoomIn}>
        +
      </UtilityButton>
      <Divider />
      <UtilityButton label="Zoom out" onClick={onZoomOut}>
        -
      </UtilityButton>
    </div>
  );
}

function locateButtonMobilePositionClass(
  isSidebarOpen: boolean,
  bottomSheetState: BottomSheetState,
): string {
  if (!isSidebarOpen) return 'bottom-4';
  if (bottomSheetState === 'collapsed') return 'bottom-[6.75rem]';
  if (bottomSheetState === 'expanded') return 'bottom-[calc(86vh+0.75rem)] right-16';
  return 'bottom-[calc(48vh+0.75rem)]';
}

function ControlOptionButton({
  label,
  icon,
  active = false,
  disabled = false,
  title = label,
  onClick,
}: {
  readonly label: string;
  readonly icon?: ReactNode;
  readonly active?: boolean;
  readonly disabled?: boolean;
  readonly title?: string;
  readonly onClick?: () => void;
}) {
  return (
    <button
      type="button"
      className={`flex h-9 items-center gap-2 rounded-xl px-2.5 text-left text-xs font-semibold transition-colors ${
        active
          ? 'bg-sky-600 text-white shadow-sm shadow-sky-900/20'
          : 'text-neutral-700 hover:bg-sky-50 hover:text-sky-700 disabled:cursor-not-allowed disabled:text-neutral-300 disabled:hover:bg-transparent'
      }`}
      aria-pressed={active}
      disabled={disabled}
      title={title}
      onClick={onClick}
    >
      {icon ? <span className="grid h-4 w-4 shrink-0 place-items-center">{icon}</span> : null}
      <span>{label}</span>
    </button>
  );
}

function UtilityButton({
  children,
  label,
  onClick,
}: {
  readonly children: ReactNode;
  readonly label: string;
  readonly onClick?: () => void;
}) {
  return (
    <button
      type="button"
      className="grid h-8 w-8 place-items-center rounded-xl text-sm font-semibold text-neutral-700 transition-colors hover:bg-neutral-100 lg:h-8.5 lg:w-8.5"
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function Divider({ className = '' }: { readonly className?: string }) {
  return <span className={`mx-1 h-px bg-neutral-100 ${className}`} aria-hidden="true" />;
}

function MapIcon() {
  return (
    <svg className="h-4.5 w-4.5 lg:h-4 lg:w-4" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="m1.8 4 4-1.8 4.4 1.8 4-1.8v9.8l-4 1.8-4.4-1.8-4 1.8V4Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M5.8 2.2V12M10.2 4v9.8" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function ImageIcon() {
  return (
    <svg className="h-4.5 w-4.5 lg:h-4 lg:w-4" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M2.5 3h11A1.5 1.5 0 0 1 15 4.5v7A1.5 1.5 0 0 1 13.5 13h-11A1.5 1.5 0 0 1 1 11.5v-7A1.5 1.5 0 0 1 2.5 3Z"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <path d="m2 11 3.2-3 2.4 2.2 1.8-1.7L14 12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M11.2 6.3a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" fill="currentColor" />
    </svg>
  );
}

function LayersIcon() {
  return (
    <svg className="h-4.5 w-4.5 lg:h-4 lg:w-4" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 1.8 14 5 8 8.2 2 5l6-3.2Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="m2 8 6 3.2L14 8M2 11l6 3.2L14 11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TransportIcon() {
  return (
    <svg className="h-4.5 w-4.5 lg:h-4 lg:w-4" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="3.5" y="2.5" width="9" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M3.5 6.5h9" stroke="currentColor" strokeWidth="1.4" />
      <path d="M5.5 11.5 4.5 14M10.5 11.5l1 2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="6" cy="9" r="0.9" fill="currentColor" />
      <circle cx="10" cy="9" r="0.9" fill="currentColor" />
    </svg>
  );
}

function LanguageIcon() {
  return (
    <svg className="h-4.5 w-4.5 lg:h-4 lg:w-4" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M2 3h6M5 2v1M6.8 3c-.5 2.8-1.8 4.8-4 6.2M3.5 5.5c.8 1.5 1.8 2.7 3.4 3.6M9 13l2.5-6L14 13M10 11h3"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

