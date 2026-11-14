import test from 'node:test';
import assert from 'node:assert/strict';
import { distanceKm, localTimeIso, germanDate, centroid, parseStreetFeatures, parseDepartures, warningRecord, getOverview } from './data.js';

test('Berlin and Seattle local timestamps retain correct daylight-saving offsets',()=>{
  assert.equal(germanDate('11.11.2026'),'2026-11-10T23:00:00.000Z');
  assert.equal(germanDate('11.07.2026'),'2026-07-10T22:00:00.000Z');
  assert.equal(germanDate('11.11.2026',true),'2026-11-11T22:59:59.000Z');
  assert.equal(localTimeIso('2026-11-11T04:58:00.000','America/Los_Angeles'),'2026-11-11T12:58:00.000Z');
  assert.equal(germanDate('unknown'),null);
});

test('geometry centroid and haversine distance use longitude, latitude order',()=>{
  assert.deepEqual(centroid({coordinates:[[[[13,52],[15,54]]]],type:'MultiPolygon'}),[14,53]);
  assert.equal(centroid(null),null);
  assert.equal(distanceKm(52.52,13.405,52.52,13.405),0);
  assert.ok(distanceKm(52.52,13.405,52.53,13.405)>1);
});

test('street parser removes expired records, recognizes upcoming dates, and strips provider HTML',()=>{
  const now=Date.parse('2026-11-11T12:00:00Z');
  const f=(id,start,end)=>({id,geometry:{type:'Point',coordinates:[13.4,52.52]},properties:{dat_beginn:start,dat_ende:end,strasse:'<script>Bad</script> Linden',ereignis:'Arbeitsstelle',einschr:'<b>Closed</b>'}});
  const events=parseStreetFeatures({features:[f('old','01.01.2026','01.11.2026'),f('current','01.11.2026','15.11.2026'),f('future','15.11.2026','18.11.2026'),f('too-far','01.01.2027','02.01.2027')]},now);
  assert.equal(events.length,2);
  assert.equal(events[0].status,'active');
  assert.equal(events[1].status,'upcoming');
  assert.ok(!events[0].description.includes('<'));
  assert.equal(events[0].updatedAt,null);
  assert.equal(events[0].category,'traffic');
});

test('transit parser treats absent delay as unknown and never uses current vehicle positions',()=>{
  const now=Date.parse('2026-11-11T12:00:00Z');
  const record={tripId:'t',stop:{name:'Public station',location:{latitude:52.5,longitude:13.4}},when:'2026-11-11T12:10:00Z',line:{name:'U8'},direction:'North',currentTripPosition:{latitude:1,longitude:2}};
  const [d]=parseDepartures({departures:[record]},now);
  assert.equal(d.lat,52.5);
  assert.equal(d.delay,null);
  assert.match(d.description,/no delay estimate/);
  assert.equal(parseDepartures({departures:[{...record,when:'2026-11-11T11:00:00Z'}]},now).length,0);
});

test('overview validates coordinates before any network activity',async()=>{
  await assert.rejects(()=>getOverview({lat:Infinity}),RangeError);
  await assert.rejects(()=>getOverview({lon:400}),RangeError);
  await assert.rejects(()=>getOverview({radius:300}),RangeError);
});

test('warnings derive markers from CAP polygons and explicitly mark missing geometry as city-level',()=>{
  const a={id:'official-warning',payload:{headline:'Weather warning'}};
  const detailed=warningRecord(a,{sent:'2026-11-11T12:00:00Z',info:[{language:'de-DE',headline:'Official warning',area:[{areaDesc:'Affected district',polygon:['52.5,13.3 52.6,13.3 52.6,13.4 52.5,13.4 52.5,13.3']}]}]});
  assert.equal(detailed.locationPrecision,'area');
  assert.ok(detailed.lat>=52.5&&detailed.lat<=52.6);
  assert.ok(detailed.lon>=13.3&&detailed.lon<=13.4);
  assert.equal(detailed.geometry.type,'MultiPolygon');
  assert.match(detailed.description,/Affected district/);
  const fallback=warningRecord(a);
  assert.equal(fallback.locationPrecision,'city');
  assert.equal(fallback.lat,52.52);
  assert.equal(fallback.lon,13.405);
  assert.match(fallback.description,/city reference/);
});

test('one unavailable source does not erase working layers and no incidents are invented',async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=async input=>{
    const u=String(input);
    if(u.includes('forecast?')){
      assert.match(u,/forecast_days=2/);
      const base=Math.floor(Date.now()/3600000)*3600000;
      const times=Array.from({length:48},(_,i)=>new Date(base+(i-2)*3600000).toISOString().replace('.000Z',''));
      return new Response(JSON.stringify({current:{temperature_2m:6,relative_humidity_2m:77,wind_speed_10m:9,weather_code:3,time:'2026-11-11T12:00'},hourly:{time:times,temperature_2m:times.map(()=>7)}}));
    }
    if(u.includes('air-quality?'))return new Response(JSON.stringify({current:{pm10:20,pm2_5:15,european_aqi:40,time:'2026-11-11T12:00'}}));
    if(u.includes('wikipedia.org'))return new Response(JSON.stringify({query:{geosearch:[{pageid:1,title:'Real place',lat:40.7128,lon:-74.006}]}}));
    throw new Error('Test provider unavailable');
  };
  try {
    const data=await getOverview({city:'nyc',lat:40.7128,lon:-74.006,radius:3.7});
    assert.equal(data.events.length,0);
    assert.equal(data.places[0].status,'reference');
    assert.equal(data.weather.temperature,6);
    assert.equal(data.weather.hourly.length,24);
    assert.ok(data.weather.hourly.every(h=>Date.parse(h.time)>=Date.now()));
    assert.equal(data.sources.find(s=>s.id==='earthquakes').status,'unavailable');
    assert.equal(data.sources.find(s=>s.id==='places').status,'connected');
    assert.equal(data.sources.find(s=>s.id==='local-activity').updatedAt,null);
  }finally {globalThis.fetch=original;}
});
