import test from 'node:test';
import assert from 'node:assert/strict';
import {validateStyleMin} from '@maplibre/maplibre-gl-style-spec';
import {WorldIntelligence,WORLD_LAYERS,worldFeatures} from '../src/world.js';
import {MissionTools,validateView,encodeMissionView,decodeMissionView,validateAnnotations,validateScene,parseMissionCommand} from '../src/mission-tools.js';
import {worldKinds} from '../server/world.js';
import {getDirections} from '../server/routes.js';
import {parseNews,parseWildlife,parseRadio,parseMilitaryAircraft,parsePerimeters,getContextLayer} from '../server/world-context.js';
import {parseSatelliteTles} from '../server/world-space.js';
import {satellitePasses} from '../src/passes.js';

class MapStub {
 constructor(){this.sources={};this.layers={};this.handlers=[];this.canvas={style:{},dataset:{},clientWidth:1000,clientHeight:800};}
 addSource(id,s){assert.ok(!this.sources[id]);this.sources[id]={...s,setData(d){this.data=d;},setTiles(t){this.tiles=t;}};}
 addLayer(l){assert.ok(!this.layers[l.id]);this.layers[l.id]=l;}
 getSource(id){return this.sources[id];} getLayer(id){return this.layers[id];}
 removeLayer(id){delete this.layers[id];} removeSource(id){delete this.sources[id];}
 setLayoutProperty(id,k,v){this.layers[id].layout={...this.layers[id].layout,[k]:v};}
 getCanvas(){return this.canvas;} getCenter(){return {lat:52.52,lng:13.405};} getZoom(){return 12;} getPitch(){return 35;} getBearing(){return 4;}
 on(...a){this.handlers.push(a);} off(){} once(...a){this.handlers.push(a);} isStyleLoaded(){return false;}
 setProjection(p){this.projection=p;} project(){return {x:100,y:100};}
}

test('all world catalog IDs have backend contracts and invalid features never reach the map',()=>{
 assert.deepEqual([...WORLD_LAYERS.map(l=>l.id)].sort(),[...worldKinds].sort());
 const f=worldFeatures({earthquakes:{items:[{id:'q',lat:52.5,lon:13.4,title:'Quake'},{lat:Infinity,lon:0}],features:{features:[{geometry:{type:'LineString',coordinates:[[13,52],[14,53]]}},{geometry:{type:'Polygon',coordinates:[[[NaN,52]]]}}]}}},new Set(['earthquakes']));
 assert.equal(f.points.features.length,1);assert.equal(f.lines.features.length,1);assert.equal(f.areas.features.length,0);
});
test('world and mission sources initialize inside the map load callback even while style sources are pending',()=>{
 const m=new MapStub(),w=new WorldIntelligence();w.attach(m);w.initMap();
 const t=new MissionTools();t.attachMap(m,true);
 const style={version:8,glyphs:'https://example.com/{fontstack}/{range}.pbf',sources:Object.fromEntries(Object.entries(m.sources).map(([id,s])=>[id,{type:s.type,data:s.data}])),layers:Object.values(m.layers)};
 assert.deepEqual(validateStyleMin(style),[]);
 t.setDrawMode('mark');t.addMapPoint({lngLat:{lat:52.52,lng:13.405}});t.finishRoute();
 assert.equal(m.sources['mission-annotations'].data.features.length,1);
 w.data.clouds={tiles:['https://gibs.earthdata.nasa.gov/{z}/{y}/{x}.jpg']};w.enabled.add('clouds');w.renderMap();assert.ok(m.getLayer('world-clouds'));
 w.enabled.clear();w.renderMap();assert.equal(m.getLayer('world-clouds').layout.visibility,'none');
 t.destroy();w.destroy();assert.equal(Object.keys(m.sources).length,0);
});
test('views, scenes and marks roundtrip with validation and deterministic local commands',()=>{
 const v=validateView({lat:52.52,lon:13.4,zoom:14,layers:['satellites','ubahn'],sensor:'nvg',globe:true});
 assert.deepEqual(decodeMissionView(encodeMissionView(v)),v);
 assert.throws(()=>validateView({...v,lat:100}));
 assert.throws(()=>validateAnnotations({type:'FeatureCollection',features:[{geometry:{type:'Point',coordinates:[999,52]}}]}));
 assert.equal(validateScene({type:'GodEyeScene',version:1,anchors:[v]}).anchors.length,1);
 assert.equal(parseMissionCommand('show satellites').id,'satellites');assert.equal(parseMissionCommand('fly to 52.5,13.4').action,'fly');
});
test('context parsers keep public observed coordinates and refuse malformed or inferred observations',()=>{
 const area={lat:52.52,lon:13.4,radius:5};
 assert.deepEqual(parseWildlife({results:[{id:1,geojson:{coordinates:[0,0]},taxon:{name:'Elsewhere'}}]},area),[]);
 assert.equal(parseRadio([{stationuuid:'r',name:'Test',geo_lat:52.52,geo_long:13.4,lastcheckok:1,url:'https://example.org/radio'}],area).length,1);
 assert.equal(parseMilitaryAircraft({ac:[{hex:'a',lat:52.52,lon:13.4,seen_pos:2,dbFlags:0}]},area).length,0);
 const news=parseNews({features:[{geometry:{type:'Point',coordinates:[13.4,52.52]},properties:{name:'<script>Test</script>',url:'javascript:alert(1)'}}]},area);
 assert.ok(news.every(x=>!x.sourceUrl.startsWith('javascript:')));
 assert.throws(()=>parsePerimeters({features:{}}));
});
test('routing validates both coordinates before fetching and returns the provider geometry and steps',async()=>{
 const before=globalThis.fetch;let calls=0;
 globalThis.fetch=async u=>{calls++;assert.equal(new URL(u).hostname,'router.project-osrm.org');return Response.json({code:'Ok',routes:[{geometry:{type:'LineString',coordinates:[[13.4,52.5],[13.41,52.51]]},distance:1200,duration:180,legs:[{steps:[{name:'Street',distance:1200,duration:180,maneuver:{type:'turn',modifier:'right'}}]}]}]});};
 try{await assert.rejects(()=>getDirections({from:[181,52],to:[13,52]}),RangeError);assert.equal(calls,0);const r=await getDirections({from:[13.4,52.5],to:[13.41,52.51]});assert.equal(r.distance,1200);assert.equal(r.steps[0].modifier,'right');}finally{globalThis.fetch=before;}
});
test('gated lightning makes its missing provider explicit and invalid context coordinates do not fetch',async()=>{
 const before=globalThis.fetch;globalThis.fetch=()=>assert.fail('No provider request expected');
 try{await assert.rejects(()=>getContextLayer('radio',{lat:NaN,lon:13,radius:5}),RangeError);const d=await getContextLayer('lightning',{lat:52.52,lon:13.4,radius:5});assert.equal(d.source.status,'needs-key');assert.deepEqual(d.items,[]);}finally{globalThis.fetch=before;}
});

test('geometric satellite passes use orbital elements and report ordered rise, peak and set times',()=>{
 const tle='ISS (ZARYA)\n1 25544U 98067A   24001.50000000  .00016717  00000+0  30152-3 0  9991\n2 25544  51.6416  20.0291 0002395  61.2010  39.2946 15.50000000432109';
 const start=new Date('2024-01-01T12:00:00Z'),sat=parseSatelliteTles(tle,start).items[0];
 const passes=satellitePasses(sat,{lat:52.52,lon:13.405},{start,hours:24});
 assert.ok(passes.length);for(const p of passes){assert.ok(p.maxElevation>=10);assert.ok(Date.parse(p.peak)>=Date.parse(p.rise));if(p.set)assert.ok(Date.parse(p.set)>Date.parse(p.peak));}
 assert.throws(()=>satellitePasses({},{}));
});

test('world and route API boundaries reject invalid input without contacting any provider',async()=>{
 const {default:worker}=await import('../server/worker.js');const before=globalThis.fetch;globalThis.fetch=()=>assert.fail('Invalid input reached provider');
 try{for(const path of ['/api/world?kind=unknown&lat=52&lon=13','/api/world?kind=earthquakes&lat=&lon=13','/api/world?kind=earthquakes&lat=52&lon=13&radius=0','/api/route?from=181,52&to=13,52','/api/route?from=13,52&to=13,52&mode=__proto__'])assert.equal((await worker.fetch(new Request('https://test'+path))).status,400,path);
 const r=await worker.fetch(new Request('https://test/api/capabilities'));const d=await r.json();assert.equal(d.features.length,52);assert.equal(d.commit.length,40);
 }finally{globalThis.fetch=before;}
});
