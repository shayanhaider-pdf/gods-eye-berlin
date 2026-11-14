import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EnvironmentalOverlays } from '../src/overlays.js';
import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';

class MapStub {
  constructor() { this.loaded = false; this.sources = {}; this.layers = new Map([['record-glow', { id: 'record-glow' }], ['records', { id: 'records' }]]); this.handlers = []; this.images = new Map(); }
  on(...args) { this.handlers.push(args); }
  once(...args) { this.handlers.push(args); }
  off(...args) { this.handlers = this.handlers.filter(h => !args.every((a, i) => h[i] === a)); }
  fire(event) { for (const args of [...this.handlers]) if (args[0] === event) args.at(-1)(); }
  isStyleLoaded() { return this.loaded; }
  addSource(id, source) { assert.equal(this.sources[id], undefined, 'duplicate source'); this.sources[id] = { ...source, setData(data) { this.data = data; } }; }
  addLayer(layer, before) { assert.equal(this.layers.has(layer.id), false, 'duplicate layer'); if (before) assert.equal(this.layers.has(before), true); this.layers.set(layer.id, layer); }
  getLayer(id) { return this.layers.get(id); }
  getSource(id) { return this.sources[id]; }
  setLayoutProperty(id, key, value) { const layer = this.layers.get(id); assert.ok(layer); layer.layout = { ...layer.layout, [key]: value }; }
  removeLayer(id) { this.layers.delete(id); }
  removeSource(id) { delete this.sources[id]; }
  hasImage(id) { return this.images.has(id); }
  addImage(id, image) { this.images.set(id, image); }
  removeImage(id) { this.images.delete(id); }
}

test('overlays initialize on idle when constructed during a load callback with pending GeoJSON sources', () => {
  const previous = globalThis.document;
  const context = new Proxy({ getImageData: () => ({ width: 48, height: 48, data: new Uint8ClampedArray(48 * 48 * 4) }) }, { get: (target, key) => target[key] || (() => {}) });
  globalThis.document = { createElement: tag => { assert.equal(tag, 'canvas'); return { getContext: () => context }; } };
  const map = new MapStub();
  let overlay;
  try {
    overlay = new EnvironmentalOverlays(map);
    overlay.setVisibility({ temperature: true });
    assert.equal(overlay.ready, false);
    assert.equal(Object.keys(map.sources).length, 0);
    map.loaded = true;
    map.fire('idle');
    assert.equal(overlay.ready, true);
    assert.equal(Object.keys(map.sources).length, 5);
    assert.equal(map.getLayer('environment-temperature').layout.visibility, 'visible');
    assert.equal(map.getLayer('environment-pollution').layout.visibility, 'none');
    map.fire('idle');
    map.fire('load');
    assert.equal(Object.keys(map.sources).length, 5, 'subsequent lifecycle events must not duplicate layers');

    const sources = Object.fromEntries(Object.entries(map.sources).map(([id, source]) => [id, { type: source.type, data: source.data }]));
    const style = { version: 8, glyphs: 'https://example.org/fonts/{fontstack}/{range}.pbf', sources, layers: [...map.layers.values()].filter(layer => layer.id.startsWith('environment-')) };
    assert.deepEqual(validateStyleMin(style).map(error => error.message), []);

    overlay.destroy();
    overlay = null;
    assert.equal(Object.keys(map.sources).length, 0);
    assert.equal(map.images.size, 0);
    assert.equal(map.handlers.length, 0);
    assert.deepEqual([...map.layers.keys()], ['record-glow', 'records']);
  } finally {
    overlay?.destroy();
    if (previous === undefined) delete globalThis.document; else globalThis.document = previous;
  }
});
