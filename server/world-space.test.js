import test from 'node:test';
import assert from 'node:assert/strict';
import {parseEarthquakes, parseLaunches, parseFires, parseCyclones, parseSatelliteTles, getSpaceLayer} from './world-space.js';

test('USGS parser preserves observed magnitude, depth and timestamps and rejects malformed coordinates', () => {
  const data = {features: [
    {id: 'one', geometry: {type: 'Point', coordinates: [13.4, 52.5, 8.2]}, properties: {title: 'M 2.5 Berlin', mag: 2.5, time: 1700000000000, updated: 1700000010000, status: 'reviewed'}},
    {id: 'bad', geometry: {type: 'Point', coordinates: [190, 52.5]}, properties: {time: 1700000000000}}
  ]};
  const items = parseEarthquakes(data);
  assert.equal(items.length, 1); assert.equal(items[0].magnitude, 2.5); assert.equal(items[0].depthKm, 8.2);
  assert.equal(items[0].updatedAt, '2023-11-14T22:13:30.000Z');
  assert.equal(items[0].status, 'published'); assert.throws(() => parseEarthquakes({features: {}}));
});

test('launches use only real launch-pad coordinates, preserve schedule and avoid Null Island fallbacks', () => {
  const items = parseLaunches({results: [
    {id: 'valid', name: 'Real launch', net: '2026-12-01T12:00:00Z', pad: {latitude: '28.5', longitude: '-80.6', name: 'Cape pad'}, status: {name: 'Go'}},
    {id: 'missing', name: 'Unknown pad', pad: {}}, {id: 'blank', pad: {latitude: '', longitude: ''}}
  ]});
  assert.equal(items.length, 1); assert.equal(items[0].lat, 28.5); assert.equal(items[0].startsAt, '2026-12-01T12:00:00.000Z');
});

test('EONET uses the latest supplied wildfire point, not an invented perimeter or non-fire event', () => {
  const items = parseFires({events: [
    {id: 'fire', title: 'Observed fire', categories: [{id: 'wildfires'}], geometry: [{type: 'Point', coordinates: [13, 52], date: '2026-01-01'}, {type: 'Point', coordinates: [14, 53], date: '2026-01-02'}]},
    {id: 'storm', categories: [{id: 'severeStorms'}], geometry: [{type: 'Point', coordinates: [13, 52], date: '2026-01-01'}]},
    {id: 'closed', closed: '2026-01-03', categories: [{id: 'wildfires'}], geometry: [{type: 'Point', coordinates: [13, 52], date: '2026-01-01'}]}
  ]});
  assert.equal(items.length, 1); assert.equal(items[0].lon, 14); assert.equal(items[0].lat, 53); assert.match(items[0].description, /does not show the fire extent/);
});

test('NOAA storms preserve advisory positions and empty seasons remain empty', () => {
  assert.deepEqual(parseCyclones({activeStorms: []}), []);
  const items = parseCyclones({activeStorms: [{id: 'al012026', name: 'Test', classification: 'Tropical Storm', latitude: 20.4, longitude: -65.1, intensity: '50', movementDir: 280, movementSpeed: 10, lastUpdate: '2026-08-01T18:00:00Z'}, {id: 'bad', latitude: null, longitude: null}]});
  assert.equal(items.length, 1); assert.equal(items[0].windKnots, 50); assert.equal(items[0].updatedAt, '2026-08-01T18:00:00.000Z');
});

const tle = 'ISS (ZARYA)\n1 25544U 98067A   24001.50000000  .00016717  00000+0  30152-3 0  9991\n2 25544  51.6416  20.0291 0002395  61.2010  39.2946 15.50000000432109';
test('satellite positions use real SGP4 propagation and distinguish predicted tracks from observations', () => {
  const result = parseSatelliteTles(tle, new Date('2024-01-01T12:00:00Z'));
  assert.equal(result.items.length, 1); assert.equal(result.items[0].noradId, '25544');
  assert.equal(result.items[0].status, 'reference'); assert.equal(result.items[0].epoch, '2024-01-01T12:00:00.000Z');
  assert.ok(result.items[0].altitude > 300000 && result.items[0].altitude < 500000);
  assert.ok(result.items[0].speed > 25000 && result.items[0].speed < 30000);
  assert.ok(result.features.features.length); assert.ok(result.features.features.every(f => f.properties.prediction));
  for (const f of result.features.features) for (let i = 1; i < f.geometry.coordinates.length; i++) assert.ok(Math.abs(f.geometry.coordinates[i][0] - f.geometry.coordinates[i - 1][0]) <= 180);
  assert.throws(() => parseSatelliteTles(tle, new Date('2024-03-01T12:00:00Z')), /recent/);
  assert.throws(() => parseSatelliteTles('<html>Provider denied</html>'), /recent/);
});

test('invalid space-layer input does not reach a provider and outages return an explicit empty state', async () => {
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('Provider offline'); };
  try {
    await assert.rejects(() => getSpaceLayer('unrecognized', {lat: 52.52, lon: 13.4}), RangeError);
    await assert.rejects(() => getSpaceLayer('earthquakes', {lat: NaN, lon: 13.4}), RangeError);
    assert.equal(calls, 0);
    const result = await getSpaceLayer('earthquakes', {lat: 52.52, lon: 13.4});
    assert.equal(result.source.status, 'unavailable'); assert.deepEqual(result.items, []); assert.deepEqual(result.features.features, []);
    assert.match(result.source.note, /Provider offline/);
  } finally { globalThis.fetch = original; }
});
