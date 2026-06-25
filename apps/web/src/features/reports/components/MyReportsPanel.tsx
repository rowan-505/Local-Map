import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/features/auth/state/useAuth';
import { ApiError } from '@/features/auth/api/http';
import {
  getMyReport,
  listMyReports,
  replyToReport,
  type MyReport,
} from '../api/reportsApi';

const STATUS_BADGE: Record<string, string> = {
  submitted: 'bg-sky-50 text-sky-700 ring-sky-100',
  in_review: 'bg-indigo-50 text-indigo-700 ring-indigo-100',
  needs_more_info: 'bg-amber-50 text-amber-700 ring-amber-100',
  accepted: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
  rejected: 'bg-red-50 text-red-700 ring-red-100',
  duplicate: 'bg-neutral-100 text-neutral-600 ring-neutral-200',
};

const TARGET_LABELS: Record<string, string> = {
  place: 'Place',
  street: 'Street',
  building: 'Building',
  bus_stop: 'Bus stop',
  bus_route: 'Bus route',
  map_point: 'Map point',
};

/**
 * Signed-in user's own reports. Shows type, status, target, date, and reward
 * status. When a report needs more info, the admin's question and a reply box
 * are shown inline (owner-only; anonymous reports are never listed here).
 */
export function MyReportsPanel() {
  const { isAuthenticated, openAuthModal } = useAuth();

  const query = useQuery({
    queryKey: ['my-reports'],
    queryFn: ({ signal }) => listMyReports(signal),
    enabled: isAuthenticated,
  });

  if (!isAuthenticated) {
    return (
      <section className="p-4">
        <div className="rounded-2xl border border-dashed border-neutral-200 bg-neutral-50 p-5 text-center">
          <h2 className="text-base font-semibold text-neutral-950">Track your reports</h2>
          <p className="mt-2 text-sm leading-6 text-neutral-600">
            Sign in to see the reports you submitted, their status, and replies from the team.
          </p>
          <button
            type="button"
            className="mt-3 rounded-xl bg-sky-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-sky-700"
            onClick={() => openAuthModal('login')}
          >
            Sign in
          </button>
        </div>
      </section>
    );
  }

  if (query.isLoading) {
    return (
      <section className="p-4">
        <p className="text-sm text-neutral-500">Loading your reports…</p>
      </section>
    );
  }

  if (query.isError) {
    return (
      <section className="p-4">
        <p className="rounded-2xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">
          Could not load your reports. Try again later.
        </p>
      </section>
    );
  }

  const items = query.data ?? [];

  if (items.length === 0) {
    return (
      <section className="p-4">
        <div className="rounded-2xl border border-dashed border-neutral-200 bg-neutral-50 p-5">
          <h2 className="text-base font-semibold text-neutral-950">No reports yet</h2>
          <p className="mt-2 text-sm leading-6 text-neutral-600">
            Open a place or click the map and choose “Report” to flag a problem. Your reports
            will show up here.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-2 p-3.5" aria-label="My reports">
      {items.map((report) => (
        <MyReportCard key={report.public_id} report={report} />
      ))}
    </section>
  );
}

function MyReportCard({ report }: { readonly report: MyReport }) {
  const needsInfo = report.status.code === 'needs_more_info';

  return (
    <div className="rounded-2xl border border-neutral-100 bg-white p-3.5 shadow-sm shadow-neutral-950/3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-neutral-950">
            {report.report_type.name}
          </p>
          {targetLabel(report) ? (
            <p className="mt-0.5 truncate text-xs text-neutral-500">{targetLabel(report)}</p>
          ) : null}
          <p className="mt-0.5 text-[11px] text-neutral-400">{formatDate(report.created_at)}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <StatusBadge code={report.status.code} label={report.status.name} />
          {report.reward_granted_at ? (
            <span className="inline-flex rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 ring-1 ring-emerald-100">
              Rewarded
            </span>
          ) : null}
        </div>
      </div>

      <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-xs leading-5 text-neutral-600">
        {report.description}
      </p>

      {needsInfo ? <NeedsInfoSection publicId={report.public_id} /> : null}
    </div>
  );
}

/** Loads follow-ups for a report awaiting the owner's reply and renders the reply form. */
function NeedsInfoSection({ publicId }: { readonly publicId: string }) {
  const queryClient = useQueryClient();
  const [reply, setReply] = useState('');

  const detail = useQuery({
    queryKey: ['report', publicId],
    queryFn: ({ signal }) => getMyReport(publicId, signal),
  });

  const mutation = useMutation({
    mutationFn: (message: string) => replyToReport(publicId, message),
    onSuccess: () => {
      setReply('');
      void queryClient.invalidateQueries({ queryKey: ['my-reports'] });
      void queryClient.invalidateQueries({ queryKey: ['report', publicId] });
    },
  });

  const followups = detail.data?.followups ?? [];
  const latestAdminQuestion = [...followups]
    .reverse()
    .find((f) => f.actor_type === 'admin');

  const trimmed = reply.trim();
  const errorMessage =
    mutation.error instanceof ApiError
      ? mutation.error.message
      : mutation.isError
        ? 'Could not send your reply. Try again.'
        : null;

  return (
    <div className="mt-3 rounded-xl border border-amber-100 bg-amber-50/60 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-700">
        The team needs more info
      </p>

      {detail.isLoading ? (
        <p className="mt-1.5 text-xs text-neutral-500">Loading the question…</p>
      ) : latestAdminQuestion ? (
        <p className="mt-1.5 whitespace-pre-wrap text-sm leading-5 text-neutral-800">
          {latestAdminQuestion.message}
        </p>
      ) : (
        <p className="mt-1.5 text-sm text-neutral-700">
          Please add more details about this report.
        </p>
      )}

      {followups.length > 0 ? (
        <ul className="mt-2.5 space-y-1.5 border-t border-amber-100 pt-2.5">
          {followups.map((f, i) => (
            <li key={`${f.created_at}-${i}`} className="text-xs">
              <span className="font-semibold text-neutral-700">
                {f.actor_type === 'admin' ? 'Team' : 'You'}
              </span>
              <span className="text-neutral-400"> · {formatDate(f.created_at)}</span>
              <p className="mt-0.5 whitespace-pre-wrap leading-5 text-neutral-600">{f.message}</p>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-2.5">
        <textarea
          className="w-full resize-none rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none transition-colors focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
          rows={3}
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          placeholder="Reply to the team…"
          disabled={mutation.isPending}
        />
        {errorMessage ? (
          <p className="mt-1 text-xs font-medium text-red-700" role="alert">
            {errorMessage}
          </p>
        ) : null}
        <button
          type="button"
          className="mt-2 w-full rounded-xl bg-sky-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-sky-700 disabled:opacity-60"
          disabled={mutation.isPending || trimmed.length === 0}
          onClick={() => mutation.mutate(trimmed)}
        >
          {mutation.isPending ? 'Sending…' : 'Send reply'}
        </button>
        <p className="mt-1 text-[11px] text-neutral-400">
          Sending a reply moves your report back to “Submitted” for another review.
        </p>
      </div>
    </div>
  );
}

function StatusBadge({ code, label }: { readonly code: string; readonly label: string }) {
  const tone = STATUS_BADGE[code] ?? 'bg-neutral-100 text-neutral-600 ring-neutral-200';
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${tone}`}>
      {label}
    </span>
  );
}

function targetLabel(report: MyReport): string | null {
  if (report.target_entity_type === 'map_point') {
    if (typeof report.latitude === 'number' && typeof report.longitude === 'number') {
      return `Map point · ${report.latitude.toFixed(5)}, ${report.longitude.toFixed(5)}`;
    }
    return 'Map point';
  }
  if (report.target_entity_type) {
    const label = TARGET_LABELS[report.target_entity_type] ?? report.target_entity_type;
    return report.target_entity_id ? `${label} #${report.target_entity_id}` : label;
  }
  return null;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}
