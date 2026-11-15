import test from 'node:test';
import assert from 'node:assert/strict';
import {validateStyleMin} from '@maplibre/maplibre-gl-style-spec';
import {LocationTracker, LocationView, coordinateSearch, accuracyArea} from './location.js';

const fix = (lat = 52.520123, lon = 13.405456, accuracy = 12, timestamp = 1000) => ({coords: {latitude: lat, longitude: lon, accuracy}, timestamp});
function gpsHarness(permissions) {
  const requests = [], positions = [], statuses = [], cleared = [];
  let watchSuccess;
  const geolocation = {
    getCurrentPosition(success, error, options) { requests.push({success, error, options}); },
    watchPosition(success) { watchSuccess = success; return 7; },
    clearWatch(id) { cleared.push(id); }
  };
  const tracker = new LocationTracker({geolocation, permissions, onPosition: (p, options) => positions.push({p, ...options}), onStatus: s => statuses.push(s)});
  return {tracker, requests, positions, statuses, cleared, watch: (...args) => watchSuccess(...args)};
}

test('startup requests high accuracy, centres on the browser coordinates and tracks improved fixes', async () => {
  const h = gpsHarness({query: async () => ({state: 'granted'})});
  await h.tracker.start();
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].options.enableHighAccuracy, true);
  h.requests[0].success(fix());
  assert.equal(h.positions[0].center, true);
  assert.equal(h.positions[0].p.lat, 52.520123);
  assert.equal(h.positions[0].p.lon, 13.405456);
  h.watch(fix(52.520124, 13.405457, 12, 1100));
  assert.equal(h.positions.at(-1).center, false, 'small GPS jitter must not restart a camera flight');
  h.watch(fix(52.520124, 13.405457, 3, 1200));
  assert.equal(h.positions.at(-1).center, true, 'a significantly more accurate fix can tighten the camera');
  h.tracker.destroy();
  assert.deepEqual(h.cleared, [7]);
});

test('searching before a GPS answer prevents that answer or later watch updates from hijacking the camera', async () => {
  const h = gpsHarness();
  await h.tracker.start();
  h.tracker.suspend();
  h.requests[0].success(fix());
  h.watch(fix(52.53, 13.41, 10, 2000));
  assert.equal(h.positions.length, 2, 'the location dot still receives real fixes');
  assert.ok(h.positions.every(p => !p.center));
  h.tracker.locate();
  h.requests[1].success(fix(52.54, 13.42, 10, 3000));
  assert.equal(h.positions.at(-1).center, true, 'My location resumes camera following');
  h.tracker.destroy();
});

test('a delayed permissions query cannot replace a later manual search or manual location request', async () => {
  let resolve;
  const h = gpsHarness({query: () => new Promise(r => { resolve = r; })});
  const starting = h.tracker.start();
  h.tracker.suspend();
  resolve({state: 'granted'});
  await starting;
  assert.equal(h.requests.length, 0);
  h.tracker.destroy();
});

test('denied permission, unavailable location and timeouts leave a usable status without inventing a position', async () => {
  const h = gpsHarness({query: async () => ({state: 'denied'})});
  await h.tracker.start();
  assert.equal(h.statuses.at(-1).state, 'denied');
  assert.equal(h.requests.length, 0);
  h.tracker.locate(); h.requests[0].error({code: 3});
  assert.equal(h.statuses.at(-1).state, 'timeout');
  assert.equal(h.positions.length, 0);
  const statuses = [];
  new LocationTracker({onStatus: s => statuses.push(s)}).locate();
  assert.equal(statuses.at(-1).state, 'unavailable');
  h.tracker.destroy();
});

test('replaced requests, old GPS fixes and callbacks after teardown are ignored', () => {
  const h = gpsHarness();
  h.tracker.locate(); h.tracker.locate();
  h.requests[0].success(fix());
  assert.equal(h.positions.length, 0);
  h.requests[1].success(fix());
  h.watch(fix(52.6, 13.5, 2, 500));
  assert.equal(h.positions.length, 1);
  h.tracker.destroy();
  h.watch(fix(52.6, 13.5, 2, 2000));
  assert.equal(h.positions.length, 1);
});

test('coordinate searches preserve precision and accuracy circles represent the reported distance', () => {
  assert.deepEqual(coordinateSearch('52.520123, 13.405456'), {lat: 52.520123, lon: 13.405456, label: '52.520123, 13.405456'});
  assert.equal(coordinateSearch('52.5, 181'), null);
  assert.equal(coordinateSearch('Berlin'), null);
  const ring = accuracyArea({lat: 52.52, lon: 13.405, accuracy: 100}).features[0].geometry.coordinates[0];
  assert.equal(ring.length, 65);
  assert.ok(Math.abs((ring[0][1] - 52.52) * 111195 - 100) < 1);
  assert.deepEqual(accuracyArea({lat: 52.52, lon: 13.405, accuracy: NaN}).features, []);
});

test('a pre-load search flies to its exact coordinates, with separate persistent search and device symbols', () => {
  const sources = {}, layers = [], markers = [], flights = [];
  const map = {addSource(id, s) { sources[id] = {...s, setData(d) { this.data = d; }}; }, addLayer(l) { layers.push(l); }, getSource(id) { return sources[id]; }};
  const view = new LocationView({fly: p => flights.push(p), createMarker: (kind, label) => {
    const marker = {kind, label, attrs: {}, setLngLat(p) { this.point = p; return this; }, addTo(m) { assert.ok(this.point, 'MapLibre requires coordinates before attaching a marker'); this.map = m; return this; }, remove() { this.removed = true; }, getElement() { return {setAttribute: (k, v) => { marker.attrs[k] = v; }}; }};
    markers.push(marker); return marker;
  }});
  view.setFocus({lat: 52.516275, lon: 13.377704, label: 'Brandenburg Gate', kind: 'search'});
  view.setPosition({lat: 52.52, lon: 13.4, accuracy: 20});
  assert.equal(flights.length, 0);
  view.attach(map);
  assert.deepEqual(flights[0], view.focus);
  assert.deepEqual(markers.find(m => m.kind === 'search').point, [13.377704, 52.516275]);
  assert.deepEqual(markers.find(m => m.kind === 'user').point, [13.4, 52.52]);
  assert.equal(sources['location-accuracy'].data.features.length, 1);
  assert.deepEqual(validateStyleMin({version: 8, sources: {'location-accuracy': {type: 'geojson', data: accuracyArea(view.position)}}, layers}), []);
  view.clearFocus();
  assert.equal(markers.find(m => m.kind === 'search').removed, true);
  assert.equal(markers.find(m => m.kind === 'user').removed, undefined);
  view.destroy();
  assert.equal(markers.find(m => m.kind === 'user').removed, true);
});
