import boundaryData from '../data/berlin-districts.json' with {type:'json'};

export const districtSource=boundaryData.source;
export const berlinDistricts={type:'FeatureCollection',features:boundaryData.features};
const validPoint=(lat,lon)=>Number.isFinite(lat)&&Number.isFinite(lon)&&Math.abs(lat)<=90&&Math.abs(lon)<=180;

function onSegment(x,y,a,b){const cross=(x-a[0])*(b[1]-a[1])-(y-a[1])*(b[0]-a[0]);return Math.abs(cross)<1e-10&&x>=Math.min(a[0],b[0])-1e-10&&x<=Math.max(a[0],b[0])+1e-10&&y>=Math.min(a[1],b[1])-1e-10&&y<=Math.max(a[1],b[1])+1e-10;}
function ringContains(ring,lon,lat){let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if(onSegment(lon,lat,a,b))return true;if((a[1]>lat)!==(b[1]>lat)&&lon<(b[0]-a[0])*(lat-a[1])/(b[1]-a[1])+a[0])inside=!inside;}return inside;}
export function pointInGeometry(geometry,lat,lon){if(!validPoint(lat,lon)||!geometry)return false;const polygons=geometry.type==='Polygon'?[geometry.coordinates]:geometry.type==='MultiPolygon'?geometry.coordinates:[];return polygons.some(rings=>rings.length&&ringContains(rings[0],lon,lat)&&!rings.slice(1).some(hole=>ringContains(hole,lon,lat)));}

// Centroids are for district navigation only; assignments use all official polygon rings.
function centroid(geometry){let total=0,x=0,y=0;for(const rings of geometry.coordinates){const ring=rings[0];let twiceArea=0,cx=0,cy=0;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const p=ring[j],q=ring[i],cross=p[0]*q[1]-q[0]*p[1];twiceArea+=cross;cx+=(p[0]+q[0])*cross;cy+=(p[1]+q[1])*cross;}if(Math.abs(twiceArea)>1e-12){const area=Math.abs(twiceArea);x+=cx/(3*twiceArea)*area;y+=cy/(3*twiceArea)*area;total+=area;}}return total?[x/total,y/total]:geometry.coordinates[0][0][0];}
const features=boundaryData.features.map(f=>{const coords=f.geometry.coordinates.flat(2),[lon,lat]=centroid(f.geometry);return {feature:f,lon,lat,bbox:[Math.min(...coords.map(p=>p[0])),Math.min(...coords.map(p=>p[1])),Math.max(...coords.map(p=>p[0])),Math.max(...coords.map(p=>p[1]))]};});

/** Shared-boundary points deterministically belong to the first official district. */
export function districtForPoint(lat,lon){if(!validPoint(lat,lon))return null;return features.find(d=>lon>=d.bbox[0]&&lon<=d.bbox[2]&&lat>=d.bbox[1]&&lat<=d.bbox[3]&&pointInGeometry(d.feature.geometry,lat,lon))?.feature||null;}

/** Transparent activity-record index, never crowd density or simulated actor counts. */
export function districtPulse(events,now=Date.now()){
 const districts=features.map(d=>({id:d.feature.properties.id,name:d.feature.properties.name,lat:d.lat,lon:d.lon,geometry:d.feature.geometry,traffic:0,departures:0,delayed:0,alerts:0,count:0,score:0})),byId=new Map(districts.map(d=>[d.id,d])),seen=new Set();
 for(const e of events||[]){
  if(!e||!validPoint(e.lat,e.lon)||e.status==='reference'||e.reference===true||e.simulated===true||e.isSimulation===true||e.simulation===true||e.sourceId==='simulation'||!['traffic','transit','alerts'].includes(e.category))continue;
  if(e.expiresAt&&Number.isFinite(Date.parse(e.expiresAt))&&Date.parse(e.expiresAt)<=now)continue;
  if(e.id&&seen.has(e.id))continue;if(e.id)seen.add(e.id);
  const feature=districtForPoint(e.lat,e.lon),d=feature&&byId.get(feature.properties.id);if(!d)continue;
  d.count++;if(e.category==='traffic')d.traffic++;else if(e.category==='transit'){d.departures++;if(Number.isFinite(e.delay)&&e.delay>=5)d.delayed++;}else if(e.category==='alerts')d.alerts++;
 }
 return districts.map(d=>({...d,score:Math.min(100,d.traffic+2*d.departures+4*d.delayed+5*d.alerts)}));
}
