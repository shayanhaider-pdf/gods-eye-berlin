const modes = {drive:'https://router.project-osrm.org/route/v1/driving/',walk:'https://routing.openstreetmap.de/routed-foot/route/v1/driving/',cycle:'https://routing.openstreetmap.de/routed-bike/route/v1/driving/'};
const valid = p => Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&Math.abs(p[0])<=180&&Math.abs(p[1])<=85;
export async function getDirections({from,to,mode='drive'}) {
  if(!Object.hasOwn(modes,mode)||!valid(from)||!valid(to))throw new RangeError('Choose valid start and end coordinates and drive, walk or cycle.');
  const u = new URL(modes[mode]+from.join(',')+';'+to.join(','));
  u.search=new URLSearchParams({overview:'full',geometries:'geojson',steps:'true',alternatives:'false'});
  const r=await fetch(u,{signal:AbortSignal.timeout(10000),headers:{Accept:'application/json'}});
  if(!r.ok)throw new Error('The public routing provider is unavailable.');
  const d=await r.json(),route=d.routes?.[0];
  if(d.code!=='Ok'||route?.geometry?.type!=='LineString'||!Array.isArray(route.geometry.coordinates)||route.geometry.coordinates.length>20000||!route.geometry.coordinates.every(valid))throw new Error('No valid route was found.');
  return {route:route.geometry,distance:route.distance,duration:route.duration,mode,steps:(route.legs||[]).flatMap(l=>l.steps||[]).slice(0,150).map(s=>({name:String(s.name||'').slice(0,200),distance:s.distance,duration:s.duration,type:s.maneuver?.type,modifier:s.maneuver?.modifier})),source:{name:'OpenStreetMap / OSRM routing',url:'https://www.openstreetmap.org/copyright',note:'Calculated route, not observed traffic. Travel times are estimates.'}};
}
