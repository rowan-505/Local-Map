import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { RoutingApiError } from '../api/routingApiError.js';

import {
  formatRoutingClientError,
  ROUTING_NO_ROUTE_MESSAGE,
  ROUTING_SERVICE_UNAVAILABLE_MESSAGE,
  routingInvalidCoordinatesMessage,
} from './formatRoutingClientMessage.js';

describe('formatRoutingClientMessage', () => {
  it('maps service unavailable codes to user message', () => {
    const error = new RoutingApiError(503, {
      message: 'Valhalla upstream failed',
      code: 'ROUTING_ENGINE_UNAVAILABLE',
    });
    assert.equal(formatRoutingClientError(error), ROUTING_SERVICE_UNAVAILABLE_MESSAGE);
  });

  it('maps validation errors without JSON', () => {
    const error = new RoutingApiError(400, {
      message: 'Invalid routing request',
      code: 'ROUTING_VALIDATION_ERROR',
      issues: { fieldErrors: {}, formErrors: [] },
    });
    assert.equal(
      formatRoutingClientError(error),
      'Check your starting point, destination, and travel mode, then try again.',
    );
  });

  it('hides JSON-like API messages', () => {
    const error = new RoutingApiError(400, {
      message: '{"issues":{"formErrors":[]}}',
      code: 'ROUTING_API_ERROR',
    });
    assert.equal(
      formatRoutingClientError(error),
      'Could not get directions. Check your points and try again.',
    );
  });

  it('exports no-route copy', () => {
    assert.match(ROUTING_NO_ROUTE_MESSAGE, /closer to a road/);
  });

  it('exports invalid coordinates copy', () => {
    assert.match(routingInvalidCoordinatesMessage(), /latitude, longitude/);
  });
});
