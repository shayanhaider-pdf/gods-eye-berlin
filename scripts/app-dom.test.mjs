/** DOM-only control smoke tests. No browser, preview server or visual claims. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { parseHTML } from 'linkedom';

const bundled = await build({ entryPoints: ['src/app.js'], bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2022', plugins: [{ name: 'unit-map-fallback', setup(b) { b.onResolve({ filter: /^maplibre-gl$/ }, () => ({ path: 'maplibre-test', namespace: 'unit' })); b.onLoad({ filter: /.*/, namespace: 'unit' }, () => ({ contents: 'export default {Map:class {constructor(){throw new Error("Map renderer intentionally unavailable in DOM unit test")}}};', loader: 'js' })); } }] });
const appCode = bundled.outputFiles[0].text;
const html = await readFile('src/index.html', 'utf8');
const source = { id: 'fixture', name: 'Fixture public provider', url: 'https://example.org/source', license: 'Public fixture license', status: 'connected', count: 80, note: 'Sourced fixture records', updatedAt: new Date().toISOString() };
const place = (id, title, category = 'history') => ({ id, title, category, description: 'A sourced history summary.', lat: 52.5205, lon: 13.4053, source: 'Wikipedia contributors', sourceUrl: 'https://en.wikipedia.org/wiki/Berlin', license: 'CC BY-SA 4.0', status: 'reference', updatedAt: null });
const points = [place('historic', 'Historic <img src=x onerror=alert(1)>', 'history'), place('park', 'Historic Berlin park', 'parks'), place('building', 'Historic Berlin architecture', 'architecture')];
const features = [
  { type: 'Feature', properties: { id: 'friedrich', name: 'Friedrichstraße', mode: 'ubahn', modes: ['ubahn', 'sbahn'], lines: ['U6', 'S3'] }, geometry: { type: 'Point', coordinates: [13.388, 52.52] } },
  { type: 'Feature', properties: { id: 'alex', name: 'Alexanderplatz', mode: 'ubahn', modes: ['ubahn'], lines: ['U2'] }, geometry: { type: 'Point', coordinates: [13.413, 52.521] } }
];
const routes = features.map((f, i) => ({ type: 'Feature', properties: { id: 'route' + i, name: i ? 'U2' : 'U6', mode: 'ubahn', color: '#0066cc' }, geometry: { type: 'LineString', coordinates: [f.geometry.coordinates, [13.405, 52.52]] } }));

async function boot() {
  const { window } = parseHTML(html);
  const storage = new Map();
  const calls = [];
  let delayedSearch;
  const fixtureFetch = async (input, options = {}) => {
    const u = new URL(String(input), 'https://around-me.test'); calls.push(u);
    if (u.pathname === '/api/search' && delayedSearch) return new Promise(resolve => delayedSearch.resolve = resolve);
    const berlin = Math.abs(Number(u.searchParams.get('lat')) - 52.52) < 0.3;
    let data;
    if (u.pathname === '/api/overview') data = { events: berlin ? Array.from({ length: 80 }, (_, i) => ({ id: 'work-' + i, category: 'traffic', title: 'Roadworks ' + i, subtype: 'Arbeitsstelle', description: 'Published construction permit.', lat: 52.52 + i * 0.00001, lon: 13.405, source: source.name, sourceUrl: source.url, status: 'active', expiresAt: new Date(Date.now() + 86400000).toISOString() })) : [], places: berlin ? [place('wiki-1', 'Other nearby place', 'places')] : [], sources: [source], weather: null, airQuality: null };
    else if (u.pathname === '/api/transport') data = { routes: { type: 'FeatureCollection', features: berlin ? routes : [] }, stations: { type: 'FeatureCollection', features: berlin ? features : [] }, source: { ...source, name: 'VBB GTFS fixture' } };
    else if (u.pathname === '/api/explore') data = { places: berlin ? points : [], sources: [{ ...source, id: 'history', name: 'History fixture' }] };
    else if (u.pathname === '/api/place') data = { title: 'Historic Berlin place', extract: 'A sourced history paragraph.\n\nLiteral <script>alert(1)</script> text stays text.', source: 'Wikipedia contributors', sourceUrl: 'https://en.wikipedia.org/wiki/Berlin', license: 'CC BY-SA 4.0' };
    else if (u.pathname === '/api/search') data = { results: [{ label: 'Berlin test address', lat: 52.52, lon: 13.405 }] };
    else throw new Error('Unexpected fixture request ' + u.pathname);
    return Response.json(data);
  };
  const timers = new Set();
  const timeout = (fn, ms) => { const timer = setTimeout(() => { timers.delete(timer); fn(); }, ms); timer.unref?.(); timers.add(timer); return timer; };
  const context = vm.createContext({ window, document: window.document, navigator: { geolocation: { getCurrentPosition: (_success, error) => error({ code: 1 }) } }, location: new URL('https://around-me.test'), console, localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) }, matchMedia: () => ({ matches: false }), fetch: fixtureFetch, URL, URLSearchParams, Response, Request, AbortController, Blob, FormData, setTimeout: timeout, clearTimeout: timer => { timers.delete(timer); clearTimeout(timer); }, setInterval: () => 0, clearInterval: () => {}, requestAnimationFrame: () => 0, cancelAnimationFrame: () => {}, performance, Event: window.Event });
  vm.runInContext(appCode, context, { timeout: 5000 });
  const q = selector => window.document.querySelector(selector);
  const flush = async () => { for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve)); };
  await flush();
  return { window, q, calls, storage, flush, delaySearch: () => { delayedSearch = {}; return delayedSearch; }, close() { window.dispatchEvent(new window.Event('pagehide')); for (const timer of timers) clearTimeout(timer); } };
}

test('app boots in the documented map fallback and wires layer library, mixed feed, pagination and source inspection', async () => {
  const app = await boot();
  try {
    assert.ok(app.window.document.querySelectorAll('[data-layer]').length >= 34);
    for (const key of ['ubahn', 'sbahn', 'tram', 'bus', 'history', 'geography', 'people', 'cars', 'activityCrews']) assert.ok(app.q(`[data-layer="${key}"]`));
    assert.match(app.q('#map-message').textContent, /could not start the map renderer/i);
    assert.match(app.q('#brief-summary').textContent, /2 stops.*3 stories.*80 public activity records/);
    assert.equal(app.window.document.querySelectorAll('[data-record]').length, 60);
    app.q('#load-more').click();
    assert.equal(app.window.document.querySelectorAll('[data-record]').length, 86);
    app.q('#sources-button').click();
    assert.ok(app.window.document.querySelectorAll('.source-row').length >= 3);
    assert.match(app.q('.modal').textContent, /VBB GTFS fixture/);
    app.q('.modal-close').click();
    app.q('#toggle-all').click();
    assert.equal(app.window.document.querySelectorAll('[data-layer][aria-pressed="true"]').length, 0);
    assert.equal(app.window.document.querySelectorAll('[data-record]').length, 0);
  } finally { app.close(); }
});

test('story and station presets, German station filtering and safe historical detail text are wired', async () => {
  const app = await boot();
  try {
    app.q('[data-preset="transport"]').click();
    assert.equal(app.window.document.querySelectorAll('[data-record]').length, 2);
    app.q('#record-query').value = 'Friedrichstrasse';
    app.q('#record-query').dispatchEvent(new app.window.Event('input', { bubbles: true }));
    assert.equal(app.window.document.querySelectorAll('[data-record]').length, 1);
    assert.match(app.q('[data-record] h3').textContent, /Friedrichstraße/);
    app.q('[data-preset="stories"]').click();
    assert.equal(app.window.document.querySelectorAll('[data-record]').length, 3);
    app.q('[data-record="historic"]').click();
    await app.flush();
    assert.equal(app.q('#detail-title').textContent, 'Historic <img src=x onerror=alert(1)>');
    assert.equal(app.window.document.querySelectorAll('#detail-container img').length, 0);
    assert.equal(app.window.document.querySelectorAll('#detail-container script').length, 0);
    assert.match(app.q('#place-story').textContent, /Literal <script>alert\(1\)<\/script> text stays text/);
    assert.match(app.q('.story-attribution').textContent, /CC BY-SA 4.0/);
    assert.doesNotMatch(app.q('.detail-panel').textContent, /1970/);
    app.q('#close-detail').click();
    assert.equal(app.q('#detail-container').children.length, 0);
  } finally { app.close(); }
});

test('late location-search responses do not overwrite a city change and geolocation denial stays usable', async () => {
  const app = await boot();
  try {
    const delayed = app.delaySearch();
    app.q('#location-query').value = 'Alexanderplatz';
    const pending = app.q('#search-form').onsubmit({ preventDefault() {} });
    await app.flush();
    assert.ok(delayed.resolve);
    app.q('#city').onchange({ target: { value: 'seattle' } });
    delayed.resolve(Response.json({ results: [{ label: 'Stale Berlin result', lat: 52.52, lon: 13.405 }] }));
    await pending;
    await app.flush();
    assert.match(app.q('#area-name').textContent, /Seattle/);
    assert.equal(app.q('#search-results').hidden, true);
    assert.doesNotMatch(app.q('#search-results').textContent, /Stale Berlin result/);
    app.q('#locate').click();
    assert.equal(app.q('#locate').disabled, false);
    assert.match(app.q('#toast').textContent, /Location was not shared/);
  } finally { app.close(); }
});
