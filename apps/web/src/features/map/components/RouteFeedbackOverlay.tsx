import { ROUTING_FEEDBACK_PROBLEM_OPTIONS } from '@/features/routing/lib/routeFeedbackLabels';
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
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="route-feedback-title"
    >
      <button
        type="button"
        className="absolute inset-0 bg-neutral-950/30 backdrop-blur-[2px]"
        aria-label="Close report form"
        onClick={onCancel}
      />

      <form
        className="relative z-10 w-full max-w-[20rem] rounded-2xl border border-neutral-200/90 bg-white p-3.5 shadow-[0_20px_50px_rgba(15,23,42,0.18)] ring-1 ring-neutral-950/5"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id="route-feedback-title" className="text-sm font-semibold text-neutral-950">
          Report details
        </h3>

        <div className="mt-3 space-y-3">
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.16em] text-neutral-400">
              Issue type
            </span>
            <select
              value={problemType}
              disabled={pending}
              onChange={(event) =>
                onProblemTypeChange(event.target.value as RoutingFeedbackProblemType)
              }
              className="h-10 w-full rounded-2xl border border-neutral-200 bg-white px-3 text-sm text-neutral-900 shadow-sm outline-none focus:border-sky-300 focus:ring-4 focus:ring-sky-100 disabled:opacity-60"
            >
              {ROUTING_FEEDBACK_PROBLEM_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.16em] text-neutral-400">
              Details
            </span>
            <textarea
              value={detail}
              disabled={pending}
              onChange={(event) => onDetailChange(event.target.value)}
              placeholder="What was wrong?"
              rows={3}
              maxLength={4000}
              className="w-full resize-none rounded-2xl border border-neutral-200 bg-white px-3 py-2.5 text-sm leading-5 text-neutral-900 shadow-sm outline-none placeholder:text-neutral-400 focus:border-sky-300 focus:ring-4 focus:ring-sky-100 disabled:opacity-60"
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
            className="h-10 flex-1 rounded-2xl border border-neutral-200 bg-white text-sm font-semibold text-neutral-700 transition-colors hover:bg-neutral-50 disabled:opacity-50"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={pending}
            className="h-10 flex-1 rounded-2xl bg-neutral-950 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {pending ? 'Sending…' : 'Send report'}
          </button>
        </div>
      </form>
    </div>
  );
}
