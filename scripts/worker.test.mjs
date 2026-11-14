import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../server/worker.js';

const request=(path,method='GET')=>new Request('https://around-me.test'+path,{method});
const payload=body=>new Response(JSON.stringify(body),{headers:{'Content-Type':'application/json'}});

test('health and embedded assets serve with deployment security headers',async()=>{
  const health=await worker.fetch(request('/api/health'));
  assert.equal(health.status,200);
  assert.equal((await health.json()).status,'ready');
  const html=await worker.fetch(request('/'));
  assert.equal(html.status,200);
  assert.match(html.headers.get('Content-Type'),/text\/html/);
  assert.match(html.headers.get('Content-Security-Policy'),/object-src 'none'/);
  assert.match(await html.text(),/id="app"/);
  assert.equal((await worker.fetch(request('/missing'))).status,404);
  assert.equal((await worker.fetch(request('/api/overview','POST'))).status,405);
});

test('invalid overview boundaries are rejected before any upstream request',async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=()=>{assert.fail('Invalid input reached a provider');};
  try{
    for(const suffix of [
      '', '?lat=52&lon=', '?lat=%20&lon=13', '?lat=NaN&lon=13',
      '?lat=86&lon=13', '?lat=52&lon=181', '?lat=52&lon=13&radius=0',
      '?lat=52&lon=13&radius=100', '?lat=52&lon=13&radius=%20',
      '?lat=52&lon=13&city=arbitrary',
    ]){
      const r=await worker.fetch(request('/api/overview'+suffix));
      assert.equal(r.status,400,suffix||'missing query');
      assert.ok((await r.json()).error);
    }
  }finally{globalThis.fetch=original;}
});

test('partial provider failure preserves real weather and marks missing feeds without incidents',async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=async input=>{
    const url=new URL(input);
    if(url.hostname==='api.open-meteo.com')return payload({current:{temperature_2m:12,relative_humidity_2m:73,weather_code:3,wind_speed_10m:9,time:'2026-11-11T12:00'},hourly:{time:[],temperature_2m:[]}});
    return new Response('Provider offline',{status:503});
  };
  try{
    const r=await worker.fetch(request('/api/overview?city=seattle&lat=47.6071&lon=-122.3334&radius=3'));
    assert.equal(r.status,200);
    const d=await r.json();
    assert.equal(d.weather.temperature,12);
    assert.equal(d.weather.description,'Overcast');
    assert.equal(d.weather.time,'2026-11-11T12:00:00.000Z');
    assert.deepEqual(d.events,[]);
    assert.deepEqual(d.places,[]);
    assert.ok(d.sources.some(s=>s.id==='weather'&&s.status==='connected'));
    assert.ok(d.sources.filter(s=>s.id!=='weather').every(s=>s.status==='unavailable'&&s.count===0));
    assert.match(d.coverage,/empty feed does not establish/);
  }finally{globalThis.fetch=original;}
});

test('search keeps special-character query intact and omits malformed result coordinates',async()=>{
  const original=globalThis.fetch;
  const query='Straße & <café> / Berlin';
  let called=false;
  globalThis.fetch=async input=>{
    const url=new URL(input);
    assert.equal(url.hostname,'photon.komoot.io');
    assert.equal(url.searchParams.get('q'),query);
    assert.equal(url.searchParams.get('lat'),'52.52');
    called=true;
    return payload({features:[
      {geometry:{type:'Point',coordinates:[13.4,52.5]},properties:{name:'Alexanderplatz',city:'Berlin'}},
      {geometry:{type:'Point'},properties:{name:'Missing coordinate'}},
      {geometry:{type:'Point',coordinates:[181,52.5]},properties:{name:'Impossible longitude'}},
      {geometry:{type:'LineString',coordinates:[[13.4,52.5],[13.5,52.5]]},properties:{name:'Wrong geometry'}},
      {geometry:{type:'Point',coordinates:[13.4,52.5]},properties:{}},
    ]});
  };
  try{
    const r=await worker.fetch(request('/api/search?'+new URLSearchParams({q:query})));
    assert.equal(r.status,200);
    assert.ok(called);
    assert.deepEqual((await r.json()).results,[{lon:13.4,lat:52.5,label:'Alexanderplatz, Berlin'}]);
  }finally{globalThis.fetch=original;}
});

test('search distinguishes invalid user input from invalid provider data and network errors',async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=()=>{assert.fail('Invalid search reached a provider');};
  try{
    for(const path of ['/api/search?q=ab','/api/search?q=Berlin&lat=%20','/api/search?q=Berlin&lon=181'])assert.equal((await worker.fetch(request(path))).status,400,path);
    globalThis.fetch=async()=>payload({features:{invalid:true}});
    assert.equal((await worker.fetch(request('/api/search?q=Berlin'))).status,503);
    globalThis.fetch=async()=>{throw new Error('Provider timed out');};
    const r=await worker.fetch(request('/api/search?q=Berlin'));
    assert.equal(r.status,503);
    assert.ok((await r.json()).error);
  }finally{globalThis.fetch=original;}
});
