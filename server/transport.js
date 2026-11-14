import network from '../data/transport-network.json' with {type:'json'};

export const transportModes=['ubahn','sbahn','tram','bus','rail','ferry'];
const fc=features=>({type:'FeatureCollection',features});
const routes=network.routes.map(r=>({type:'Feature',id:r.id,properties:{id:r.id,name:r.name,mode:r.mode,color:r.color,routeId:r.routeId,direction:r.direction,source:'VBB GTFS',sourceUrl:network.source.url,reference:true},geometry:r.lines.length===1?{type:'LineString',coordinates:r.lines[0]}:{type:'MultiLineString',coordinates:r.lines}}));
const stations=network.stations.map(s=>({type:'Feature',id:s.id,properties:{id:s.id,name:s.name,mode:s.mode,modes:s.modes,lines:s.lines,source:'VBB GTFS',sourceUrl:network.source.url,reference:true,description:`Named VBB stop/station. Lines: ${s.lines.join(', ')}. Published network context; vehicle positions are illustrative simulations.`},geometry:{type:'Point',coordinates:[s.lon,s.lat]}}));

export function distanceKm(lat1,lon1,lat2,lon2){const rad=Math.PI/180;const a=Math.sin((lat2-lat1)*rad/2)**2+Math.cos(lat1*rad)*Math.cos(lat2*rad)*Math.sin((lon2-lon1)*rad/2)**2;return 6371*2*Math.atan2(Math.sqrt(a),Math.sqrt(Math.max(0,1-a)));}

/** A line may cross the scan radius even when both endpoints are outside it. */
export function lineIntersectsRadius(line,lat,lon,radius){
 if(!Array.isArray(line)||!line.length)return false;
 const dx=111.32*Math.cos(lat*Math.PI/180),dy=110.574;
 for(let i=0;i<line.length;i++){
  const a=line[i];if(!Array.isArray(a)||!a.every(Number.isFinite))continue;
  const x=(a[0]-lon)*dx,y=(a[1]-lat)*dy;if(x*x+y*y<=radius*radius)return true;
  if(i){const b=line[i-1];if(!Array.isArray(b)||!b.every(Number.isFinite))continue;const bx=(b[0]-lon)*dx,by=(b[1]-lat)*dy,vx=x-bx,vy=y-by;const t=Math.max(0,Math.min(1,-(bx*vx+by*vy)/(vx*vx+vy*vy||1)));if((bx+t*vx)**2+(by+t*vy)**2<=radius*radius)return true;}
 }
 return false;
}

export function getTransport({lat=52.52,lon=13.405,radius=5}={}){
 if(!Number.isFinite(lat)||Math.abs(lat)>85||!Number.isFinite(lon)||Math.abs(lon)>180||!Number.isFinite(radius)||radius<.25||radius>30)throw new RangeError('Valid coordinates and radius 0.25–30 km required');
 const matchingRoutes=routes.filter(f=>(f.geometry.type==='LineString'?[f.geometry.coordinates]:f.geometry.coordinates).some(line=>lineIntersectsRadius(line,lat,lon,radius)));
 const matchingStations=stations.filter(f=>distanceKm(lat,lon,f.geometry.coordinates[1],f.geometry.coordinates[0])<=radius);
 return {routes:fc(matchingRoutes),stations:fc(matchingStations),source:{...network.source,status:'reference',count:matchingRoutes.length+matchingStations.length,totalRoutes:routes.length,totalStations:stations.length,uniqueLines:new Set(routes.map(f=>f.properties.mode+':'+f.properties.name)).size,note:network.source.note+' Route paths intersecting the scan radius remain visible end-to-end for network context.'},modeCounts:Object.fromEntries(transportModes.map(mode=>[mode,{routes:matchingRoutes.filter(f=>f.properties.mode===mode).length,lines:new Set(matchingRoutes.filter(f=>f.properties.mode===mode).map(f=>f.properties.name)).size,stations:matchingStations.filter(f=>f.properties.modes.includes(mode)).length}]))};
}

export function getTransportStats(){return {routes:routes.length,stations:stations.length,modes:Object.fromEntries(transportModes.map(mode=>[mode,routes.filter(f=>f.properties.mode===mode).length])),updatedAt:network.source.updatedAt};}
