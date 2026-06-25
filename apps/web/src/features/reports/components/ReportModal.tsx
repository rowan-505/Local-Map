import { useEffect, useState } from 'react';
import { useAuth } from '@/features/auth/state/useAuth';
import {
  REPORT_TYPE_OPTIONS,
  submitReport,
  type ReportTarget,
  type ReportTypeCode,
  type SubmittedReport,
} from '../api/reportsApi';

type ReportModalProps = {
  readonly open: boolean;
  readonly target: ReportTarget;
  readonly onClose: () => void;
};

const DEFAULT_TYPE: ReportTypeCode = 'wrong_info';

export function ReportModal({ open, target, onClose }: ReportModalProps) {
  const { isAuthenticated } = useAuth();
  const [reportTypeCode, setReportTypeCode] = useState<ReportTypeCode>(DEFAULT_TYPE);
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SubmittedReport | null>(null);

  // Reset the form each time the modal is (re)opened for a new target.
  useEffect(() => {
    if (open) {
      setReportTypeCode(DEFAULT_TYPE);
      setDescription('');
      setBusy(false);
      setError(null);
      setResult(null);
    }
  }, [open]);

  // Close on Escape while open.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const trimmed = description.trim();
  const canSubmit = trimmed.length > 0 && !busy;

  const onSubmit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const submitted = await submitReport({
        reportTypeCode,
        description: trimmed,
        targetEntityType: target.targetEntityType,
        targetEntityId: target.targetEntityId ?? null,
        ...(target.targetPublicId ? { targetPublicId: target.targetPublicId } : {}),
        ...(typeof target.latitude === 'number' ? { latitude: target.latitude } : {}),
        ...(typeof target.longitude === 'number' ? { longitude: target.longitude } : {}),
      });
      setResult(submitted);
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : 'Could not submit your report. Please try again.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-end justify-center bg-neutral-950/40 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Report an issue"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-t-2xl bg-white shadow-xl sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-neutral-100 p-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-neutral-950">Report an issue</h2>
            {target.contextLabel ? (
              <p className="mt-0.5 truncate text-xs text-neutral-500">{target.contextLabel}</p>
            ) : null}
          </div>
          <button
            type="button"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-neutral-200 text-neutral-500 transition-colors hover:bg-neutral-50"
            aria-label="Close"
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </div>

        {result ? (
          <SuccessView report={result} onClose={onClose} />
        ) : (
          <div className="space-y-4 p-4">
            {isAuthenticated ? (
              <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs leading-5 text-emerald-700 ring-1 ring-emerald-100">
                You may receive points if accepted by admin.
              </p>
            ) : (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-700 ring-1 ring-amber-100">
                Anonymous reports do not receive points or status updates. Log in if you want
                rewards.
              </p>
            )}

            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-neutral-600">Issue type</span>
              <select
                className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-sky-400"
                value={reportTypeCode}
                onChange={(event) => setReportTypeCode(event.target.value as ReportTypeCode)}
              >
                {REPORT_TYPE_OPTIONS.map((option) => (
                  <option key={option.code} value={option.code}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-neutral-600">
                Description
              </span>
              <textarea
                className="h-28 w-full resize-none rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-sky-400"
                placeholder="Tell us what is wrong…"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                maxLength={4000}
              />
            </label>

            {error ? <p className="text-xs text-red-600">{error}</p> : null}

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                className="rounded-full px-4 py-2 text-sm font-semibold text-neutral-600 transition-colors hover:bg-neutral-100"
                onClick={onClose}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded-full bg-sky-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!canSubmit}
                onClick={() => void onSubmit()}
              >
                {busy ? 'Submitting…' : 'Submit report'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SuccessView({
  report,
  onClose,
}: {
  readonly report: SubmittedReport;
  readonly onClose: () => void;
}) {
  return (
    <div className="space-y-3 p-4">
      <div className="rounded-lg bg-emerald-50 px-3 py-3 text-sm text-emerald-800 ring-1 ring-emerald-100">
        <p className="font-semibold">
          {report.duplicate_warning ? 'Already reported' : 'Thanks for your report!'}
        </p>
        <p className="mt-1 text-xs leading-5">
          {report.message ??
            (report.is_anonymous
              ? 'Your report was submitted anonymously.'
              : 'Our team will review it soon.')}
        </p>
      </div>

      <div className="rounded-lg border border-neutral-100 bg-neutral-50 px-3 py-2">
        <span className="block text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
          Report reference
        </span>
        <span className="block break-all font-mono text-xs text-neutral-800">
          {report.public_id}
        </span>
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          className="rounded-full bg-neutral-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-neutral-800"
          onClick={onClose}
        >
          Done
        </button>
      </div>
    </div>
  );
}

function CloseIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M4 4l8 8M12 4l-8 8"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
