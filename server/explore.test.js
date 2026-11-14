import test from 'node:test';
import assert from 'node:assert/strict';
import {getExplore,getPlaceDetails,exploreDistance,exploreMetadata} from './explore.js';

test('Berlin atlas supplies sourced history, stations and geography inside the actual scan radius',async()=>{
 const view=await getExplore({lat:52.52,lon:13.405,radius:5});
 assert.ok(exploreMetadata.count>=100);
 assert.ok(view.places.length>=60);
 assert.deepEqual(new Set(view.places.map(p=>p.category)),new Set(['history','architecture','culture','memorials','parks','geography']));
 assert.ok(view.places.some(p=>p.subtype==='Station history'));
 for(const p of view.places){assert.ok(exploreDistance(52.52,13.405,p.lat,p.lon)<=5);assert.ok(p.description.length>40);assert.equal(p.status,'reference');assert.equal(p.updatedAt,null);assert.match(p.sourceUrl,/^https:\/\/en\.wikipedia\.org\//);assert.equal(p.license,'CC BY-SA 4.0');}
 const outside=await getExplore({lat:40.71,lon:-74,radius:5});assert.equal(outside.places.length,0);
});

test('curated details remain available offline with original source and license rather than synthesized history',async()=>{
 const original=globalThis.fetch;globalThis.fetch=()=>assert.fail('Offline curated detail made a provider request');
 try{const view=await getExplore({lat:52.52,lon:13.405,radius:5});const item=view.places.find(p=>p.title==='Berlin Alexanderplatz station');assert.ok(item);const detail=await getPlaceDetails({id:item.id});assert.equal(detail.title,item.title);assert.equal(detail.pageId,item.pageId);assert.ok(detail.extract.length>=item.description.length);assert.equal(detail.matchType,'curated');assert.equal(detail.licenseUrl,'https://creativecommons.org/licenses/by-sa/4.0/');assert.equal(detail.sourceUrl,item.sourceUrl);}finally{globalThis.fetch=original;}
});

test('invalid exploration parameters are rejected before provider access',async()=>{
 const original=globalThis.fetch;globalThis.fetch=()=>assert.fail('Invalid request reached provider');
 try{for(const args of [{lat:NaN,lon:13},{lat:91,lon:13},{lat:52,lon:181},{lat:52,lon:13,radius:100},{lat:52,lon:13,radius:0}])await assert.rejects(()=>getExplore(args),RangeError);await assert.rejects(()=>getPlaceDetails({pageId:'not-a-page'}),RangeError);await assert.rejects(()=>getPlaceDetails({title:'x'.repeat(300)}),RangeError);await assert.rejects(()=>getPlaceDetails({title:'A',lat:200,lon:13}),RangeError);}finally{globalThis.fetch=original;}
});

test('reference provider failure is explicit and never produces a fictional historical extract',async()=>{
 const original=globalThis.fetch;globalThis.fetch=async()=>{throw new Error('Provider down');};
 try{const d=await getPlaceDetails({title:'An unindexed Berlin station unique test'});assert.equal(d.extract,null);assert.equal(d.status,'unavailable');assert.match(d.note,/No historical account has been generated/);}finally{globalThis.fetch=original;}
});

test('nearby article fallback is marked as nearby rather than attributed to an unrelated station',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async input=>{const url=new URL(input);if(url.searchParams.get('list')==='geosearch')return Response.json({query:{geosearch:[{pageid:987654321,title:'Nearby place'}]}});if(url.searchParams.get('pageids'))return Response.json({query:{pages:[{pageid:987654321,title:'Nearby place',extract:'A real provider supplied reference paragraph.',fullurl:'https://en.wikipedia.org/?curid=987654321'}]}});return Response.json({query:{pages:[{title:'Missing station',missing:true}]}});};
 try{const d=await getPlaceDetails({title:'Missing station unique fallback test',lat:52.52,lon:13.405});assert.equal(d.matchType,'nearby');assert.equal(d.title,'Nearby place');assert.match(d.note,/not a verified history/);assert.equal(d.extract,'A real provider supplied reference paragraph.');}finally{globalThis.fetch=original;}
});
