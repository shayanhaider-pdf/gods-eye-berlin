import test from 'node:test';
import assert from 'node:assert/strict';
import { CitySimulation, seededRandom, preparePath, positionOnPath, advanceActor, classifyActivity, metresBetween } from './simulation.js';
import { getTransport } from '../server/transport.js';

test('seeded movement is reproducible without sharing global random state', () => {
  const a = seededRandom('berlin'), b = seededRandom('berlin'), c = seededRandom('seattle');
  const first = Array.from({ length: 12 }, a), second = Array.from({ length: 12 }, b);
  assert.deepEqual(first, second);
  assert.notDeepEqual(first, Array.from({ length: 12 }, c));
  assert.ok(first.every(n => n >= 0 && n < 1));
});

test('motion interpolates actual line segments and reflects at endpoints without teleporting', () => {
  const path = preparePath([[13.4, 52.5], [13.401, 52.5], [13.401, 52.501]]);
  const corner = path.cumulative[1];
  const at = positionOnPath(path, corner + 20);
  assert.ok(Math.abs(at.coordinates[0] - 13.401) < 1e-9);
  assert.ok(at.coordinates[1] > 52.5);
  const beforeEnd = positionOnPath(path, path.length - 2), afterEnd = positionOnPath(path, path.length + 2);
  assert.ok(metresBetween(beforeEnd.coordinates, afterEnd.coordinates) < .001);
  assert.equal(afterEnd.reverse, true);
  assert.equal(preparePath([[13.4, 52.5], [13.4, 52.5]]), null);
  assert.equal(preparePath([[NaN, 52], [13, null]]), null);
});

test('paused movement stays frozen and elapsed gaps are bounded', () => {
  const path = preparePath([[13.4, 52.5], [13.42, 52.5]]);
  const actor = { path, kind: 'cars', speed: 10, distance: 50, wait: 0, paused: true };
  advanceActor(actor, 5, 4); assert.equal(actor.distance, 50);
  actor.paused = false; advanceActor(actor, 5, 4);
  assert.equal(actor.distance, 54); // Long background gaps cannot jump vehicles across the map.
});

test('public activity illustrations never turn reference places or future permits into crowds', () => {
  assert.equal(classifyActivity({ category: 'places', status: 'reference', title: 'Museum event' }), null);
  assert.equal(classifyActivity({ category: 'traffic', status: 'upcoming', title: 'Roadworks' }), null);
  assert.equal(classifyActivity({ category: 'traffic', status: 'active', title: 'Arbeitsstelle Friedrichstraße' }), 'construction');
  assert.equal(classifyActivity({ category: 'traffic', status: 'active', title: 'Filmdreharbeiten' }), 'filming');
  assert.equal(classifyActivity({ category: 'alerts', status: 'published', title: 'Weather warning' }), 'notice');
});

test('simulated transit dwell uses mapped stop distances and does not alter source records', () => {
  const path = preparePath([[13.4, 52.5], [13.42, 52.5]]);
  path.dwells = [54];
  const actor = { path, kind: 'trains', speed: 20, distance: 50, wait: 0 };
  advanceActor(actor, .1, 4);
  assert.equal(actor.distance, 58); assert.equal(actor.wait, 15);
  advanceActor(actor, .1, 4); assert.equal(actor.distance, 58); assert.ok(actor.wait < 15);
});

test('actual Berlin network builds visible actors, samples CARTO roads and survives repeated UI renders', () => {
  // A minimal host contract exercises the component without pretending to be browser QA.
  const originals = Object.fromEntries(['document', 'requestAnimationFrame', 'cancelAnimationFrame', 'devicePixelRatio', 'matchMedia'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  let draws = 0, removed = false, frame = 0, queriedLayers;
  const ctx = new Proxy({}, { get: (target, property) => target[property] || (() => { if (property === 'fillRect') draws++; }), set: (target, property, value) => { target[property] = value; return true; } });
  const canvas = { style: {}, setAttribute() {}, getContext: () => ctx, remove() { removed = true; } };
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { hidden: false, createElement: () => canvas, addEventListener() {}, removeEventListener() {} } });
  Object.defineProperty(globalThis, 'requestAnimationFrame', { configurable: true, value: () => ++frame });
  Object.defineProperty(globalThis, 'cancelAnimationFrame', { configurable: true, value: () => {} });
  Object.defineProperty(globalThis, 'matchMedia', { configurable: true, value: () => ({ matches: false }) });
  const map = {
    getCanvasContainer: () => ({ appendChild() {} }),
    getCanvas: () => ({ getBoundingClientRect: () => ({ width: 900, height: 700 }) }),
    on() {}, off() {}, isStyleLoaded: () => true, getZoom: () => 13,
    getCenter: () => ({ lng: 13.405, lat: 52.52 }),
    getStyle: () => ({ layers: [{ id: 'road_minor_fill', type: 'line', 'source-layer': 'roads' }, { id: 'road_path', type: 'line', 'source-layer': 'roads' }, { id: 'rail', type: 'line', 'source-layer': 'roads' }] }),
    queryRenderedFeatures: (geometry, options) => {
      queriedLayers = options.layers;
      return [{ properties: { kind: 'minor_road', kind_detail: 'residential' }, geometry: { type: 'LineString', coordinates: [[13.4, 52.519], [13.405, 52.52], [13.409, 52.521]] } }, { properties: { kind: 'path', kind_detail: 'footway' }, geometry: { type: 'LineString', coordinates: [[13.403, 52.519], [13.405, 52.52], [13.407, 52.521]] } }];
    },
    project: ([lng, lat]) => ({ x: 450 + (lng - 13.405) * 15000, y: 350 - (lat - 52.52) * 22000 }),
  };
  try {
    const simulation = new CitySimulation(map);
    const network = getTransport({ lat: 52.52, lon: 13.405, radius: 5 });
    simulation.setNetwork(network); simulation.draw();
    assert.deepEqual(queriedLayers, ['road_minor_fill', 'road_path']);
    assert.ok(simulation.actors.some(actor => actor.kind === 'trains'));
    assert.ok(simulation.actors.some(actor => actor.kind === 'buses'));
    assert.ok(simulation.actors.some(actor => actor.kind === 'people'));
    assert.ok(simulation.actors.some(actor => actor.kind === 'cars'));
    assert.ok(simulation.visibleActorCount > 10, 'Actors should initially be in the actual observation viewport');
    assert.ok(draws > 0, 'Canvas should receive actual drawing commands');
    const actor = simulation.actors[0]; simulation.tick(100); simulation.tick(200);
    const at = actor.distance, clock = simulation.lastTick;
    simulation.setPaused(false); simulation.setVisibility({ enabled: true });
    assert.equal(simulation.lastTick, clock, 'Repeated UI renders must not reset the running animation clock');
    assert.equal(actor.distance, at, 'Visibility updates must not reconstruct or reset actors');
    simulation.setNetwork({ ...network, routes: { type: 'FeatureCollection', features: network.routes.features.filter(feature => feature.properties.mode === 'bus') } });
    assert.equal(simulation.actors.some(actor => actor.kind === 'trains'), false, 'Hidden rail modes must remove their simulated vehicles');
    simulation.setVisibility({ enabled: false }); assert.equal(canvas.hidden, true); assert.equal(simulation.frame, null);
    simulation.destroy(); assert.equal(removed, true);
  } finally {
    for (const [key, descriptor] of Object.entries(originals)) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
  }
});
