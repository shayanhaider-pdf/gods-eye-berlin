import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectRecords, filterRecords, mixDiscover, stationRecords, STORY_CATEGORIES, MODES } from '../src/model.js';

const center = { lat: 52.52, lon: 13.405 };
const network = { stations: { type: 'FeatureCollection', features: [
  { type: 'Feature', properties: { id: 'shared', name: 'Friedrichstraße', modes: ['ubahn', 'sbahn'], lines: ['U6', 'S3'] }, geometry: { type: 'Point', coordinates: [13.388, 52.52] } },
  { type: 'Feature', properties: { id: 'bus-only', name: 'Museumstraße', modes: ['bus'], lines: ['100'] }, geometry: { type: 'Point', coordinates: [13.406, 52.521] } }
] } };
const event = (id, category, extra = {}) => ({ id, category, title: id, description: '', lat: center.lat, lon: center.lon, source: 'Original public provider', sourceUrl: 'https://example.org/original', status: 'published', ...extra });
const options = extra => ({ enabled: new Set([...MODES, ...STORY_CATEGORIES, 'places', 'stations', 'traffic', 'transit', 'alerts']), radius: 5, ...extra });

test('record assembly preserves provenance and keeps network IDs distinct from provider event IDs', () => {
  const items = collectRecords({ events: [event('shared', 'traffic')], places: [event('wiki-12', 'places', { status: 'reference' })] }, { places: [event('history-12', 'history', { status: 'reference' })] }, network, center);
  assert.equal(items.length, 5);
  assert.equal(new Set(items.map(item => item.id)).size, 5);
  assert.equal(items.find(item => item.id === 'shared').sourceUrl, 'https://example.org/original');
  assert.equal(items.find(item => item.id === 'station-shared').source, 'VBB transport network');
  assert.equal(items.find(item => item.id === 'station-shared').license, 'CC BY 4.0');
  assert.equal(items.every(item => Number.isFinite(item.distance)), true);
});

test('station feed respects shared mode toggles and the master station switch', () => {
  const records = collectRecords({}, {}, network, center);
  const railOnly = options({ enabled: new Set(['stations', 'sbahn']) });
  assert.deepEqual(filterRecords(records, railOnly).map(item => item.id), ['station-shared']);
  assert.equal(filterRecords(records, options({ enabled: new Set(['sbahn']) })).length, 0);
  assert.equal(filterRecords(records, options({ enabled: new Set(['stations']) })).length, 0);
  assert.deepEqual(filterRecords(records, options({ enabled: new Set(['stations', 'bus']) })).map(item => item.id), ['station-bus-only']);
});

test('expiry is evaluated against the selected observation time so replay differs correctly from live', () => {
  const now = Date.parse('2026-11-11T12:00:00Z');
  const records = collectRecords({ events: [event('departure', 'transit', { expiresAt: '2026-11-11T11:45:00Z' }), event('current', 'traffic', { expiresAt: '2026-11-12T00:00:00Z' })] }, {}, null, center);
  assert.deepEqual(filterRecords(records, options({ now })).map(item => item.id), ['current']);
  assert.deepEqual(filterRecords(records, options({ now: now - 30 * 60000 })).map(item => item.id), ['departure', 'current']);
});

test('activity and story tabs exclude reference-only context and invalid or outside-area coordinates', () => {
  const items = collectRecords({ events: [event('active', 'traffic'), event('bad-string', 'traffic', { lat: '52.52' }), event('bad-point', 'traffic', { lat: 100 }), event('far-away', 'traffic', { lat: 48, lon: 9 })] }, { places: [event('history', 'history', { status: 'reference' }), event('park', 'parks', { status: 'reference' })] }, network, center);
  assert.deepEqual(filterRecords(items, options({ tab: 'activity' })).map(item => item.id), ['active']);
  assert.deepEqual(filterRecords(items, options({ tab: 'stories' })).map(item => item.id), ['history', 'park']);
  assert.deepEqual(filterRecords(items, options({ query: 'U6', tab: 'stations' })).map(item => item.id), ['station-shared']);
  assert.equal(items.some(item => item.id.startsWith('bad-')), false);
});

test('mixed discoveries interleave stations, stories and activity without dropping or duplicating valid records', () => {
  const items = collectRecords({ events: [event('work1', 'traffic'), event('work2', 'traffic')], places: [event('wiki', 'places', { status: 'reference' })] }, { places: [event('history', 'history', { status: 'reference' })] }, network, center);
  const mixed = mixDiscover(items);
  assert.equal(mixed.length, items.length);
  assert.equal(new Set(mixed.map(item => item.id)).size, items.length);
  assert.equal(mixed[0].category, 'history');
  assert.equal(mixed[1].category, 'stations');
  assert.equal(mixed[2].category, 'traffic');
  assert.equal(mixed[3].category, 'places');
  assert.equal(stationRecords(network).length, 2);
});

test('German station search accepts common transliterations consistently with map filtering', () => {
  const records = collectRecords({}, {}, network, center);
  assert.deepEqual(filterRecords(records, options({ query: 'Friedrichstrasse', tab: 'stations' })).map(item => item.id), ['station-shared']);
});

test('signal predicates show only supplied delays and matching construction records', () => {
  const records = collectRecords({ events: [
    event('late', 'transit', { delay: 8 }),
    event('small-delay', 'transit', { delay: 3 }),
    event('unknown-delay', 'transit', { delay: null }),
    event('wrong-category', 'traffic', { delay: 9 }),
    event('construction', 'traffic', { title: 'Roadworks at Alexanderstraße', subtype: 'Arbeitsstelle' }),
    event('filming', 'traffic', { title: 'Film shoot', subtype: 'Filmdreharbeiten' })
  ] }, {}, null, center);
  assert.deepEqual(filterRecords(records, options({ tab: 'activity', signal: 'delayed' })).map(item => item.id), ['late']);
  assert.deepEqual(filterRecords(records, options({ tab: 'activity', signal: 'construction' })).map(item => item.id), ['construction']);
  assert.equal(filterRecords(records, options({ tab: 'activity', signal: 'delayed', enabled: new Set(['traffic']) })).length, 0, 'signals must not reveal hidden layers');
});
test('signal commands restrict results to supplied delays or construction records',()=>{
 const records=[{id:'late',category:'transit',status:'upcoming',delay:8,distance:0,title:'U8'},{id:'ontime',category:'transit',status:'upcoming',delay:0,distance:0,title:'U8'},{id:'unknown',category:'transit',status:'upcoming',delay:null,distance:0,title:'U8'},{id:'work',category:'traffic',status:'active',distance:0,title:'Roadworks',subtype:'Arbeitsstelle'},{id:'film',category:'traffic',status:'active',distance:0,title:'Filming',subtype:'Film'}];
 const options={enabled:new Set(['transit','traffic']),radius:5,tab:'activity'};
 assert.deepEqual(filterRecords(records,{...options,signal:'delayed'}).map(e=>e.id),['late']);
 assert.deepEqual(filterRecords(records,{...options,signal:'construction'}).map(e=>e.id),['work']);
});
