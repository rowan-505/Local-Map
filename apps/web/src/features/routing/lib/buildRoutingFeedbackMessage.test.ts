import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildRoutingFeedbackMessage } from './buildRoutingFeedbackMessage.js';

describe('buildRoutingFeedbackMessage', () => {
  it('appends route context without showing extra fields in UI', () => {
    const message = buildRoutingFeedbackMessage('Road was closed', {
      status: 'ok',
      routingEngine: 'valhalla',
      profile: 'motorcycle',
      summary: { distanceMeters: 1200, durationSeconds: 300, transferCount: 0 },
      geometry: {
        type: 'LineString',
        coordinates: [
          [96.1, 16.8],
          [96.2, 16.9],
        ],
      },
      legs: [],
      warnings: [],
      debug: { requestId: '00000000-0000-4000-8000-000000000001' },
    });

    assert.match(message, /^Road was closed/);
    assert.match(message, /\[route-context\]/);
    assert.match(message, /"distanceMeters":1200/);
    assert.match(message, /"geometryPointCount":2/);
  });
});
