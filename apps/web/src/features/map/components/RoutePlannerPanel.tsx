import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { requestRoute, submitRoutingFeedback } from '@/features/routing/api/routingApi';
import {
  formatRouteDistance,
  formatRouteDuration,
  toApiRoutingProfile,
} from '@/features/routing/lib/routePoint';
import {
  filterUserFacingRouteWarnings,
  routingEngineDisplayHint,
  routingProfileDisplayLabel,
} from '@/features/routing/lib/routeDisplayWarnings';
import { DisabledTransitModeButton } from '@/features/map/components/DisabledTransitModeButton';
import { RouteFeedbackOverlay } from '@/features/map/components/RouteFeedbackOverlay';
import { buildRoutingFeedbackMessage } from '@/features/routing/lib/buildRoutingFeedbackMessage';
import { defaultFeedbackProblemType } from '@/features/routing/lib/routeFeedbackLabels';
import {
  formatRoutingClientError,
  ROUTING_NO_ROUTE_MESSAGE,
  ROUTING_SERVICE_UNAVAILABLE_MESSAGE,
  routingInvalidCoordinatesMessage,
} from '@/features/routing/lib/formatRoutingClientMessage';
import type { RouteResponse, RoutingFeedbackProblemType } from '@/features/routing/types';
import {
  endpointFromManualInput,
  manualEndpointFromLabel,
  endpointToWaypoint,
} from '@/features/routing/routeState';
import type { RouteInputField } from '@/features/routing/routeState';
import type { UseRouteStateReturn } from '@/features/routing/useRouteState';
import { RouteEndpointSearchOverlay } from '@/features/map/components/RouteEndpointSearchOverlay';
import { useMapUiStore } from '@/features/map/state/mapUiStore';

export type { RouteDraft, RoutePoint } from '@/features/routing/lib/routePoint';

type RoutePlannerPanelProps = {
  readonly route: UseRouteStateReturn;
  /** Map center `[lng, lat]` for optional distance labels in route search. */
  readonly searchReferenceCoordinates?: readonly [number, number] | null;
};

type RequestPhase = 'idle' | 'loading' | 'success' | 'no_route' | 'error';

const ENABLED_PROFILES: readonly {
  readonly id: UseRouteStateReturn['selectedMode'];
  readonly label: string;
  readonly icon: ReactNode;
}[] = [
  { id: 'walk', label: 'Walk', icon: <WalkIcon /> },
  { id: 'motorcycle', label: 'Motorbike', icon: <MotorbikeIcon /> },
  { id: 'car', label: 'Car', icon: <CarIcon /> },
];

const DISABLED_TRANSIT_MODES: readonly {
  readonly id: string;
  readonly label: string;
  readonly hint: string;
  readonly icon: ReactNode;
}[] = [
  { id: 'bus', label: 'Bus', hint: 'Bus routing is coming later.', icon: <BusIcon /> },
  {
    id: 'train',
    label: 'Train',
    hint: 'Train routing is coming later.',
    icon: <TrainIcon />,
  },
];

export function RoutePlannerPanel({
  route,
  searchReferenceCoordinates = null,
}: RoutePlannerPanelProps) {
  const languageMode = useMapUiStore((s) => s.languageMode);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackProblemType, setFeedbackProblemType] =
    useState<RoutingFeedbackProblemType>('wrong_route');
  const [feedbackDetail, setFeedbackDetail] = useState('');
  const [feedbackSubmitError, setFeedbackSubmitError] = useState<string | null>(null);
  const [feedbackPending, setFeedbackPending] = useState(false);
  const [feedbackToast, setFeedbackToast] = useState<string | null>(null);

  const routeRequestAbortRef = useRef<AbortController | null>(null);
  const routeRequestGenerationRef = useRef(0);

  const cancelInFlightRouteRequest = useCallback(() => {
    routeRequestAbortRef.current?.abort();
    routeRequestAbortRef.current = null;
    routeRequestGenerationRef.current += 1;
  }, []);

  const { canGetRoute, routeResult } = route;

  const phase: RequestPhase = useMemo(() => {
    if (route.isLoading) return 'loading';
    if (route.error) return 'error';
    if (route.routeResult?.status === 'no_route') return 'no_route';
    if (route.routeResult?.status === 'ok') return 'success';
    return 'idle';
  }, [route.error, route.isLoading, route.routeResult?.status]);

  const errorMessage = route.error;

  const closeFeedbackOverlay = useCallback(() => {
    setFeedbackOpen(false);
    setFeedbackSubmitError(null);
  }, []);

  const handleClearAll = useCallback(() => {
    cancelInFlightRouteRequest();
    setFeedbackOpen(false);
    setFeedbackSubmitError(null);
    setFeedbackDetail('');
    setFeedbackToast(null);
    setFeedbackPending(false);
    route.clearAll();
  }, [cancelInFlightRouteRequest, route]);

  const handleGetRoute = useCallback(async () => {
    if (route.isLoading) return;

    setFeedbackToast(null);
    const origin = endpointToWaypoint(route.from);
    const destination = endpointToWaypoint(route.to);

    if (!origin || !destination) {
      route.setError(routingInvalidCoordinatesMessage());
      route.setRouteResult(null);
      return;
    }

    cancelInFlightRouteRequest();
    const requestGeneration = routeRequestGenerationRef.current;
    const abortController = new AbortController();
    routeRequestAbortRef.current = abortController;

    route.setIsLoading(true);
    route.setError(null);
    route.setRouteResult(null);

    const applyIfCurrent = (apply: () => void) => {
      if (requestGeneration !== routeRequestGenerationRef.current) return;
      if (abortController.signal.aborted) return;
      apply();
    };

    try {
      const response = await requestRoute(
        {
          origin,
          destination,
          profile: toApiRoutingProfile(route.selectedMode),
          preference: 'fastest',
        },
        { signal: abortController.signal },
      );

      applyIfCurrent(() => {
        if (response.status === 'no_route') {
          route.setRouteResult(response);
          route.setIsLoading(false);
          return;
        }

        if (response.status === 'error') {
          route.setRouteResult(response);
          route.setError(ROUTING_SERVICE_UNAVAILABLE_MESSAGE);
          route.setIsLoading(false);
          return;
        }

        route.setRouteResult(response);
        route.setIsLoading(false);
      });
    } catch (error) {
      if (abortController.signal.aborted) return;
      if (requestGeneration !== routeRequestGenerationRef.current) return;
      if (error instanceof DOMException && error.name === 'AbortError') return;

      route.setRouteResult(null);
      route.setError(formatRoutingClientError(error));
      route.setIsLoading(false);
    }
  }, [cancelInFlightRouteRequest, route]);

  const handleSwapEndpoints = useCallback(() => {
    cancelInFlightRouteRequest();
    setFeedbackToast(null);
    route.swapEndpoints();
  }, [cancelInFlightRouteRequest, route]);

  useEffect(() => () => cancelInFlightRouteRequest(), [cancelInFlightRouteRequest]);

  const handleOpenFeedback = useCallback(() => {
    setFeedbackProblemType(defaultFeedbackProblemType(phase));
    setFeedbackSubmitError(null);
    setFeedbackOpen(true);
  }, [phase]);

  const handleSubmitFeedback = useCallback(async () => {
    const origin = endpointToWaypoint(route.from);
    const destination = endpointToWaypoint(route.to);
    if (!origin || !destination) {
      setFeedbackSubmitError('Set valid from and to points before sending a report.');
      return;
    }

    const trimmedDetail = feedbackDetail.trim();
    if (!trimmedDetail) {
      setFeedbackSubmitError('Add a short description of the issue.');
      return;
    }

    setFeedbackPending(true);
    setFeedbackSubmitError(null);
    try {
      await submitRoutingFeedback({
        requestId: route.routeResult?.debug?.requestId,
        origin: { lat: origin.lat, lng: origin.lng },
        destination: { lat: destination.lat, lng: destination.lng },
        profile: toApiRoutingProfile(route.selectedMode),
        problemType: feedbackProblemType,
        message: buildRoutingFeedbackMessage(trimmedDetail, route.routeResult),
      });
      setFeedbackOpen(false);
      setFeedbackDetail('');
      setFeedbackToast('Report sent');
    } catch (error) {
      setFeedbackSubmitError(formatRoutingClientError(error));
    } finally {
      setFeedbackPending(false);
    }
  }, [
    feedbackDetail,
    feedbackProblemType,
    route.from,
    route.routeResult,
    route.selectedMode,
    route.to,
  ]);

  useEffect(() => {
    if (!feedbackToast) return;
    const timer = window.setTimeout(() => setFeedbackToast(null), 1000);
    return () => window.clearTimeout(timer);
  }, [feedbackToast]);

  const steps = useMemo(() => collectRouteSteps(routeResult), [routeResult]);

  const userFacingWarnings = useMemo(
    () => (routeResult ? filterUserFacingRouteWarnings(routeResult.warnings) : []),
    [routeResult],
  );

  const engineHint = useMemo(
    () => (routeResult ? routingEngineDisplayHint(routeResult.routingEngine) : null),
    [routeResult],
  );

  return (
    <section className="relative space-y-3 p-3.5" aria-label="Directions">
      <div className="rounded-2xl border border-neutral-100 bg-white p-3.5 shadow-sm shadow-neutral-950/3">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold leading-5 text-neutral-950">Directions</h2>
            <p className="mt-0.5 text-xs text-neutral-500">
              Search for a place or street, or enter coordinates.
            </p>
          </div>
          <button
            type="button"
            className="rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-600 transition-colors hover:bg-neutral-50"
            aria-label="Clear directions and route"
            onClick={() => handleClearAll()}
          >
            Clear
          </button>
        </div>

        <div className="grid grid-cols-[1fr_auto] gap-2 rounded-2xl bg-neutral-50 p-2 ring-1 ring-neutral-100">
          <div className="space-y-1.5">
            <RouteInput
              label="From"
              value={route.from.label}
              placeholder="Search or 16.8661, 96.1951"
              markerClassName="bg-emerald-500"
              isActive={route.activeInput === 'from'}
              onFocus={() => route.setActiveInput('from')}
              onChange={(value) => {
                route.setFrom(manualEndpointFromLabel(value));
                route.setActiveInput('from');
              }}
              onBlur={(value) => {
                if (route.activeInput === 'from') return;
                route.setFrom(endpointFromManualInput(value));
              }}
            />
            <RouteInput
              label="To"
              value={route.to.label}
              placeholder="Search or 16.8710, 96.2010"
              markerClassName="bg-orange-500"
              isActive={route.activeInput === 'to'}
              onFocus={() => route.setActiveInput('to')}
              onChange={(value) => {
                route.setTo(manualEndpointFromLabel(value));
                route.setActiveInput('to');
              }}
              onBlur={(value) => {
                if (route.activeInput === 'to') return;
                route.setTo(endpointFromManualInput(value));
              }}
            />
          </div>
          <button
            type="button"
            className="mt-8 grid h-9 w-9 place-items-center rounded-full border border-neutral-200 bg-white text-neutral-600 shadow-sm transition-colors hover:bg-neutral-50 hover:text-neutral-950"
            aria-label="Swap start and destination"
            onClick={handleSwapEndpoints}
          >
            <SwapIcon />
          </button>
        </div>

        {route.pickMode ? (
          <RouteMapPickBanner pickMode={route.pickMode} onCancel={() => route.cancelMapPick()} />
        ) : route.activeInput ? (
          <RouteEndpointSearchOverlay
            field={route.activeInput}
            route={route}
            languageMode={languageMode}
            referenceCoordinates={searchReferenceCoordinates}
          />
        ) : (
          <>
            <p className="mt-2 text-[11px] leading-4 text-neutral-500">
              Tap From or To to search, or choose a point on the map.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <SmallActionButton onClick={() => route.startMapPick('from')}>
                Choose From on map
              </SmallActionButton>
              <SmallActionButton onClick={() => route.startMapPick('to')}>
                Choose To on map
              </SmallActionButton>
            </div>
          </>
        )}

      </div>

      <div className="rounded-2xl border border-neutral-100 bg-white p-3.5 shadow-sm shadow-neutral-950/3">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-neutral-400">Mode</h3>
        <div className="-mx-1 flex gap-1 overflow-x-auto rounded-2xl bg-neutral-100 p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {ENABLED_PROFILES.map((option) => (
            <button
              type="button"
              key={option.id}
              className={`flex min-h-12 min-w-20 shrink-0 flex-col items-center justify-center gap-1 rounded-xl px-2 py-1.5 text-[10px] font-semibold transition-colors ${
                route.selectedMode === option.id
                  ? 'bg-sky-600 text-white shadow-sm shadow-sky-900/20'
                  : 'text-neutral-600 hover:bg-white/75 hover:text-neutral-950'
              }`}
              onClick={() => route.setSelectedMode(option.id)}
            >
              <span className="grid h-4 w-4 place-items-center">{option.icon}</span>
              {option.label}
            </button>
          ))}
          {DISABLED_TRANSIT_MODES.map((option) => (
            <DisabledTransitModeButton
              key={option.id}
              label={option.label}
              icon={option.icon}
              hint={option.hint}
            />
          ))}
        </div>

        <button
          type="button"
          className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-neutral-950 text-sm font-semibold text-white shadow-sm transition-opacity disabled:cursor-not-allowed disabled:opacity-45"
          disabled={!canGetRoute || route.isLoading}
          aria-busy={route.isLoading}
          onClick={() => {
            void handleGetRoute();
          }}
        >
          {route.isLoading ? (
            <>
              <Spinner />
              Finding route...
            </>
          ) : (
            'Get route'
          )}
        </button>
      </div>

      {phase === 'error' && errorMessage ? (
        <StateBanner tone="error" title="Could not get route" body={errorMessage} />
      ) : null}

      {phase === 'no_route' ? (
        <StateBanner tone="warning" title="No route found" body={ROUTING_NO_ROUTE_MESSAGE} />
      ) : null}

      {phase === 'success' && routeResult ? (
        <div className="rounded-2xl border border-neutral-100 bg-white p-3.5 shadow-sm shadow-neutral-950/3">
          <div className="mb-3">
            <h3 className="text-sm font-semibold text-neutral-950">Route summary</h3>
            <p className="mt-1 text-sm font-medium text-neutral-800">
              {routingProfileDisplayLabel(routeResult.profile)}
            </p>
            {engineHint ? (
              <p className="mt-0.5 text-[11px] text-neutral-400">{engineHint}</p>
            ) : null}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <MetricCard label="Distance" value={formatRouteDistance(routeResult.summary.distanceMeters)} />
            <MetricCard label="Est. time" value={formatRouteDuration(routeResult.summary.durationSeconds)} />
          </div>
          <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-neutral-500">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-emerald-500 ring-2 ring-white" aria-hidden />
              Start
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-orange-500 ring-2 ring-white" aria-hidden />
              Destination
            </span>
            <span className="text-neutral-400">Follow steps below for turns.</span>
          </p>
          {userFacingWarnings.length > 0 ? (
            <ul className="mt-3 space-y-1 text-xs text-amber-800">
              {userFacingWarnings.map((warning) => (
                <li key={warning} className="rounded-xl bg-amber-50 px-3 py-2 ring-1 ring-amber-100">
                  {warning}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {steps.length > 0 ? (
        <div className="rounded-2xl border border-neutral-100 bg-white p-3.5 shadow-sm shadow-neutral-950/3">
          <h3 className="text-sm font-semibold text-neutral-950">Turn-by-turn</h3>
          <ol className="mt-2 space-y-2 text-xs leading-5 text-neutral-700">
            {steps.map((step, index) => (
              <li
                key={`${index}-${step}`}
                className={`flex gap-2 ${index === 0 ? 'rounded-xl bg-emerald-50/80 px-2 py-1.5 ring-1 ring-emerald-100/80' : ''}`}
              >
                <span
                  className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-bold ${
                    index === 0
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-sky-100 text-sky-800'
                  }`}
                >
                  {index + 1}
                </span>
                <span className={index === 0 ? 'font-medium text-neutral-900' : undefined}>
                  {index === 0 ? `Start: ${step}` : step}
                </span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {route.routeResult ? (
        <button
          type="button"
          className="h-10 w-full rounded-2xl border border-amber-200 bg-amber-50 text-sm font-semibold text-amber-900 transition-colors hover:bg-amber-100"
          onClick={handleOpenFeedback}
        >
          Report route issue
        </button>
      ) : null}

      {feedbackToast ? (
        <p
          className="rounded-2xl bg-emerald-50 px-3 py-2 text-center text-xs leading-5 text-emerald-900 ring-1 ring-emerald-100"
          role="status"
        >
          {feedbackToast}
        </p>
      ) : null}

      <RouteFeedbackOverlay
        open={feedbackOpen}
        problemType={feedbackProblemType}
        detail={feedbackDetail}
        submitError={feedbackSubmitError}
        pending={feedbackPending}
        onProblemTypeChange={setFeedbackProblemType}
        onDetailChange={setFeedbackDetail}
        onCancel={closeFeedbackOverlay}
        onSubmit={() => {
          void handleSubmitFeedback();
        }}
      />
    </section>
  );
}

function collectRouteSteps(route: RouteResponse | null): readonly string[] {
  if (!route) return [];
  const steps: string[] = [];
  for (const leg of route.legs) {
    if (leg.instructions?.length) {
      steps.push(...leg.instructions);
    }
  }
  return steps;
}

function RouteMapPickBanner({
  pickMode,
  onCancel,
}: {
  readonly pickMode: RouteInputField;
  readonly onCancel: () => void;
}) {
  const isFrom = pickMode === 'from';
  const toneClass = isFrom
    ? 'border-emerald-200 bg-emerald-50 ring-emerald-100'
    : 'border-orange-200 bg-orange-50 ring-orange-100';
  const markerClass = isFrom ? 'bg-emerald-500' : 'bg-orange-500';
  const label = isFrom ? 'From' : 'To';

  return (
    <div
      className={`mt-3 flex items-start justify-between gap-3 rounded-2xl border px-3 py-2.5 ring-1 ${toneClass}`}
      role="status"
      aria-live="polite"
    >
      <div className="flex min-w-0 items-start gap-2">
        <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${markerClass}`} aria-hidden />
        <p className="text-xs leading-5 text-neutral-900">
          <span className="font-semibold">Picking {label} on map</span>
          <span className="mt-0.5 block text-neutral-600">
            Click once on the map. Map pick ends automatically.
          </span>
        </p>
      </div>
      <button
        type="button"
        className="shrink-0 rounded-full border border-neutral-200 bg-white px-3 py-1 text-[11px] font-semibold text-neutral-700 transition-colors hover:bg-neutral-50"
        onClick={onCancel}
      >
        Cancel
      </button>
    </div>
  );
}

function RouteInput({
  label,
  value,
  placeholder,
  markerClassName,
  isActive = false,
  onFocus,
  onChange,
  onBlur,
}: {
  readonly label: string;
  readonly value: string;
  readonly placeholder: string;
  readonly markerClassName: string;
  readonly isActive?: boolean;
  readonly onFocus?: () => void;
  readonly onChange: (value: string) => void;
  readonly onBlur: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.16em] text-neutral-400">
        {label}
      </span>
      <span
        className={`flex h-10 items-center gap-2 rounded-2xl border bg-white px-3 shadow-sm shadow-neutral-950/3 focus-within:ring-4 focus-within:ring-sky-100 ${
          isActive
            ? 'border-sky-400 ring-2 ring-sky-100'
            : 'border-neutral-200 focus-within:border-sky-300'
        }`}
      >
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${markerClassName}`} />
        <input
          type="text"
          value={value}
          onFocus={onFocus}
          onChange={(event) => onChange(event.target.value)}
          onBlur={(event) => onBlur(event.target.value)}
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

function StateBanner({
  tone,
  title,
  body,
}: {
  readonly tone: 'info' | 'error' | 'warning';
  readonly title: string;
  readonly body: string;
}) {
  const toneClass =
    tone === 'error'
      ? 'bg-red-50 text-red-900 ring-red-100'
      : tone === 'warning'
        ? 'bg-amber-50 text-amber-900 ring-amber-100'
        : 'bg-sky-50 text-sky-900 ring-sky-100';

  return (
    <div className={`rounded-2xl px-3.5 py-3 ring-1 ${toneClass}`}>
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="mt-1 text-xs leading-5 opacity-90">{body}</p>
    </div>
  );
}

function MetricCard({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="rounded-2xl bg-neutral-50 p-3 ring-1 ring-neutral-100">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-neutral-400">{label}</p>
      <p className="mt-1 text-sm font-semibold text-neutral-950">{value}</p>
    </div>
  );
}

function Spinner() {
  return (
    <span
      className="h-4 w-4 animate-spin rounded-full border-2 border-white/35 border-t-white"
      aria-hidden="true"
    />
  );
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
      <path
        d="M7.5 5 6 8l2.3 1.4L7 14M8.4 5.2l1.8 2.1 1.9.5M6.8 8.1 4.8 10"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MotorbikeIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M4.2 12.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM12 12.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"
        stroke="currentColor"
        strokeWidth="1.35"
      />
      <path
        d="M4.2 10.5h2.4l1.7-3h2.2l1.5 3M7.2 7.5 6.3 5.8H4.8M10.5 7.5l1.1-2h1.6"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CarIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M3 8.2 4.2 5.5A1.5 1.5 0 0 1 5.6 4.6h4.8a1.5 1.5 0 0 1 1.4.9L13 8.2v3.1H3V8.2Z"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinejoin="round"
      />
      <path
        d="M4 11.3v1.1M12 11.3v1.1M3.3 8.2h9.4M5.2 9.8h.01M10.8 9.8h.01"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
      />
    </svg>
  );
}

function BusIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M4 3.5h8A1.5 1.5 0 0 1 13.5 5v5.5A1.5 1.5 0 0 1 12 12H4a1.5 1.5 0 0 1-1.5-1.5V5A1.5 1.5 0 0 1 4 3.5Z"
        stroke="currentColor"
        strokeWidth="1.35"
      />
      <path
        d="M2.5 7h11M5 12v1M11 12v1M5.2 10h.01M10.8 10h.01"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
      />
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
