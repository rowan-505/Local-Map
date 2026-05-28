import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    filterUserFacingRouteWarnings,
    isTechnicalRouteWarning,
} from './routeDisplayWarnings.js';

describe('routeDisplayWarnings', () => {
    it('hides polyline decode debug messages', () => {
        assert.equal(
            isTechnicalRouteWarning(
                'Decoded Valhalla encoded polyline shape (geojson was not returned).',
            ),
            true,
        );
    });

    it('keeps user-facing trip warnings', () => {
        assert.equal(isTechnicalRouteWarning('Route may include toll roads.'), false);
        assert.equal(isTechnicalRouteWarning('Route may include time restrictions.'), false);
    });

    it('hides motorcycle costing fallback debug text', () => {
        assert.equal(
            isTechnicalRouteWarning(
                'Motorcycle profile routed with Valhalla auto costing (motorcycle costing disabled or unavailable).',
            ),
            true,
        );
        assert.equal(
            isTechnicalRouteWarning(
                'TODO: enable Valhalla motorcycle costing in tile build; retried with auto.',
            ),
            true,
        );
    });

    it('filters mixed warning lists', () => {
        const filtered = filterUserFacingRouteWarnings([
            'Decoded Valhalla encoded polyline shape (geojson was not returned).',
            'Route may include toll roads.',
            'Bridge work ahead',
        ]);
        assert.deepEqual(filtered, ['Route may include toll roads.', 'Bridge work ahead']);
    });
});
