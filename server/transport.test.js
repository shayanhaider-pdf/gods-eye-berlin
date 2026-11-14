import test from 'node:test';
import assert from 'node:assert/strict';
import {getTransport,getTransportStats,lineIntersectsRadius} from './transport.js';

test('real VBB snapshot includes all requested transport modes and citywide named stops',()=>{
 const stats=getTransportStats();assert.ok(stats.routes>100);assert.ok(stats.stations>1000);
 for(const mode of ['ubahn','sbahn','tram','bus','rail','ferry'])assert.ok(stats.modes[mode]>0,mode);
 const data=getTransport({lat:52.5219,lon:13.4132,radius:1});
 assert.ok(data.stations.features.some(s=>/Alexanderplatz/.test(s.properties.name)));
 assert.ok(data.routes.features.some(r=>r.properties.mode==='ubahn'&&r.properties.name==='U5'));
 assert.match(data.source.license,/CC BY 4.0/);assert.match(data.source.note,/not engineering track alignments or live vehicle positions/);
});

test('route scan filtering includes crossing segments with endpoints outside the radius',()=>{
 assert.equal(lineIntersectsRadius([[13.3,52.52],[13.5,52.52]],52.52,13.4,.5),true);
 assert.equal(lineIntersectsRadius([[13.3,52.6],[13.5,52.6]],52.52,13.4,.5),false);
 assert.equal(lineIntersectsRadius([],52.52,13.4,1),false);
});

test('stop radius and actual geometry remain valid across the network',()=>{
 const data=getTransport({lat:52.52,lon:13.405,radius:3});
 assert.ok(data.stations.features.length>50);
 assert.ok(data.routes.features.every(r=>r.geometry.type==='LineString'||r.geometry.type==='MultiLineString'));
 for(const s of data.stations.features){assert.ok(s.properties.name);assert.ok(s.properties.lines.length);assert.ok(s.properties.modes.length);assert.ok(s.geometry.coordinates.every(Number.isFinite));}
 assert.throws(()=>getTransport({lat:NaN}),RangeError);assert.throws(()=>getTransport({radius:300}),RangeError);
 const elsewhere=getTransport({lat:40.7,lon:-74,radius:5});assert.equal(elsewhere.routes.features.length,0);assert.equal(elsewhere.stations.features.length,0);
});
