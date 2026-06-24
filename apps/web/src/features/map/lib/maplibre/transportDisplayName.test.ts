import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  FERRY_VEHICLE_ACCESS_UNKNOWN,
  getFerryPopupTitle,
  getFerryVehicleAccessNote,
  getTransportDisplayName,
  getTransportPopupTitle,
  getTransportTerminalDisplayClass,
  hasExplicitVehicleAccessInfo,
  isBlankTransportName,
  isGeneratedOsmTransportName,
  isRealTransportDisplayName,
} from './transportDisplayName.js';

describe('isBlankTransportName', () => {
  it('treats null, undefined, and whitespace-only strings as blank', () => {
    assert.equal(isBlankTransportName(null), true);
    assert.equal(isBlankTransportName(undefined), true);
    assert.equal(isBlankTransportName(''), true);
    assert.equal(isBlankTransportName('   '), true);
  });

  it('treats real strings as not blank', () => {
    assert.equal(isBlankTransportName('Pansodan Ferry'), false);
    assert.equal(isBlankTransportName('  x  '), false);
  });
});

describe('isGeneratedOsmTransportName', () => {
  it('detects osm id substrings', () => {
    assert.equal(isGeneratedOsmTransportName('ferry_terminal osm:N:5305226755'), true);
    assert.equal(isGeneratedOsmTransportName('osm:W:123'), true);
    assert.equal(isGeneratedOsmTransportName('osm:R:123'), true);
    assert.equal(isGeneratedOsmTransportName('osm:N:123'), true);
  });

  it('detects known generated import prefixes', () => {
    assert.equal(isGeneratedOsmTransportName('bus_stop osm:42'), true);
    assert.equal(isGeneratedOsmTransportName('station osm:42'), true);
    assert.equal(isGeneratedOsmTransportName('terminal osm:42'), true);
    assert.equal(isGeneratedOsmTransportName('stop osm:42'), true);
  });

  it('returns false for blank or real names', () => {
    assert.equal(isGeneratedOsmTransportName(''), false);
    assert.equal(isGeneratedOsmTransportName(null), false);
    assert.equal(isGeneratedOsmTransportName('Pansodan Ferry Terminal'), false);
  });
});

describe('isRealTransportDisplayName', () => {
  it('is true only for non-blank, non-generated names', () => {
    assert.equal(isRealTransportDisplayName('Pansodan Ferry'), true);
    assert.equal(isRealTransportDisplayName('ferry_terminal osm:N:5305226755'), false);
    assert.equal(isRealTransportDisplayName(''), false);
    assert.equal(isRealTransportDisplayName(null), false);
  });
});

describe('getTransportDisplayName', () => {
  it('prefers name_mm, then name_en, then name', () => {
    assert.equal(
      getTransportDisplayName({ name_mm: 'ပန်းဆိုးတန်း', name_en: 'Pansodan' }),
      'ပန်းဆိုးတန်း',
    );
    assert.equal(getTransportDisplayName({ name_en: 'Pansodan', name: 'osm:N:1' }), 'Pansodan');
    assert.equal(getTransportDisplayName({ name: 'Real Name' }), 'Real Name');
  });

  it('returns null when no candidate is a real display name', () => {
    assert.equal(getTransportDisplayName({ name: 'ferry_terminal osm:N:5305226755' }), null);
    assert.equal(getTransportDisplayName({ name_mm: '', name_en: null }), null);
    assert.equal(getTransportDisplayName({}), null);
  });
});

describe('getFerryPopupTitle', () => {
  it('returns the real name when present', () => {
    assert.equal(getFerryPopupTitle({ mode: 'ferry', name_en: 'Pansodan' }), 'Pansodan');
  });

  it('returns "Ferry landing" for an unnamed ferry', () => {
    assert.equal(
      getFerryPopupTitle({ mode: 'ferry', name: 'ferry_terminal osm:N:5305226755' }),
      'Ferry landing',
    );
  });

  it('returns null for an unnamed non-ferry', () => {
    assert.equal(getFerryPopupTitle({ mode: 'bus', name: 'bus_stop osm:1' }), null);
  });
});

describe('generated OSM name safety (spec cases)', () => {
  it('"ferry_terminal osm:N:5018985561" → displayName null, ferry title "Ferry landing"', () => {
    const props = { name: 'ferry_terminal osm:N:5018985561', mode: 'ferry' };
    assert.equal(getTransportDisplayName(props), null);
    assert.equal(getFerryPopupTitle(props), 'Ferry landing');
    assert.equal(getTransportPopupTitle(props, 'terminal'), 'Ferry landing');
  });

  it('"osm:N:123" → displayName null', () => {
    assert.equal(getTransportDisplayName({ name: 'osm:N:123' }), null);
  });

  it('empty string → displayName null', () => {
    assert.equal(getTransportDisplayName({ name: '' }), null);
  });

  it('"Dala Ferry Terminal" → displayName unchanged', () => {
    assert.equal(getTransportDisplayName({ name: 'Dala Ferry Terminal' }), 'Dala Ferry Terminal');
  });

  it('name_mm is preferred over name_en and name', () => {
    assert.equal(
      getTransportDisplayName({
        name_mm: 'ဒလဆိပ်ကမ်း',
        name_en: 'Dala Ferry Terminal',
        name: 'ferry_terminal osm:N:5018985561',
      }),
      'ဒလဆိပ်ကမ်း',
    );
  });

  it('no generated OSM name is ever used as a popup title', () => {
    const generated = [
      'ferry_terminal osm:N:5018985561',
      'osm:N:123',
      'osm:W:123',
      'osm:R:123',
      'bus_stop osm:1',
      'station osm:1',
      'terminal osm:1',
      'stop osm:1',
    ];
    for (const name of generated) {
      for (const kind of ['terminal', 'stop', 'route', 'infrastructure'] as const) {
        const title = getTransportPopupTitle({ name }, kind);
        assert.equal(isGeneratedOsmTransportName(title), false, `${kind}: "${name}" → "${title}"`);
      }
    }
  });
});

describe('getTransportPopupTitle', () => {
  it('never returns a generated OSM name; unnamed ferry → "Ferry landing"', () => {
    assert.equal(
      getTransportPopupTitle(
        { mode: 'ferry', name: 'ferry_terminal osm:N:5018985561' },
        'terminal',
      ),
      'Ferry landing',
    );
  });

  it('returns the real name when one exists', () => {
    assert.equal(
      getTransportPopupTitle({ mode: 'ferry', name_en: 'Pansodan' }, 'terminal'),
      'Pansodan',
    );
    assert.equal(
      getTransportPopupTitle({ name_mm: 'ပန်းဆိုးတန်း' }, 'stop'),
      'ပန်းဆိုးတန်း',
    );
  });

  it('falls back to a generic per-kind label for non-ferry features with no real name', () => {
    assert.equal(
      getTransportPopupTitle({ mode: 'bus', name: 'terminal osm:1' }, 'terminal'),
      'Transport terminal',
    );
    assert.equal(
      getTransportPopupTitle({ mode: 'bus', name: 'bus_stop osm:1' }, 'stop'),
      'Transport stop',
    );
    assert.equal(getTransportPopupTitle({}, 'infrastructure'), 'Transport feature');
  });

  it('prefers safe route fields for routes, then "Transport route"', () => {
    assert.equal(getTransportPopupTitle({ route_code: 'YBS-37' }, 'route'), 'YBS-37');
    assert.equal(getTransportPopupTitle({ public_name: 'Circular Line' }, 'route'), 'Circular Line');
    assert.equal(getTransportPopupTitle({}, 'route'), 'Transport route');
  });
});

describe('vehicle access', () => {
  it('defaults to unknown when no vehicle tags exist (typical Martin tile)', () => {
    assert.equal(hasExplicitVehicleAccessInfo({ mode: 'ferry', amenity: 'ferry_terminal' }), false);
    assert.equal(
      getFerryVehicleAccessNote({ mode: 'ferry', amenity: 'ferry_terminal' }),
      FERRY_VEHICLE_ACCESS_UNKNOWN,
    );
  });

  it('does not infer vehicle support from amenity=ferry_terminal or ferry=yes', () => {
    assert.equal(
      getFerryVehicleAccessNote({ amenity: 'ferry_terminal', ferry: 'yes' }),
      FERRY_VEHICLE_ACCESS_UNKNOWN,
    );
  });

  it('reports allowed/denied only from explicit vehicle tags', () => {
    assert.equal(getFerryVehicleAccessNote({ motor_vehicle: 'yes' }), 'Vehicles can board');
    assert.equal(getFerryVehicleAccessNote({ motorcar: 'designated' }), 'Vehicles can board');
    assert.equal(getFerryVehicleAccessNote({ vehicle: 'no' }), 'No vehicle access');
  });

  it('stays unknown for explicit-but-unrecognized values', () => {
    assert.equal(getFerryVehicleAccessNote({ motor_vehicle: 'maybe' }), FERRY_VEHICLE_ACCESS_UNKNOWN);
  });
});

describe('getTransportTerminalDisplayClass', () => {
  it('classifies an unnamed imported ferry as a ferry landing candidate', () => {
    assert.equal(
      getTransportTerminalDisplayClass({
        mode: 'ferry',
        review_status: 'imported_unreviewed',
        name: 'ferry_terminal osm:N:5305226755',
      }),
      'ferry_landing_candidate',
    );
  });

  it('classifies a named imported ferry as a named ferry landing candidate', () => {
    assert.equal(
      getTransportTerminalDisplayClass({
        mode: 'ferry',
        review_status: 'imported_unreviewed',
        name_en: 'Pansodan Ferry',
      }),
      'named_ferry_landing_candidate',
    );
  });

  it('classifies a named bus/train/air terminal as a major terminal candidate', () => {
    assert.equal(
      getTransportTerminalDisplayClass({ mode: 'bus', name_en: 'Aung Mingalar' }),
      'major_terminal_candidate',
    );
    assert.equal(
      getTransportTerminalDisplayClass({ mode: 'train', name_en: 'Yangon Central' }),
      'major_terminal_candidate',
    );
  });

  it('falls back to unreviewed terminal candidate otherwise', () => {
    assert.equal(
      getTransportTerminalDisplayClass({ mode: 'bus', name: 'bus_stop osm:1' }),
      'unreviewed_terminal_candidate',
    );
    assert.equal(
      getTransportTerminalDisplayClass({
        mode: 'ferry',
        review_status: 'verified',
        name: 'osm:N:1',
      }),
      'unreviewed_terminal_candidate',
    );
  });
});
