import type { ReactNode } from 'react';
import type { MapClickedLocation } from '@/features/map/types';

export type RouteProfile = 'walk' | 'motorbike' | 'car' | 'bus' | 'train';

export type RoutePoint = {
  readonly label: string;
  readonly coordinates?: readonly [number, number];
};

export type RouteDraft = {
  readonly from: RoutePoint | null;
  readonly to: RoutePoint | null;
  readonly profile: RouteProfile;
};

type RoutePlannerPanelProps = {
  readonly clickedLocation?: MapClickedLocation | null;
  readonly draft: RouteDraft;
  readonly onDraftChange: (draft: RouteDraft) => void;
};

const PROFILE_OPTIONS: readonly {
  readonly id: RouteProfile;
  readonly label: string;
  readonly icon: ReactNode;
}[] = [
  { id: 'walk', label: 'Walk', icon: <WalkIcon /> },
  { id: 'motorbike', label: 'Motorbike', icon: <MotorbikeIcon /> },
  { id: 'car', label: 'Car', icon: <CarIcon /> },
  { id: 'bus', label: 'Bus', icon: <BusIcon /> },
  { id: 'train', label: 'Train', icon: <TrainIcon /> },
];

export function RoutePlannerPanel({
  clickedLocation = null,
  draft,
  onDraftChange,
}: RoutePlannerPanelProps) {
  const from = draft.from;
  const to = draft.to;
  const profile = draft.profile;

  const canFindRoute = Boolean(from?.coordinates && to?.coordinates);
  const setFrom = (nextFrom: RoutePoint | null) => {
    onDraftChange({ ...draft, from: nextFrom });
  };
  const setTo = (nextTo: RoutePoint | null) => {
    onDraftChange({ ...draft, to: nextTo });
  };
  const setProfile = (nextProfile: RouteProfile) => {
    onDraftChange({ ...draft, profile: nextProfile });
  };

  return (
    <section className="space-y-3 p-3.5" aria-label="Route planner">
      <div className="rounded-2xl border border-neutral-100 bg-white p-3.5 shadow-sm shadow-neutral-950/3">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold leading-5 text-neutral-950">Plan a route</h2>
            <p className="mt-0.5 text-xs text-neutral-500">
              Choose a start and destination. Routing coming soon.
            </p>
          </div>
          <button
            type="button"
            className="rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-600 transition-colors hover:bg-neutral-50"
            onClick={() => {
              onDraftChange({ from: null, to: null, profile: 'motorbike' });
            }}
          >
            Clear
          </button>
        </div>

        <div className="grid grid-cols-[1fr_auto] gap-2 rounded-2xl bg-neutral-50 p-2 ring-1 ring-neutral-100">
          <div className="space-y-1.5">
            <RouteInput
              label="From"
              value={from?.label ?? ''}
              placeholder="Choose start point"
              markerClassName="bg-emerald-500"
              onChange={(value) => setFrom(value ? { label: value } : null)}
            />
            <RouteInput
              label="To"
              value={to?.label ?? ''}
              placeholder="Choose destination"
              markerClassName="bg-orange-500"
              onChange={(value) => setTo(value ? { label: value } : null)}
            />
          </div>
          <button
            type="button"
            className="mt-8 grid h-9 w-9 place-items-center rounded-full border border-neutral-200 bg-white text-neutral-600 shadow-sm transition-colors hover:bg-neutral-50 hover:text-neutral-950"
            aria-label="Swap start and destination"
            onClick={() => {
              onDraftChange({ ...draft, from: to, to: from });
            }}
          >
            <SwapIcon />
          </button>
        </div>

        {clickedLocation ? (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <SmallActionButton onClick={() => setFrom(clickedLocation)}>
              Use clicked start
            </SmallActionButton>
            <SmallActionButton onClick={() => setTo(clickedLocation)}>
              Use clicked destination
            </SmallActionButton>
          </div>
        ) : null}
      </div>

      <div className="rounded-2xl border border-neutral-100 bg-white p-3.5 shadow-sm shadow-neutral-950/3">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-neutral-400">
          Profile
        </h3>
        {/* TODO: Bus and Train transit will later appear as route result segments. */}
        <div className="-mx-1 flex gap-1 overflow-x-auto rounded-2xl bg-neutral-100 p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:mx-0 lg:grid lg:grid-cols-5 lg:overflow-visible">
          {PROFILE_OPTIONS.map((option) => (
            <button
              type="button"
              key={option.id}
              className={`flex min-h-12 min-w-18 shrink-0 flex-col items-center justify-center gap-1 rounded-xl px-1.5 py-1.5 text-[10px] font-semibold transition-colors lg:min-w-0 ${
                profile === option.id
                  ? 'bg-sky-600 text-white shadow-sm shadow-sky-900/20'
                  : 'text-neutral-600 hover:bg-white/75 hover:text-neutral-950'
              }`}
              onClick={() => setProfile(option.id)}
            >
              <span className="grid h-4 w-4 place-items-center">{option.icon}</span>
              {option.label}
            </button>
          ))}
        </div>

        {/* TODO: Wire future route endpoint: GET /public/route?from=lng,lat&to=lng,lat&profile=motorbike */}
        <button
          type="button"
          className="mt-3 h-10 w-full rounded-2xl bg-neutral-950 text-sm font-semibold text-white shadow-sm transition-opacity disabled:cursor-not-allowed disabled:opacity-45"
          disabled
          title={
            canFindRoute
              ? 'Routing is coming soon.'
              : 'Choose start and destination points first.'
          }
        >
          Find route · Coming soon
        </button>
      </div>

      <RouteResultPlaceholder from={from} to={to} profile={profile} canFindRoute={canFindRoute} />
    </section>
  );
}

function RouteInput({
  label,
  value,
  placeholder,
  markerClassName,
  onChange,
}: {
  readonly label: string;
  readonly value: string;
  readonly placeholder: string;
  readonly markerClassName: string;
  readonly onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.16em] text-neutral-400">
        {label}
      </span>
      <span className="flex h-10 items-center gap-2 rounded-2xl border border-neutral-200 bg-white px-3 shadow-sm shadow-neutral-950/3 focus-within:border-sky-300 focus-within:ring-4 focus-within:ring-sky-100">
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${markerClassName}`} />
        <input
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          className="min-w-0 flex-1 bg-transparent text-sm text-neutral-900 outline-none placeholder:text-neutral-400"
        />
      </span>
    </label>
  );
}

function SmallActionButton({
  children,
  onClick,
}: {
  readonly children: string;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="rounded-xl border border-neutral-200 bg-white px-3 py-2 text-xs font-semibold text-neutral-700 transition-colors hover:border-neutral-300 hover:bg-neutral-50"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function RouteResultPlaceholder({
  from,
  to,
  profile,
  canFindRoute,
}: {
  readonly from: RoutePoint | null;
  readonly to: RoutePoint | null;
  readonly profile: RouteProfile;
  readonly canFindRoute: boolean;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-neutral-200 bg-neutral-50 p-3.5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-neutral-950">Route summary</h3>
          <p className="mt-0.5 text-xs text-neutral-500">
            {canFindRoute ? 'Route details will appear here soon.' : 'Set both points to prepare a route.'}
          </p>
        </div>
        <span className="rounded-full bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-700 ring-1 ring-amber-100">
          Coming soon
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <MetricCard label="Distance" value={canFindRoute ? '— km' : 'Set points'} />
        <MetricCard label="ETA" value={canFindRoute ? '— min' : profileLabel(profile)} />
      </div>
      <div className="mt-3 rounded-2xl bg-white p-3 ring-1 ring-neutral-100">
        <h3 className="text-sm font-semibold text-neutral-950">Route steps</h3>
        <ol className="mt-2 space-y-2 text-xs leading-5 text-neutral-600">
          <li className="flex gap-2">
            <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
            Choose a start point.
          </li>
          <li className="flex gap-2">
            <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-orange-500" />
            Choose a destination.
          </li>
          <li className="flex gap-2">
            <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-neutral-300" />
            Route geometry and turn instructions will appear here.
          </li>
        </ol>
      </div>
      <p className="mt-3 rounded-2xl bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800 ring-1 ring-amber-100">
        Routing coming soon. Distance, ETA, and turn guidance will appear here.
      </p>
      {from || to ? (
        <p className="mt-2 text-xs leading-5 text-neutral-500">
          Draft: {from?.label ?? 'No start'} → {to?.label ?? 'No destination'}
        </p>
      ) : null}
    </div>
  );
}

function MetricCard({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="rounded-2xl bg-white p-3 ring-1 ring-neutral-100">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-neutral-400">
        {label}
      </p>
      <p className="mt-1 text-sm font-semibold text-neutral-950">{value}</p>
    </div>
  );
}

function profileLabel(profile: RouteProfile): string {
  const match = PROFILE_OPTIONS.find((option) => option.id === profile);
  return match?.label ?? 'Motorbike';
}

function SwapIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M5 3.5h7l-2-2M11 12.5H4l2 2M4 3.5h1M12 12.5h-1"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function WalkIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8.3 3.6a1.2 1.2 0 1 0 0-2.4 1.2 1.2 0 0 0 0 2.4Z" fill="currentColor" />
      <path d="M7.5 5 6 8l2.3 1.4L7 14M8.4 5.2l1.8 2.1 1.9.5M6.8 8.1 4.8 10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MotorbikeIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M4.2 12.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM12 12.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" stroke="currentColor" strokeWidth="1.35" />
      <path d="M4.2 10.5h2.4l1.7-3h2.2l1.5 3M7.2 7.5 6.3 5.8H4.8M10.5 7.5l1.1-2h1.6" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CarIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3 8.2 4.2 5.5A1.5 1.5 0 0 1 5.6 4.6h4.8a1.5 1.5 0 0 1 1.4.9L13 8.2v3.1H3V8.2Z" stroke="currentColor" strokeWidth="1.35" strokeLinejoin="round" />
      <path d="M4 11.3v1.1M12 11.3v1.1M3.3 8.2h9.4M5.2 9.8h.01M10.8 9.8h.01" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
    </svg>
  );
}

function BusIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M4 3.5h8A1.5 1.5 0 0 1 13.5 5v5.5A1.5 1.5 0 0 1 12 12H4a1.5 1.5 0 0 1-1.5-1.5V5A1.5 1.5 0 0 1 4 3.5Z" stroke="currentColor" strokeWidth="1.35" />
      <path d="M2.5 7h11M5 12v1M11 12v1M5.2 10h.01M10.8 10h.01" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
    </svg>
  );
}

function TrainIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M4 2.5h8A1.5 1.5 0 0 1 13.5 4v6A2.5 2.5 0 0 1 11 12.5H5A2.5 2.5 0 0 1 2.5 10V4A1.5 1.5 0 0 1 4 2.5Z"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinejoin="round"
      />
      <path
        d="M2.8 6.5h10.4M5.2 10h.01M10.8 10h.01M5.5 12.5 4 14M10.5 12.5 12 14"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
      />
    </svg>
  );
}
