import { useState } from 'react';
import { useDialogFocus } from '@/components/ui/useDialogFocus';
import { useAuth } from '@/features/auth/state/useAuth';
import { useMapUiText } from '@/features/map/i18n/mapUiText';
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
  const t = useMapUiText();
  const { isAuthenticated } = useAuth();
  const [reportTypeCode, setReportTypeCode] = useState<ReportTypeCode>(DEFAULT_TYPE);
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SubmittedReport | null>(null);
  const closeAndReset = () => {
    setReportTypeCode(DEFAULT_TYPE);
    setDescription('');
    setBusy(false);
    setError(null);
    setResult(null);
    onClose();
  };
  const dialogRef = useDialogFocus(open, closeAndReset);

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
          : t('ပေးပို့၍မရပါ။', 'Could not submit.'),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      ref={dialogRef}
      className="fixed inset-0 z-[1000] flex items-end justify-center bg-slate-950/45 p-0 backdrop-blur-[2px] sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t('ပြဿနာတိုင်ကြားရန်', 'Report an issue')}
      tabIndex={-1}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closeAndReset();
      }}
    >
      <div className="w-full max-w-md rounded-t-3xl border border-white/80 bg-map-surface shadow-map-float sm:rounded-3xl">
        <div className="flex items-start justify-between gap-3 border-b border-map-border/70 bg-[linear-gradient(135deg,#fff,#eaf4ff)] p-4 sm:rounded-t-3xl">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-map-ink">{t('ပြဿနာတိုင်ကြားရန်', 'Report an issue')}</h2>
            {target.contextLabel ? (
              <p className="mt-0.5 truncate text-xs text-map-muted">{target.contextLabel}</p>
            ) : null}
          </div>
          <button
            type="button"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-map-border text-map-muted transition-colors hover:bg-map-primary-soft hover:text-map-primary"
            aria-label={t('ပိတ်ရန်', 'Close')}
            onClick={closeAndReset}
          >
            <CloseIcon />
          </button>
        </div>

        {result ? (
          <SuccessView report={result} onClose={closeAndReset} />
        ) : (
          <div className="space-y-4 p-4">
            {isAuthenticated ? (
              <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs leading-5 text-emerald-700 ring-1 ring-emerald-100">
                {t('လက်ခံပါက အမှတ်ရနိုင်သည်။', 'Accepted reports may earn points.')}
              </p>
            ) : (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-700 ring-1 ring-amber-100">
                {t(
                  'အမည်မဖော်သော တိုင်ကြားချက်များသည် အမှတ်မရပါ။',
                  'Anonymous reports do not earn points.',
                )}
              </p>
            )}

            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-map-muted">
                {t('ပြဿနာအမျိုးအစား', 'Issue type')}
              </span>
              <select
                data-dialog-autofocus
                className="w-full rounded-map-control border border-map-border bg-map-surface px-3 py-2 text-sm text-map-ink outline-none focus:border-map-primary "
                value={reportTypeCode}
                onChange={(event) => setReportTypeCode(event.target.value as ReportTypeCode)}
              >
                {REPORT_TYPE_OPTIONS.map((option) => (
                  <option key={option.code} value={option.code}>
                    {reportTypeLabel(option.code, option.label, t)}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-map-muted">
                {t('ဖော်ပြချက်', 'Description')}
              </span>
              <textarea
                className="h-28 w-full resize-none rounded-map-control border border-map-border bg-map-surface px-3 py-2 text-sm text-map-ink outline-none focus:border-map-primary "
                placeholder={t('ဘာမှားနေသည်ကို ပြောပြပါ…', 'Tell us what is wrong…')}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                maxLength={4000}
              />
            </label>

            {error ? <p className="text-xs text-red-600">{error}</p> : null}

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                className="rounded-full px-4 py-2 text-sm font-semibold text-map-muted transition-colors hover:bg-map-primary-soft hover:text-map-primary"
                onClick={closeAndReset}
              >
                {t('ပယ်ဖျက်ရန်', 'Cancel')}
              </button>
              <button
                type="button"
                className="rounded-full bg-map-primary px-4 py-2 text-sm font-semibold text-white shadow-map-control transition-colors hover:bg-map-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!canSubmit}
                onClick={() => void onSubmit()}
              >
                {busy ? t('ပေးပို့နေသည်…', 'Submitting…') : t('တိုင်ကြားချက်ပို့ရန်', 'Submit report')}
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
  const t = useMapUiText();
  return (
    <div className="space-y-3 p-4">
      <div className="rounded-lg bg-emerald-50 px-3 py-3 text-sm text-emerald-800 ring-1 ring-emerald-100">
        <p className="font-semibold">
          {report.duplicate_warning
            ? t('တိုင်ကြားပြီးဖြစ်သည်', 'Already reported')
            : t('တိုင်ကြားပေးသည့်အတွက် ကျေးဇူးတင်ပါသည်။', 'Thanks for your report!')}
        </p>
        <p className="mt-1 text-xs leading-5">
          {report.message ??
            (report.is_anonymous
              ? t('တိုင်ကြားချက်ကို အမည်မဖော်ဘဲ ပေးပို့ပြီးပါပြီ။', 'Your report was submitted anonymously.')
              : t('မကြာမီ စစ်ဆေးမည်။', 'We will review it soon.'))}
        </p>
      </div>

      <div className="rounded-map-control border border-map-border bg-map-bg px-3 py-2">
        <span className="map-kicker block text-map-muted">
          {t('တိုင်ကြားချက် ရည်ညွှန်းနံပါတ်', 'Report reference')}
        </span>
        <span className="block break-all font-mono text-xs text-map-ink">
          {report.public_id}
        </span>
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          className="rounded-full bg-map-primary px-4 py-2 text-sm font-semibold text-white shadow-map-control transition-colors hover:bg-map-primary-hover"
          onClick={onClose}
        >
          {t('ပြီးပါပြီ', 'Done')}
        </button>
      </div>
    </div>
  );
}

function reportTypeLabel(
  code: ReportTypeCode,
  english: string,
  t: (myanmar: string, english: string) => string,
): string {
  const labels: Record<ReportTypeCode, string> = {
    wrong_info: 'အချက်အလက် မှားနေသည်',
    wrong_location: 'တည်နေရာ မှားနေသည်',
    missing_item: 'အချက်အလက် ပျောက်နေသည်',
    closed_or_removed: 'ပိတ်ထားသည် သို့မဟုတ် ဖယ်ရှားပြီး',
    duplicate_item: 'ထပ်နေသော အချက်အလက်',
    transport_issue: 'အများသုံးယာဉ် ပြဿနာ',
    community_info: 'လူထုအချက်အလက်',
    other_map_issue: 'အခြားပြဿနာ',
  };
  return t(labels[code], english);
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
