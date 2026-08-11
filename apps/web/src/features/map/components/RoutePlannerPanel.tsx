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
} from '@/features/routing/lib/routeDisplayWarnings';
import { DisabledTransitModeButton } from '@/features/map/components/DisabledTransitModeButton';
import { RouteFeedbackOverlay } from '@/features/map/components/RouteFeedbackOverlay';
import { buildRoutingFeedbackMessage } from '@/features/routing/lib/buildRoutingFeedbackMessage';
import { defaultFeedbackProblemType } from '@/features/routing/lib/routeFeedbackLabels';
import {
  formatRoutingClientError,
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
import { useMapUiText } from '@/features/map/i18n/mapUiText';
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
  const t = useMapUiText();
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
  const hasRouteDraft = Boolean(
    route.from.label || route.to.label || route.routeResult || route.error,
  );

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
      setFeedbackSubmitError(t('စတင်ရာနှင့် သွားရာကို ရွေးပါ။', 'Select start and destination.'));
      return;
    }

    const trimmedDetail = feedbackDetail.trim();
    if (!trimmedDetail) {
      setFeedbackSubmitError(
        t('ပြဿနာကို အကျဉ်းရေးပါ။', 'Briefly describe the issue.'),
      );
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
      setFeedbackToast(t('တိုင်ကြားချက် ပေးပို့ပြီးပါပြီ', 'Report sent'));
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
    t,
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
    <section className="relative space-y-3 p-3 text-sm" aria-label={t('လမ်းညွှန်', 'Directions')}>
      <div className="rounded-map-card border border-map-border bg-map-surface p-3 shadow-map-card">
        {hasRouteDraft ? (
          <div className="mb-2 flex justify-end">
            <button
              type="button"
              className="min-h-9 rounded-full border border-map-border bg-map-surface px-3 py-1 text-xs font-semibold text-map-muted transition-colors duration-150 hover:border-map-primary/40 hover:bg-map-primary-soft hover:text-map-primary"
              aria-label={t('လမ်းညွှန်ချက်များကို ရှင်းရန်', 'Clear directions and route')}
              onClick={() => handleClearAll()}
            >
              {t('ရှင်း', 'Clear')}
            </button>
          </div>
        ) : null}

        <div className="grid grid-cols-[1fr_auto] gap-2 rounded-2xl bg-map-bg p-2 ring-1 ring-map-border/70">
          <div className="space-y-1.5">
            <RouteInput
              label={t('မှ', 'From')}
              value={route.from.label}
              placeholder={t('ရှာရန်', 'Search')}
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
              label={t('သို့', 'To')}
              value={route.to.label}
              placeholder={t('ရှာရန်', 'Search')}
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
            className="mt-8 grid h-11 w-11 place-items-center rounded-full border border-map-border bg-map-surface text-map-muted shadow-map-control transition-colors duration-150 hover:border-map-primary/40 hover:bg-map-primary-soft hover:text-map-primary lg:h-10 lg:w-10"
            aria-label={t('စတင်ရာနှင့် သွားမည့်နေရာ ပြောင်းရန်', 'Swap start and destination')}
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
          <div className="mt-2 grid grid-cols-2 gap-2">
              <SmallActionButton onClick={() => route.startMapPick('from')}>
                {t('မှ · မြေပုံ', 'From · Map')}
              </SmallActionButton>
              <SmallActionButton onClick={() => route.startMapPick('to')}>
                {t('သို့ · မြေပုံ', 'To · Map')}
              </SmallActionButton>
          </div>
        )}

      </div>

      <div className="rounded-map-card border border-map-border bg-map-surface p-3 shadow-map-card">
        <h3 className="map-kicker mb-2 text-map-muted">
          {t('ယာဉ်', 'Mode')}
        </h3>
        <div className="-mx-1 grid grid-cols-3 gap-1 rounded-map-control bg-slate-100 p-1">
          {ENABLED_PROFILES.map((option) => (
            <button
              type="button"
              key={option.id}
              className={`flex min-h-11 min-w-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-2 py-1.5 text-sm font-semibold transition-[color,background-color,border-color,box-shadow,opacity,filter] duration-150 lg:min-h-10 ${
                route.selectedMode === option.id
                  ? 'bg-map-primary text-white shadow-map-control'
                  : 'text-map-muted hover:bg-white hover:text-map-primary'
              }`}
              aria-pressed={route.selectedMode === option.id}
              onClick={() => route.setSelectedMode(option.id)}
            >
              <span className="grid h-4 w-4 place-items-center">{option.icon}</span>
              {routeProfileLabel(option.id, t)}
            </button>
          ))}
        </div>
        <div className="mt-1.5 grid grid-cols-2 gap-1">
          {DISABLED_TRANSIT_MODES.map((option) => (
            <DisabledTransitModeButton
              key={option.id}
              label={t(option.id === 'bus' ? 'ဘတ်စ်' : 'ရထား', option.label)}
              icon={option.icon}
              hint={t(
                option.id === 'bus'
                  ? 'ဘတ်စ်လမ်းညွှန်စနစ်ကို နောက်ပိုင်းတွင် ရရှိနိုင်မည်။'
                  : 'ရထားလမ်းညွှန်စနစ်ကို နောက်ပိုင်းတွင် ရရှိနိုင်မည်။',
                option.hint,
              )}
            />
          ))}
        </div>

        <button
          type="button"
          className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-map-control bg-map-primary text-sm font-semibold text-white shadow-map-control transition-[color,background-color,border-color,box-shadow,opacity,filter] duration-150 hover:bg-map-primary-hover disabled:bg-slate-200 disabled:text-slate-500 disabled:shadow-none disabled:opacity-100 lg:h-10"
          disabled={!canGetRoute || route.isLoading}
          aria-busy={route.isLoading}
          onClick={() => {
            void handleGetRoute();
          }}
        >
          {route.isLoading ? (
            <>
              <Spinner />
              {t('လမ်းကြောင်း ရှာနေသည်…', 'Finding route...')}
            </>
          ) : (
            t('လမ်းရှာရန်', 'Find route')
          )}
        </button>
      </div>

      {phase === 'error' && errorMessage ? (
        <StateBanner
          tone="error"
          title={t('လမ်းကြောင်း ရှာ၍မရပါ', 'Could not get route')}
          body={errorMessage}
        />
      ) : null}

      {phase === 'no_route' ? (
        <StateBanner
          tone="warning"
          title={t('လမ်းကြောင်း မတွေ့ပါ', 'No route found')}
          body={t('အခြားနေရာကို စမ်းပါ။', 'Try different points.')}
        />
      ) : null}

      {phase === 'success' && routeResult ? (
        <div className="rounded-map-card border border-map-border bg-map-surface p-3.5 shadow-map-card">
          <div className="mb-3">
            <h3 className="text-sm font-semibold text-map-ink">{t('လမ်းကြောင်းအကျဉ်း', 'Route summary')}</h3>
            <p className="mt-1 text-sm font-medium text-map-ink/85">
              {routeProfileLabel(routeResult.profile, t)}
            </p>
            {engineHint ? (
              <p className="mt-0.5 text-xs text-map-muted">{engineHint}</p>
            ) : null}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <MetricCard label={t('အကွာအဝေး', 'Distance')} value={formatRouteDistance(routeResult.summary.distanceMeters)} />
            <MetricCard label={t('ခန့်မှန်းချိန်', 'Est. time')} value={formatRouteDuration(routeResult.summary.durationSeconds)} />
          </div>
          <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-map-muted">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-emerald-500 ring-2 ring-white" aria-hidden />
              {t('စတင်ရာ', 'Start')}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-orange-500 ring-2 ring-white" aria-hidden />
              {t('သွားမည့်နေရာ', 'Destination')}
            </span>
            <span className="text-map-muted/75">
              {t('အောက်ပါအဆင့်များကို လိုက်နာပါ။', 'Follow the steps below.')}
            </span>
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
        <div className="rounded-map-card border border-map-border bg-map-surface p-3.5 shadow-map-card">
          <h3 className="text-sm font-semibold text-map-ink">{t('အဆင့်ဆင့် လမ်းညွှန်ချက်', 'Turn-by-turn')}</h3>
          <ol className="mt-2 space-y-2 text-xs leading-5 text-map-ink/80">
            {steps.map((step, index) => (
              <li
                key={`${index}-${step}`}
                className={`flex gap-2 ${index === 0 ? 'rounded-xl bg-emerald-50/80 px-2 py-1.5 ring-1 ring-emerald-100/80' : ''}`}
              >
                <span
                  className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-xs font-bold ${
                    index === 0
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-map-primary-soft text-map-primary'
                  }`}
                >
                  {index + 1}
                </span>
                <span className={index === 0 ? 'font-medium text-map-ink' : undefined}>
                  {index === 0 ? `${t('စတင်ရန်', 'Start')}: ${step}` : step}
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
          {t('လမ်းကြောင်းပြဿနာ တိုင်ကြားရန်', 'Report route issue')}
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

function routeProfileLabel(
  profile: string,
  t: (myanmar: string, english: string) => string,
): string {
  switch (profile) {
    case 'walk':
      return t('လမ်းလျှောက်', 'Walk');
    case 'motorcycle':
      return t('ဆိုင်ကယ်', 'Bike');
    case 'car':
      return t('ကား', 'Car');
    case 'multimodal':
      return t('ပေါင်းစပ်သွားလာမှု', 'Multimodal');
    default:
      return profile;
  }
}

function RouteMapPickBanner({
  pickMode,
  onCancel,
}: {
  readonly pickMode: RouteInputField;
  readonly onCancel: () => void;
}) {
  const t = useMapUiText();
  const isFrom = pickMode === 'from';
  const toneClass = isFrom
    ? 'border-emerald-200 bg-emerald-50 ring-emerald-100'
    : 'border-orange-200 bg-orange-50 ring-orange-100';
  const markerClass = isFrom ? 'bg-emerald-500' : 'bg-orange-500';
  const label = isFrom ? t('မှ', 'From') : t('သို့', 'To');

  return (
    <div
      className={`mt-3 flex items-start justify-between gap-3 rounded-2xl border px-3 py-2.5 ring-1 ${toneClass}`}
      role="status"
      aria-live="polite"
    >
      <div className="flex min-w-0 items-start gap-2">
        <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${markerClass}`} aria-hidden />
        <p className="text-xs leading-5 text-map-ink">
          <span className="font-semibold">
            {t(`${label} ရွေးနေသည်`, `Picking ${label}`)}
          </span>
          <span className="mt-0.5 block text-map-muted">
            {t(
              'မြေပုံကို နှိပ်ပါ။',
              'Click the map.',
            )}
          </span>
        </p>
      </div>
      <button
        type="button"
        className="shrink-0 rounded-full border border-map-border bg-map-surface px-3 py-1 text-xs font-semibold text-map-muted transition-colors hover:bg-map-primary-soft hover:text-map-primary"
        onClick={onCancel}
      >
        {t('ပယ်ဖျက်', 'Cancel')}
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
      <span className="map-kicker mb-1 block text-map-muted">
        {label}
      </span>
      <span
        className={`map-focus-owner flex h-11 items-center gap-2 rounded-map-control border bg-map-surface px-3 transition-colors lg:h-10 ${
          isActive
            ? 'border-map-primary bg-map-primary-soft/25'
            : 'border-map-border'
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
          className="map-focus-silent min-w-0 flex-1 bg-transparent text-sm text-map-ink outline-none placeholder:text-map-muted/70"
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
      className="min-h-11 whitespace-nowrap rounded-map-control border border-map-border bg-map-surface px-3 py-1.5 text-sm font-semibold text-map-ink transition-colors duration-150 hover:border-map-primary/40 hover:bg-map-primary-soft hover:text-map-primary lg:min-h-10"
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
        : 'bg-map-primary-soft text-map-primary ring-map-primary/15';

  return (
    <div className={`rounded-2xl px-3.5 py-3 ring-1 ${toneClass}`}>
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="mt-1 text-xs leading-5 opacity-90">{body}</p>
    </div>
  );
}

function MetricCard({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="rounded-2xl bg-map-primary-soft/55 p-3 ring-1 ring-map-primary/10">
      <p className="map-kicker text-map-primary">{label}</p>
      <p className="mt-1 text-sm font-semibold text-map-ink">{value}</p>
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
