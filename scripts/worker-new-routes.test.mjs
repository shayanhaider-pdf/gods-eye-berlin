import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../server/worker.js';
const request = path => new Request('https://around-me.test' + path);

test('new transport, exploration, place and overlay boundaries reject invalid input before provider requests', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = () => { assert.fail('Invalid input reached an upstream provider'); };
  try {
    const bad = [
      '/api/transport?lat=&lon=13.4', '/api/transport?lat=52.5&lon=181', '/api/transport?lat=52.5&lon=13.4&radius=21',
      '/api/explore?lat=52.5', '/api/explore?lat=NaN&lon=13.4', '/api/explore?lat=52.5&lon=13.4&radius=0',
      '/api/overlays?lat=52.5&lon=13.4&kind=unknown', '/api/overlays?lat=81&lon=13.4&kind=radar', '/api/overlays?lat=52.5&lon=13.4&kind=weather&radius=',
      '/api/place?lat=52.5&lon=13.4', '/api/place?title=Berlin&lat=52.5&lon=13.4&pageId=0', '/api/place?title=Berlin&lat=52.5&lon=13.4&pageId=abc',
      '/api/place?title=Berlin%7CParis&lat=52.5&lon=13.4', '/api/place?title=Berlin%00&lat=52.5&lon=13.4'
    ];
    for (const path of bad) assert.equal((await worker.fetch(request(path))).status, 400, path);
  } finally { globalThis.fetch = original; }
});

test('published network and curated place history are served without a live provider connection', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = () => { assert.fail('Static reference context unexpectedly required a network provider'); };
  try {
    const networkResponse = await worker.fetch(request('/api/transport?lat=52.52&lon=13.405&radius=5'));
    assert.equal(networkResponse.status, 200);
    const network = await networkResponse.json();
    assert.ok(network.routes.features.some(f => f.properties.mode === 'ubahn'));
    assert.ok(network.routes.features.some(f => f.properties.mode === 'sbahn'));
    assert.ok(network.stations.features.some(f => f.properties.name));

    const exploreResponse = await worker.fetch(request('/api/explore?lat=52.52&lon=13.405&radius=5'));
    assert.equal(exploreResponse.status, 200);
    const explore = await exploreResponse.json();
    assert.ok(explore.places.length > 0);
    const place = explore.places[0];
    for (const lookup of [{ id: place.id }, { pageId: place.pageId }]) {
      const params = new URLSearchParams({ ...lookup, lat: place.lat, lon: place.lon });
      const response = await worker.fetch(request('/api/place?' + params));
      assert.equal(response.status, 200, JSON.stringify(lookup));
      const story = await response.json();
      assert.ok(story.extract?.length > 50);
      assert.ok(story.sourceUrl.includes('wikipedia.org'));
      assert.ok(story.license.includes('CC BY-SA'));
    }
  } finally { globalThis.fetch = original; }
});

test('overlay provider failure returns an explicit unavailable state without invented weather samples', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('Provider unavailable'); };
  try {
    const response = await worker.fetch(request('/api/overlays?kind=weather&lat=52.5211&lon=13.4051&radius=3'));
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.source.status, 'unavailable');
    assert.deepEqual(data.grid, []);
    assert.ok(data.source.note.includes('unavailable'));
  } finally { globalThis.fetch = original; }
});
