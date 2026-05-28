import { isRoutingApiError, type RoutingApiError } from '@/features/routing/api/routingApiError';

export const ROUTING_NO_ROUTE_MESSAGE =
  'No route found between these points. Try moving start or destination closer to a road.';

export const ROUTING_SERVICE_UNAVAILABLE_MESSAGE =
  'Routing service is temporarily unavailable.';

const INVALID_COORDINATES_MESSAGE =
  'Enter valid coordinates as latitude, longitude for both points.';

const GENERIC_REQUEST_FAILED_MESSAGE =
  'Could not get directions. Check your points and try again.';

const UNAVAILABLE_ERROR_CODES = new Set([
  'ROUTING_DISABLED',
  'ROUTING_ENGINE_UNAVAILABLE',
  'ROUTING_ENGINE_TIMEOUT',
  'ROUTING_ENGINE_UPSTREAM_ERROR',
  'ROUTING_ENGINE_INVALID_RESPONSE',
  'ROUTING_ENGINE_NOT_IMPLEMENTED',
]);

const VALIDATION_ERROR_CODES = new Set([
  'ROUTING_VALIDATION_ERROR',
  'ROUTING_PROFILE_UNSUPPORTED',
  'ROUTING_PROFILE_DISABLED',
  'ROUTING_MODE_UNSUPPORTED',
  'ROUTING_MODE_DISABLED',
  'ROUTING_SERVICE_CLASS_UNSUPPORTED',
]);

export function formatRoutingClientError(error: unknown): string {
  if (isRoutingApiError(error)) {
    return formatRoutingApiError(error);
  }
  if (error instanceof Error) {
    return sanitizeRawMessage(error.message) ?? GENERIC_REQUEST_FAILED_MESSAGE;
  }
  return GENERIC_REQUEST_FAILED_MESSAGE;
}

function formatRoutingApiError(error: RoutingApiError): string {
  if (isRoutingServiceUnavailable(error)) {
    return ROUTING_SERVICE_UNAVAILABLE_MESSAGE;
  }

  if (error.code && VALIDATION_ERROR_CODES.has(error.code)) {
    return formatValidationApiError(error);
  }

  const sanitized = sanitizeRawMessage(error.message);
  if (sanitized) return sanitized;

  return GENERIC_REQUEST_FAILED_MESSAGE;
}

function isRoutingServiceUnavailable(error: RoutingApiError): boolean {
  if (error.code && UNAVAILABLE_ERROR_CODES.has(error.code)) {
    return true;
  }
  return error.status === 502 || error.status === 503 || error.status === 504;
}

function formatValidationApiError(error: RoutingApiError): string {
  if (error.code === 'ROUTING_VALIDATION_ERROR') {
    return 'Check your starting point, destination, and travel mode, then try again.';
  }

  const sanitized = sanitizeRawMessage(error.message);
  if (sanitized) return sanitized;

  return 'Some route details look invalid. Check your points and try again.';
}

function sanitizeRawMessage(message: string | undefined): string | null {
  if (!message) return null;

  const trimmed = message.trim();
  if (!trimmed) return null;
  if (looksLikeStructuredPayload(trimmed)) return null;
  if (trimmed.length > 280) return null;

  if (/ROUTING_ENABLED/i.test(trimmed) || /Enable ROUTING/i.test(trimmed)) {
    return ROUTING_SERVICE_UNAVAILABLE_MESSAGE;
  }

  return trimmed;
}

function looksLikeStructuredPayload(text: string): boolean {
  const value = text.trim();
  if (
    (value.startsWith('{') && value.endsWith('}')) ||
    (value.startsWith('[') && value.endsWith(']'))
  ) {
    return true;
  }
  return value.includes('"issues"') || value.includes('"formErrors"');
}

export function routingInvalidCoordinatesMessage(): string {
  return INVALID_COORDINATES_MESSAGE;
}
