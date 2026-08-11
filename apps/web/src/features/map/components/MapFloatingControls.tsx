import { forwardRef, useEffect, useRef, useState, type ReactNode } from 'react';
import { isMapModeAvailable, type MapMode } from '@/features/map/config';
import { useMapUiText } from '@/features/map/i18n/mapUiText';
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
  readonly labelMy: string;
  readonly labelEn: string;
  readonly displayLabelMy: string;
  readonly displayLabelEn: string;
  readonly icon?: ReactNode;
}[] = [
  {
    mode: 'my',
    labelMy: 'မြန်မာစာတန်းများ',
    labelEn: 'Myanmar labels',
    displayLabelMy: 'မြန်မာ',
    displayLabelEn: 'Myanmar',
    icon: <LanguageIcon />,
  },
  {
    mode: 'en',
    labelMy: 'အင်္ဂလိပ်စာတန်းများ',
    labelEn: 'English labels',
    displayLabelMy: 'အင်္ဂလိပ်',
    displayLabelEn: 'English',
  },
  {
    mode: 'both',
    labelMy: 'ဘာသာနှစ်မျိုး',
    labelEn: 'Both label languages',
    displayLabelMy: 'နှစ်မျိုး',
    displayLabelEn: 'Both',
  },
];

const MAP_TYPE_OPTIONS: readonly {
  readonly id: MapMode;
  readonly labelMy: string;
  readonly labelEn: string;
  readonly displayLabelMy: string;
  readonly displayLabelEn: string;
  readonly icon: ReactNode;
  readonly title?: string;
}[] = [
  {
    id: 'normal',
    labelMy: 'မြေပုံ',
    labelEn: 'Map',
    displayLabelMy: 'မြေပုံ',
    displayLabelEn: 'Map',
    icon: <MapIcon />,
  },
  {
    id: 'satellite',
    labelMy: 'ဂြိုဟ်တုမြေပုံ',
    labelEn: 'Satellite',
    displayLabelMy: 'ဂြိုဟ်တု',
    displayLabelEn: 'Satellite',
    icon: <ImageIcon />,
  },
  {
    id: 'hybrid',
    labelMy: 'ပေါင်းစပ်မြေပုံ',
    labelEn: 'Hybrid',
    displayLabelMy: 'ပေါင်းစပ်',
    displayLabelEn: 'Hybrid',
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
          className={`pointer-events-none fixed z-20 transition-all duration-300 lg:bottom-8 lg:left-auto lg:right-4 lg:top-auto ${locateButtonMobilePositionClass(
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
    const t = useMapUiText();
    return (
      <div
        ref={ref}
        className="pointer-events-auto flex flex-col items-end gap-1.5"
        aria-label={t('မြေပုံထိန်းချုပ်ခလုတ်များ', 'Map controls')}
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
  const t = useMapUiText();

  return (
    <CompactControlSelect
      icon={selectedOption.icon}
      label={t(selectedOption.displayLabelMy, selectedOption.displayLabelEn)}
      title={t('မြေပုံပုံစံ', 'Map mode')}
      isOpen={isOpen}
      onOpenChange={onOpenChange}
    >
      {MAP_TYPE_OPTIONS.map((option) => {
        const active = option.id === selectedMode;
        const available = isMapModeAvailable(option.id);

        return (
          <ControlOptionButton
            key={option.id}
            label={t(option.displayLabelMy, option.displayLabelEn)}
            icon={option.icon}
            active={active}
            disabled={!available}
            title={
              available
                ? t(option.labelMy, option.labelEn)
                : option.title ??
                  t(
                    `${option.labelMy} မကြာမီ ရရှိနိုင်မည်`,
                    `${option.labelEn} coming soon`,
                  )
            }
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
  const t = useMapUiText();

  return (
    <CompactControlSelect
      icon={<LanguageIcon />}
      label={t(selectedOption.displayLabelMy, selectedOption.displayLabelEn)}
      title={t('ဘာသာစကား', 'Label language')}
      isOpen={isOpen}
      onOpenChange={onOpenChange}
    >
      {LANGUAGE_OPTIONS.filter((option) => option.mode !== selectedMode).map((option) => (
        <ControlOptionButton
          key={option.mode}
          label={t(option.displayLabelMy, option.displayLabelEn)}
          icon={option.icon}
          title={t(option.labelMy, option.labelEn)}
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
  return (
    <div className="relative">
      <button
        type="button"
        className={`flex h-11 w-11 items-center justify-center gap-1.5 rounded-2xl border text-sm font-semibold shadow-map-control backdrop-blur-xl transition-[color,background-color,border-color,box-shadow,opacity,filter] duration-150 lg:h-10 lg:w-auto lg:min-w-20 lg:px-3 ${
          isOpen
            ? 'border-map-primary bg-map-primary text-white shadow-map-control'
            : 'border-white/90 bg-white/94 text-map-ink hover:border-map-primary/25 hover:bg-map-primary-soft hover:text-map-primary'
        }`}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        title={title}
        onClick={() => onOpenChange(!isOpen)}
      >
        <span className="grid h-4.5 w-4.5 shrink-0 place-items-center lg:h-4 lg:w-4">
          {icon}
        </span>
        <span className="hidden min-w-0 truncate lg:block">{label}</span>
      </button>
      {isOpen ? (
        <div
          className="absolute right-full top-0 z-10 mr-2 grid min-w-36 gap-0.5 rounded-map-card border border-map-border bg-white/98 p-1.5 shadow-map-float backdrop-blur-xl"
          role="menu"
        >
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
  const t = useMapUiText();

  return (
    <button
      type="button"
      className={`flex h-11 w-11 items-center justify-center gap-1.5 rounded-2xl border text-sm font-semibold shadow-map-control backdrop-blur-xl transition-[color,background-color,border-color,box-shadow,opacity,filter] duration-150 lg:h-10 lg:w-auto lg:min-w-20 lg:px-3 ${
        active
          ? 'border-map-primary bg-map-primary text-white shadow-map-control'
          : 'border-white/90 bg-white/94 text-map-ink hover:border-map-primary/25 hover:bg-map-primary-soft hover:text-map-primary'
      }`}
      aria-pressed={active}
      title={t('အများသုံးယာဉ်လမ်းကြောင်းများ', 'Transport overlay')}
      onClick={onToggle}
    >
      <span className="grid h-4.5 w-4.5 shrink-0 place-items-center lg:h-4 lg:w-4">
        <TransportIcon />
      </span>
      <span className="hidden min-w-0 truncate text-sm lg:block">
        {t('အများသုံးယာဉ်', 'Transport')}
      </span>
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
  const t = useMapUiText();

  return (
    <div
      className="grid rounded-2xl border border-white/90 bg-white/94 p-1 shadow-map-control backdrop-blur-xl"
      aria-label={t('မြေပုံ အရွယ်အစားထိန်းချုပ်ရန်', 'Map zoom controls')}
    >
      <UtilityButton label={t('ချဲ့ရန်', 'Zoom in')} onClick={onZoomIn}>
        +
      </UtilityButton>
      <Divider />
      <UtilityButton label={t('ချုံ့ရန်', 'Zoom out')} onClick={onZoomOut}>
        -
      </UtilityButton>
    </div>
  );
}

function locateButtonMobilePositionClass(
  isSidebarOpen: boolean,
  bottomSheetState: BottomSheetState,
): string {
  if (!isSidebarOpen) return 'bottom-4 right-3';
  if (bottomSheetState === 'collapsed') return 'bottom-[6.75rem] right-3';
  if (bottomSheetState === 'expanded') return 'left-3 top-[4.5rem]';
  return 'bottom-[calc(48vh+0.75rem)] right-3';
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
      className={`flex h-10 items-center gap-2 rounded-xl px-3 text-left text-sm font-semibold transition-[color,background-color,border-color,box-shadow,opacity,filter] duration-150 ${
        active
          ? 'bg-map-primary text-white shadow-map-control'
          : 'text-map-ink hover:bg-map-primary-soft hover:text-map-primary disabled:cursor-not-allowed disabled:text-neutral-300 disabled:hover:bg-transparent'
      }`}
      role="menuitemradio"
      aria-checked={active}
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
      className="grid h-11 w-11 place-items-center rounded-xl text-sm font-semibold text-map-ink transition-[color,background-color,border-color,box-shadow,opacity,filter] duration-150 hover:bg-map-primary-soft hover:text-map-primary lg:h-10 lg:w-10"
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function Divider({ className = '' }: { readonly className?: string }) {
  return <span className={`mx-1 h-px bg-map-border/70 ${className}`} aria-hidden="true" />;
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
