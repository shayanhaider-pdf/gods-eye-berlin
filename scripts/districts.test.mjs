import test from 'node:test';
import assert from 'node:assert/strict';
import {districtForPoint,districtPulse,pointInGeometry,berlinDistricts,districtSource} from '../src/districts.js';

test('official ALKIS snapshot contains all twelve real Berlin districts',()=>{
 assert.equal(berlinDistricts.features.length,12);assert.equal(new Set(berlinDistricts.features.map(f=>f.properties.name)).size,12);
 assert.match(districtSource.license,/Zero/);assert.match(districtSource.url,/gdi.berlin.de/);
 assert.equal(districtForPoint(52.5219,13.4132)?.properties.name,'Mitte');
 assert.equal(districtForPoint(52.5016,13.4449)?.properties.name,'Friedrichshain-Kreuzberg');
 assert.equal(districtForPoint(52.4546,13.5763)?.properties.name,'Treptow-Köpenick');
 assert.equal(districtForPoint(48.1372,11.5756),null);
});

test('point-in-polygon honors holes and multiple polygons',()=>{
 const outer=[[0,0],[4,0],[4,4],[0,4],[0,0]],hole=[[1,1],[3,1],[3,3],[1,3],[1,1]];
 const g={type:'MultiPolygon',coordinates:[[outer,hole],[[[10,10],[12,10],[12,12],[10,12],[10,10]]]]};
 assert.equal(pointInGeometry(g,.5,.5),true);assert.equal(pointInGeometry(g,2,2),false);assert.equal(pointInGeometry(g,11,11),true);assert.equal(pointInGeometry(g,5,5),false);assert.equal(pointInGeometry(g,NaN,2),false);
});

test('district index uses supplied records only, weights delays, caps100 and excludes expired or simulated records',()=>{
 const now=Date.parse('2026-11-11T12:00:00Z'),base={lat:52.5219,lon:13.4132,status:'published'};
 const events=[{...base,id:'work',category:'traffic'},{...base,id:'train',category:'transit',delay:7},{...base,id:'warning',category:'alerts'},{...base,id:'expired',category:'alerts',expiresAt:'2026-11-10T12:00:00Z'},{...base,id:'actor',category:'transit',simulated:true},{...base,id:'place',category:'traffic',status:'reference'},{...base,id:'work',category:'traffic'}];
 const pulse=districtPulse(events,now),mitte=pulse.find(d=>d.name==='Mitte');assert.equal(pulse.length,12);assert.equal(mitte.count,3);assert.equal(mitte.score,12);assert.equal(mitte.traffic,1);assert.equal(mitte.departures,1);assert.equal(mitte.delayed,1);assert.equal(mitte.alerts,1);
 assert.equal(pulse.filter(d=>d.count).length,1);assert.ok(Number.isFinite(mitte.lat)&&Number.isFinite(mitte.lon));
 assert.equal(districtPulse(Array.from({length:200},(_,i)=>({...base,id:`record${i}`,category:'traffic'})),now).find(d=>d.name==='Mitte').score,100);
});
