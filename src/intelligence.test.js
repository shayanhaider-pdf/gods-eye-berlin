import test from 'node:test';
import assert from 'node:assert/strict';
import {detectSignals,cityPulse,connectionRipple,parseSignalCommand,sameArea,closestSnapshot,snapshotDifference,IntelligenceTools} from './intelligence.js';

const now=Date.parse('2026-11-11T12:00:00Z');
const center={lat:52.52,lon:13.405};
const departure=(id,delay,extra={})=>({id,lat:52.52,lon:13.405,category:'transit',line:'U8',stop:'Alexanderplatz',status:'upcoming',delay,expiresAt:'2026-11-11T12:10:00Z',...extra});

test('signals use supplied delays and ignore unknown, expired and reference values',()=>{
 const events=[departure('a',5),departure('b',8),departure('unknown',null),departure('expired',80,{expiresAt:'2026-11-11T11:00:00Z'}),departure('reference',99,{status:'reference'})];
 const signals=detectSignals(events,now);
 assert.equal(signals.length,1);
 assert.equal(signals[0].events.length,2);
 assert.deepEqual(signals[0].lineNames,['U8']);
 assert.match(signals[0].description,/8 min/);
 assert.equal(detectSignals([departure('one',20)],now).length,0);
});

test('street signal is concentration, excludes upcoming permits and requires threshold',()=>{
 const work=Array.from({length:5},(_,i)=>({id:`work-${i}`,category:'traffic',status:'active',title:'Roadworks',lat:52.52001,lon:13.40501}));
 const [signal]=detectSignals([...work,{...work[0],id:'future',status:'upcoming'}],now);
 assert.equal(signal.events.length,5);
 assert.match(signal.description,/not a proven unusual change/);
 assert.equal(detectSignals(work.slice(0,4),now).length,0);
});

test('pulse score is reproducible and excludes simulation/reference and outside-area records',()=>{
 const values=cityPulse([departure('a',8),{id:'works',category:'traffic',status:'active',...center},{id:'alert',category:'alerts',status:'published',...center},{id:'reference',category:'places',status:'reference',...center},{id:'far',category:'traffic',status:'active',lat:50,lon:10}],center,5,now);
 assert.equal(values.length,9);
 assert.equal(values[4].count,3);
 assert.equal(values[4].score,12); // works1 + departure2 + delayed4 + alert5
 assert.equal(values.reduce((n,v)=>n+v.count,0),3);
 assert.deepEqual(cityPulse([],center,0),[]);
});

test('connection ripple is derived only from shared station line memberships',()=>{
 const station=(id,name,lines)=>({type:'Feature',properties:{id,name,lines},geometry:{type:'Point',coordinates:[13.4,52.5]}});
 const network={stations:{features:[station('a','A',['U8','U2']),station('b','B',['U8','S5']),station('c','C',['U2','M10'])]}};
 const ripple=connectionRipple(network,'u8');
 assert.deepEqual(ripple.stationIds,['a','b']);
 assert.deepEqual(ripple.lineNames,['U8','U2','S5']);
 assert.ok(!ripple.lineNames.includes('M10'));
 assert.equal(connectionRipple(network,'nonexistent').stations.length,0);
});

test('replay requires a real capture near requested time for matching area and radius',()=>{
 const current={city:'berlin',center,radius:5};
 const snapshots=[{...current,id:'valid',capturedAt:'2026-11-11T11:05:00Z'}, {...current,id:'wrong-radius',radius:1,capturedAt:'2026-11-11T11:00:00Z'}, {...current,id:'wrong-city',city:'seattle',capturedAt:'2026-11-11T11:00:00Z'}];
 assert.equal(closestSnapshot(snapshots,current,now-3600000).id,'valid');
 assert.equal(closestSnapshot(snapshots,current,now-6*3600000),null);
 assert.equal(sameArea(current,{...current,center:{lat:52.6,lon:13.5}}),false);
 assert.deepEqual(snapshotDifference([{id:'a'},{id:'b'}],[{id:'b'},{id:'c'}]),{added:[{id:'a'}],removed:[{id:'c'}],retained:[{id:'b'}]});
});

test('signal commands are deterministic filter instructions, not generated answers',()=>{
 assert.equal(parseSignalCommand('delayed trains').signal,'delayed');
 assert.equal(parseSignalCommand('U 8').line,'U8');
 assert.equal(parseSignalCommand('history').tab,'stories');
 assert.equal(parseSignalCommand('parks').layerPreset,'nature');
 assert.equal(parseSignalCommand('construction').signal,'construction');
 assert.equal(parseSignalCommand('unknown question').query,'unknown question');
});

test('session fallback stores only actual captures and does not manufacture requested history',async()=>{
 const tools=new IntelligenceTools();
 await tools.capture({city:'berlin',center,radius:5,events:[{...departure('real',5),geometry:{type:'Point',coordinates:[13.4,52.5]}}]});
 assert.equal(tools.snapshots.length,1);
 assert.equal(tools.snapshots[0].events[0].id,'real');
 assert.equal(tools.snapshots[0].events[0].geometry,undefined);
 assert.equal(closestSnapshot(tools.snapshots,{city:'berlin',center,radius:5},Date.now()-24*3600000),null);
 await tools.capture({city:'berlin',center,radius:5,events:[departure('later',3)]});
 assert.equal(tools.snapshots.length,1); // 15-minute minimum capture interval
 tools.destroy();
});
