import { ROUTING_FEEDBACK_PROBLEM_OPTIONS } from '@/features/routing/lib/routeFeedbackLabels';
import { useMapUiText } from '@/features/map/i18n/mapUiText';
import { useDialogFocus } from '@/components/ui/useDialogFocus';
import type { RoutingFeedbackProblemType } from '@/features/routing/types';

type RouteFeedbackOverlayProps = {
  readonly open: boolean;
  readonly problemType: RoutingFeedbackProblemType;
  readonly detail: string;
  readonly submitError: string | null;
  readonly pending: boolean;
  readonly onProblemTypeChange: (value: RoutingFeedbackProblemType) => void;
  readonly onDetailChange: (value: string) => void;
  readonly onCancel: () => void;
  readonly onSubmit: () => void;
};

export function RouteFeedbackOverlay({
  open,
  problemType,
  detail,
  submitError,
  pending,
  onProblemTypeChange,
  onDetailChange,
  onCancel,
  onSubmit,
}: RouteFeedbackOverlayProps) {
  const t = useMapUiText();
  const dialogRef = useDialogFocus(open, onCancel);
  if (!open) return null;

  return (
    <div
      ref={dialogRef}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="route-feedback-title"
      tabIndex={-1}
    >
      <button
        type="button"
        className="absolute inset-0 bg-slate-950/40 backdrop-blur-[2px]"
        aria-label={t('တိုင်ကြားမှုပုံစံ ပိတ်ရန်', 'Close report form')}
        onClick={onCancel}
      />

      <form
        className="relative z-10 w-full max-w-[20rem] rounded-3xl border border-white/90 bg-map-surface p-4 shadow-map-float ring-1 ring-map-primary/5"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id="route-feedback-title" className="text-sm font-semibold text-map-ink">
          {t('တိုင်ကြားချက်အသေးစိတ်', 'Report details')}
        </h3>

        <div className="mt-3 space-y-3">
          <label className="block">
            <span className="map-kicker mb-1.5 block text-map-muted">
              {t('ပြဿနာအမျိုးအစား', 'Issue type')}
            </span>
            <select
              data-dialog-autofocus
              value={problemType}
              disabled={pending}
              onChange={(event) =>
                onProblemTypeChange(event.target.value as RoutingFeedbackProblemType)
              }
              className="h-10 w-full rounded-map-control border border-map-border bg-map-surface px-3 text-sm text-map-ink shadow-map-control outline-none focus:border-map-primary disabled:opacity-60"
            >
              {ROUTING_FEEDBACK_PROBLEM_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {feedbackProblemLabel(option.value, option.label, t)}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="map-kicker mb-1.5 block text-map-muted">
              {t('အသေးစိတ်', 'Details')}
            </span>
            <textarea
              value={detail}
              disabled={pending}
              onChange={(event) => onDetailChange(event.target.value)}
              placeholder={t('ဘာမှားနေပါသလဲ။', 'What was wrong?')}
              rows={3}
              maxLength={4000}
              className="w-full resize-none rounded-map-control border border-map-border bg-map-surface px-3 py-2.5 text-sm leading-5 text-map-ink shadow-map-control outline-none placeholder:text-map-muted/70 focus:border-map-primary disabled:opacity-60"
            />
          </label>

          {submitError ? (
            <p className="rounded-xl bg-red-50 px-3 py-2 text-xs leading-5 text-red-800 ring-1 ring-red-100">
              {submitError}
            </p>
          ) : null}
        </div>

        <div className="mt-3 flex gap-2">
          <button
            type="button"
            disabled={pending}
            className="h-10 flex-1 rounded-map-control border border-map-border bg-map-surface text-sm font-semibold text-map-muted transition-colors hover:bg-map-primary-soft hover:text-map-primary disabled:opacity-50"
            onClick={onCancel}
          >
            {t('ပယ်ဖျက်ရန်', 'Cancel')}
          </button>
          <button
            type="submit"
            disabled={pending}
            className="h-10 flex-1 rounded-map-control bg-map-primary text-sm font-semibold text-white shadow-map-control transition-colors hover:bg-map-primary-hover disabled:opacity-50"
          >
            {pending ? t('ပေးပို့နေသည်…', 'Sending…') : t('တိုင်ကြားချက်ပို့ရန်', 'Send report')}
          </button>
        </div>
      </form>
    </div>
  );
}

function feedbackProblemLabel(
  value: RoutingFeedbackProblemType,
  english: string,
  t: (myanmar: string, english: string) => string,
): string {
  const labels: Record<RoutingFeedbackProblemType, string> = {
    wrong_route: 'လမ်းကြောင်းမှားနေသည်',
    missing_road: 'လမ်းမပါရှိပါ',
    road_closed: 'လမ်းပိတ်ထားသည်',
    bad_oneway: 'တစ်လမ်းမောင်းဦးတည်ချက် မှားနေသည်',
    bad_motorbike_route: 'မော်တော်ဆိုင်ကယ်လမ်းကြောင်း မသင့်တော်ပါ',
    bad_walk_route: 'လမ်းလျှောက်လမ်းကြောင်း မသင့်တော်ပါ',
    dangerous_route: 'အန္တရာယ်ရှိသော လမ်းကြောင်း',
    bad_eta: 'ခန့်မှန်းချိန် မှားနေသည်',
    cannot_route: 'လမ်းကြောင်း ရှာ၍မရပါ',
    other: 'အခြားပြဿနာ',
  };
  return t(labels[value], english);
}
