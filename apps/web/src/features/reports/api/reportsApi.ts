import { ApiError, authJson, getApiBaseUrl } from '@/features/auth/api/http';
import { getAccessToken } from '@/features/auth/lib/tokenStorage';
import { getOrCreateAnonymousId } from '../lib/anonymousId';

/** Report categories with their public display labels (other_map_issue → "Others"). */
export const REPORT_TYPE_OPTIONS = [
  { code: 'wrong_info', label: 'Wrong information' },
  { code: 'wrong_location', label: 'Wrong location' },
  { code: 'missing_item', label: 'Missing item' },
  { code: 'closed_or_removed', label: 'Closed or removed' },
  { code: 'duplicate_item', label: 'Duplicate item' },
  { code: 'transport_issue', label: 'Transport issue' },
  { code: 'community_info', label: 'Community info' },
  { code: 'other_map_issue', label: 'Others' },
] as const;

export type ReportTypeCode = (typeof REPORT_TYPE_OPTIONS)[number]['code'];

export type ReportTargetEntityType = 'place' | 'map_point';

/** What is being reported — supplied by the surface that opens the modal. */
export type ReportTarget = {
  readonly targetEntityType: ReportTargetEntityType;
  readonly targetEntityId?: number | null;
  readonly targetPublicId?: string;
  readonly latitude?: number;
  readonly longitude?: number;
  /** Optional human label shown in the modal header (place name or coordinates). */
  readonly contextLabel?: string;
};

export type SubmitReportInput = ReportTarget & {
  readonly reportTypeCode: ReportTypeCode;
  readonly description: string;
};

/** Subset of the API report payload the web client needs after submitting. */
export type SubmittedReport = {
  readonly public_id: string;
  readonly is_anonymous: boolean;
  readonly status: { readonly code: string; readonly name: string };
  /** true when the API matched a recent duplicate from the same submitter. */
  readonly duplicate_warning?: boolean;
  readonly message?: string | null;
};

function buildBody(input: SubmitReportInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    reportTypeCode: input.reportTypeCode,
    description: input.description,
    targetEntityType: input.targetEntityType,
  };
  if (input.targetEntityType !== 'map_point' && input.targetEntityId != null) {
    body.targetEntityId = input.targetEntityId;
  }
  if (input.targetPublicId) body.targetPublicId = input.targetPublicId;
  if (typeof input.latitude === 'number') body.latitude = input.latitude;
  if (typeof input.longitude === 'number') body.longitude = input.longitude;
  return body;
}

/**
 * Submits a report to POST /reports. Signed-in users send their bearer token
 * (point-eligible). Guests send a persisted anonymous_id via header + body and
 * are never point-eligible.
 */
export async function submitReport(input: SubmitReportInput): Promise<SubmittedReport> {
  const body = buildBody(input);

  if (getAccessToken()) {
    return authJson<SubmittedReport>('/reports', { method: 'POST', body });
  }

  const anonymousId = getOrCreateAnonymousId();
  const response = await fetch(`${getApiBaseUrl()}/reports`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-anonymous-id': anonymousId,
    },
    body: JSON.stringify({ ...body, anonymousId }),
  });

  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const errorBody = (await response.json()) as { message?: unknown };
      if (typeof errorBody?.message === 'string' && errorBody.message.trim() !== '') {
        message = errorBody.message;
      }
    } catch {
      // Non-JSON error body; keep the generic message.
    }
    throw new ApiError(response.status, message);
  }

  return response.json() as Promise<SubmittedReport>;
}

export type ReportCodeName = { readonly code: string; readonly name: string };

/** A report owned by the signed-in user (GET /me/reports). */
export type MyReport = {
  readonly public_id: string;
  readonly is_anonymous: boolean;
  readonly eligible_for_points: boolean;
  readonly report_type: ReportCodeName;
  readonly status: ReportCodeName;
  readonly target_entity_type: string | null;
  readonly target_entity_id: string | null;
  readonly target_public_id: string | null;
  readonly title: string | null;
  readonly description: string;
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly reward_granted_at: string | null;
  readonly created_at: string;
};

/** An admin or user message attached to a report. Anonymous reports never have these. */
export type ReportFollowup = {
  readonly actor_type: string;
  readonly actor_display_name: string | null;
  readonly message: string;
  readonly created_at: string;
};

export type MyReportDetail = MyReport & {
  readonly followups: readonly ReportFollowup[];
};

/** Lists the signed-in user's own reports (owner-only; anonymous reports excluded). */
export async function listMyReports(signal?: AbortSignal): Promise<readonly MyReport[]> {
  return authJson<MyReport[]>('/me/reports', signal ? { signal } : {});
}

/** Fetches one of the user's reports with its follow-up message history. */
export async function getMyReport(
  publicId: string,
  signal?: AbortSignal,
): Promise<MyReportDetail> {
  return authJson<MyReportDetail>(`/reports/${encodeURIComponent(publicId)}`, signal ? { signal } : {});
}

/**
 * Posts the owner's reply to an admin question. Only valid when the report is in
 * `needs_more_info`; the API moves it back to `submitted` and returns the updated
 * report with the full follow-up history.
 */
export async function replyToReport(
  publicId: string,
  message: string,
): Promise<MyReportDetail> {
  return authJson<MyReportDetail>(`/reports/${encodeURIComponent(publicId)}/followups`, {
    method: 'POST',
    body: { message },
  });
}
