import test from 'node:test';
import assert from 'node:assert/strict';
import {groundKinds, groundQuery, parseGroundElements, getGroundLayer, parseBikeAvailability} from './world-ground.js';

const area = {lat: 52.52, lon: 13.405, radius: 5};

test('all original mapped infrastructure families have bounded fixed-source queries', () => {
  for (const kind of groundKinds.filter(k => !['vessels', 'streetlevel', 'gnss'].includes(k))) {
    const query = groundQuery(kind, area);
    assert.match(query, /^\[out:json\]\[timeout:7\]/);
    assert.match(query, /around:5000,52\.520000,13\.405000/);
    assert.match(query, /out center geom 350;/);
  }
  assert.match(groundQuery('alpr', area), /ANPR/);
  assert.doesNotMatch(groundQuery('alpr', area), /surveillance"="traffic/);
  assert.throws(() => groundQuery('not-a-layer', area), RangeError);
});

test('mapped camera metadata never claims a live stream or invents observations', () => {
  const data = parseGroundElements('cameras', {elements: [
    {type: 'node', id: 11, lat: 52.52, lon: 13.405, tags: {name: 'Public traffic camera', operator: 'City', surveillance: 'traffic', 'surveillance:type': 'camera', image: 'https://unverified.invalid/camera.jpg'}},
    {type: 'node', id: 12, lat: 52.521, lon: 13.405, tags: {name: 'Unnamed camera'}},
    {type: 'node', id: 11, lat: 52.52, lon: 13.405},
    {type: 'node', id: 13, lat: null, lon: 13.405},
    {type: 'node', id: 14, lat: 40.71, lon: -74}
  ]}, area);
  assert.equal(data.items.length, 2);
  assert.equal(data.items[0].sourceUrl, 'https://www.openstreetmap.org/node/11');
  assert.equal(data.items[0].status, 'reference');
  assert.equal(data.items[0].updatedAt, null);
  assert.match(data.items[0].description, /not a verified accessible video stream/);
  assert.equal(data.items[0].imageUrl, undefined);
  assert.equal(data.items[0].streamUrl, undefined);
});

test('rail and infrastructure geometries retain real paths, closed areas and crossing segments', () => {
  const data = parseGroundElements('rail', {elements: [
    {type: 'way', id: 21, center: {lat: 52.52, lon: 13.405}, tags: {railway: 'rail'}, geometry: [{lat: 52.51, lon: 13.4}, {lat: 52.53, lon: 13.41}]},
    {type: 'way', id: 22, tags: {railway: 'rail'}, geometry: [{lat: 52.52, lon: 13.2}, {lat: 52.52, lon: 13.7}]}
  ]}, area);
  assert.equal(data.items.length, 2);
  assert.equal(data.features.features[0].geometry.type, 'LineString');
  assert.deepEqual(data.features.features[0].geometry.coordinates, [[13.4, 52.51], [13.41, 52.53]]);
  const polygon = parseGroundElements('installations', {elements: [{type: 'way', id: 30, tags: {name: 'Mapped facility'}, geometry: [{lat: 52.52, lon: 13.4}, {lat: 52.521, lon: 13.4}, {lat: 52.521, lon: 13.401}, {lat: 52.52, lon: 13.4}]}]}, area);
  assert.equal(polygon.features.features[0].geometry.type, 'Polygon');
});

test('bad area coordinates and unknown kinds are rejected before provider access', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = () => assert.fail('invalid query reached upstream');
  try {
    for (const bad of [{...area, lat: NaN}, {...area, lon: 181}, {...area, radius: 100}, {...area, radius: 0}]) await assert.rejects(() => getGroundLayer('dams', bad), RangeError);
    await assert.rejects(() => getGroundLayer('http://untrusted.invalid', area), RangeError);
  } finally { globalThis.fetch = original; }
});

test('credential-dependent or missing feeds are explicit and never emit fabricated assets', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = () => assert.fail('unconfigured provider must not be called');
  try {
    const vessels = await getGroundLayer('vessels', area);
    assert.equal(vessels.source.status, 'needs-key');
    assert.deepEqual(vessels.items, []);
    assert.match(vessels.source.note, /persistent stream service/);
    assert.equal((await getGroundLayer('gnss', area)).source.status, 'unavailable');
  } finally { globalThis.fetch = original; }
});

test('fixed-source fetch, per-area caching and outage status retain provenance', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls++;
    assert.equal(url, 'https://overpass-api.de/api/interpreter');
    assert.equal(options.method, 'POST');
    assert.match(options.body.get('data'), /waterway/);
    return Response.json({elements: [{type: 'node', id: 44, lat: 52.524, lon: 13.407, tags: {name: 'Public mapped weir', waterway: 'weir'}}]});
  };
  try {
    const here = {lat: 52.524, lon: 13.407, radius: 3};
    const first = await getGroundLayer('dams', here);
    const second = await getGroundLayer('dams', here);
    assert.equal(calls, 1);
    assert.equal(first, second);
    assert.equal(first.source.status, 'connected');
    assert.equal(first.source.license, 'ODbL 1.0');
    assert.equal(first.items[0].title, 'Public mapped weir');
    globalThis.fetch = async () => { throw new Error('offline'); };
    const failed = await getGroundLayer('datacenters', {...here, lat: 52.525});
    assert.equal(failed.source.status, 'unavailable');
    assert.deepEqual(failed.items, []);
  } finally { globalThis.fetch = original; }
});

test('NYC GBFS availability joins station metadata with supplied counts and does not invent missing stations',()=>{
 const info={data:{stations:[{station_id:'a',name:'Actual',lat:40.72,lon:-74},{station_id:'b',name:'Unknown availability',lat:40.72,lon:-74}]}};
 const status={data:{stations:[{station_id:'a',num_bikes_available:0,num_docks_available:8,last_reported:1700000000}]}};
 const items=parseBikeAvailability(info,status,{lat:40.72,lon:-74,radius:5});
 assert.equal(items.length,1);assert.equal(items[0].bikes,0);assert.match(items[0].description,/0 bikes/);
});

test('keyless Panoramax street photos preserve source, capture date and publicly supplied image URL',async()=>{
 const original=globalThis.fetch;globalThis.fetch=async u=>{assert.equal(new URL(u).origin,'https://api.panoramax.xyz');return Response.json({features:[{id:'photo',geometry:{type:'Point',coordinates:[13.4,52.52]},properties:{datetime:'2026-01-01T12:00:00Z',license:'CC BY-SA 4.0'},assets:{hd:{href:'https://photos.example.org/photo.jpg'}}}]});};
 try{const d=await getGroundLayer('streetlevel',area);assert.equal(d.source.status,'connected');assert.equal(d.items[0].imageUrl,'https://photos.example.org/photo.jpg');assert.equal(d.items[0].updatedAt,'2026-01-01T12:00:00.000Z');}finally{globalThis.fetch=original;}
});
