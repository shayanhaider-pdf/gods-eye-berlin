import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterTransportData, TransportNetwork } from '../src/network.js';
import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';

const fc = features => ({ type: 'FeatureCollection', features });
const route = (id, mode, name, coordinates = [[13.4, 52.5], [13.41, 52.51]]) => ({ type: 'Feature', properties: { id, mode, name, color: '008000' }, geometry: { type: 'LineString', coordinates } });
const station = (id, name, modes, lines) => ({ type: 'Feature', properties: { id, name, modes, lines }, geometry: { type: 'Point', coordinates: [13.4, 52.5] } });
const data = { routes: fc([route('u2', 'ubahn', 'U2'), route('s3', 'sbahn', 'S3'), route('m10', 'tram', 'M10'), route('100', 'bus', '100')]), stations: fc([station('alex', 'Alexanderplatz', ['ubahn', 'sbahn', 'bus'], ['U2', 'S3', '100']), station('friedrich', 'Friedrichstraße', ['sbahn'], ['S3']), station('minor', 'Museumstraße', ['bus'], ['100'])]) };

test('transport mode switches keep shared stations only while a serving mode is enabled', () => {
  const visibility = { ubahn: false, sbahn: false, tram: false, bus: true, rail: false, ferry: false };
  const filtered = filterTransportData(data, visibility);
  assert.deepEqual(filtered.routes.features.map(f => f.properties.name), ['100']);
  assert.deepEqual(filtered.stations.features.map(f => f.properties.name), ['Alexanderplatz', 'Museumstraße']);
  assert.equal(filtered.stations.features[0].properties.major, false);
  assert.equal(filterTransportData(data, { ...visibility, bus: false }).stations.features.length, 0);
  assert.equal(filterTransportData(data, { stations: false }).stations.features.length, 0);
});

test('network search matches station names, line identifiers and diacritic-free names without mutating source', () => {
  assert.deepEqual(filterTransportData(data, {}, 'Friedrichstrasse').stations.features.map(f => f.properties.id), ['friedrich']);
  assert.deepEqual(filterTransportData(data, {}, 'u2').stations.features.map(f => f.properties.id), ['alex']);
  assert.equal(filterTransportData(data, {}, 'm10').routes.features.length, 1);
  assert.equal(data.routes.features[0].properties.color, '008000');
  assert.equal(filterTransportData(data).routes.features[0].properties.color, '#008000');
});

test('malformed network geometry never reaches the map', () => {
  const result = filterTransportData({ routes: fc([route('bad', 'ubahn', 'U2', [[Infinity, 52], [13, 52]]), route('unknown', 'spaceship', 'X')]), stations: fc([{ ...station('bad', 'Broken', ['ubahn'], []), geometry: { type: 'Point', coordinates: [null, 52] } }]) });
  assert.equal(result.routes.features.length, 0);
  assert.equal(result.stations.features.length, 0);
  assert.equal(filterTransportData({ routes: { features: {} }, stations: { features: 'invalid' } }).routes.features.length, 0);
});

class MapStub {
  constructor() { this.loaded = false; this.sources = {}; this.layers = new Map([['records', { id: 'records' }]]); this.handlers = []; this.cursor = { style: {} }; }
  on(...args) { this.handlers.push(args); }
  off(...args) { this.handlers = this.handlers.filter(h => !args.every((a, i) => h[i] === a)); }
  isStyleLoaded() { return this.loaded; }
  getStyle() { return { layers: [...this.layers.values()] }; }
  addSource(id, source) { assert.equal(this.sources[id], undefined, 'duplicate source'); this.sources[id] = { ...source, setData(data) { this.data = data; } }; }
  addLayer(layer) { assert.equal(this.layers.has(layer.id), false, 'duplicate layer'); this.layers.set(layer.id, layer); }
  getLayer(id) { return this.layers.get(id); }
  getSource(id) { return this.sources[id]; }
  setLayoutProperty(id, key, value) { const layer = this.layers.get(id); layer.layout = { ...layer.layout, [key]: value }; }
  removeLayer(id) { this.layers.delete(id); }
  removeSource(id) { delete this.sources[id]; }
  getCanvas() { return this.cursor; }
  queryRenderedFeatures() { return []; }
}

test('data and visibility set before map load are applied once and teardown removes all owned resources', () => {
  const map = new MapStub();
  const network = new TransportNetwork(map);
  network.setData(data);
  network.setVisibility({ tram: false, labels: false });
  assert.equal(Object.keys(map.sources).length, 0);
  map.loaded = true;
  network.loadHandler();
  network.loadHandler();
  assert.equal(Object.keys(map.sources).length, 2);
  assert.equal(map.sources['transport-routes'].data.features.some(f => f.properties.mode === 'tram'), false);
  assert.equal(map.layers.get('transport-ubahn-labels').layout.visibility, 'none');
  assert.equal(map.layers.get('transport-station-names').layout.visibility, 'none');
  assert.equal(map.layers.get('transport-ubahn').layout.visibility, 'visible');
  network.destroy();
  network.destroy();
  assert.equal(Object.keys(map.sources).length, 0);
  assert.deepEqual([...map.layers.keys()], ['records']);
  assert.equal(map.handlers.length, 0);
});

test('transport paint, layout and filter expressions satisfy the actual MapLibre style specification', () => {
  const map = new MapStub();
  map.loaded = true;
  const network = new TransportNetwork(map);
  network.setData(data);
  const sources = Object.fromEntries(Object.entries(map.sources).map(([id, source]) => [id, { type: source.type, data: source.data }]));
  const style = { version: 8, glyphs: 'https://tiles.basemaps.cartocdn.com/v/20261026-01/fonts/{fontstack}/{range}.pbf', sources, layers: [...map.layers.values()].filter(layer => layer.id !== 'records') };
  assert.deepEqual(validateStyleMin(style).map(error => error.message), []);
  network.destroy();
});
