export type RoutingApiErrorBody = {
  readonly message: string;
  readonly code?: string;
  readonly details?: unknown;
  readonly issues?: unknown;
  readonly engine?: string;
  readonly upstreamStatus?: number | null;
  readonly hint?: string;
};

/** Thrown when the Fastify routing API returns a non-2xx response. */
export class RoutingApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly body: RoutingApiErrorBody;

  constructor(status: number, body: RoutingApiErrorBody) {
    super(body.message || `Routing API request failed (${status})`);
    this.name = 'RoutingApiError';
    this.status = status;
    this.code = body.code ?? 'ROUTING_API_ERROR';
    this.body = body;
  }

  static async fromResponse(response: Response): Promise<RoutingApiError> {
    let body: RoutingApiErrorBody;
    try {
      const json = (await response.json()) as RoutingApiErrorBody;
      body =
        typeof json === 'object' && json !== null && 'message' in json
          ? json
          : { message: response.statusText || 'Request failed' };
    } catch {
      body = { message: response.statusText || 'Request failed' };
    }
    return new RoutingApiError(response.status, body);
  }
}

export function isRoutingApiError(error: unknown): error is RoutingApiError {
  return error instanceof RoutingApiError;
}
