/** Public data adapters. No credentials, synthetic incidents, or arbitrary URL proxy. */
const cache = new Map();
const pending = new Map();
const formatters = new Map();
const WFS = 'https://gdi.berlin.de/services/wfs/planb_ereignisse';
const METEO = 'https://api.open-meteo.com/v1/forecast';
const AIR = 'https://air-quality-api.open-meteo.com/v1/air-quality';
const WIKI = 'https://en.wikipedia.org/w/api.php';
const VBB = 'https://v6.vbb.transport.rest';
const timestamp = () => new Date().toISOString();
const text = value => String(value ?? '').replace(/<[^>]*>/g, ' ').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 1600);
const numeric = value => value!==null && value!==undefined && value!=='' && Number.isFinite(Number(value)) ? Number(value) : null;

export function distanceKm(lat1, lon1, lat2, lon2) {
  const rad = Math.PI / 180;
  const a = Math.sin((lat2-lat1)*rad/2)**2 + Math.cos(lat1*rad)*Math.cos(lat2*rad)*Math.sin((lon2-lon1)*rad/2)**2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0,1-a)));
}

export function localTimeIso(value, zone) {
  if (!value) return null;
  if (/[Zz]$|[+-]\d\d:\d\d$/.test(value)) return Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
  const base = Date.parse(value+'Z');
  if (!Number.isFinite(base)) return null;
  if(!formatters.has(zone))formatters.set(zone,new Intl.DateTimeFormat('en-GB',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}));
  const parts = Object.fromEntries(formatters.get(zone).formatToParts(new Date(base)).map(p=>[p.type,p.value]));
  const local = Date.UTC(+parts.year,+parts.month-1,+parts.day,+parts.hour,+parts.minute,+parts.second);
  return new Date(base-(local-base)).toISOString();
}

export function germanDate(value, end=false) {
  const match = String(value||'').match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  return match ? localTimeIso(`${match[3]}-${match[2]}-${match[1]}T${end?'23:59:59':'00:00:00'}`,'Europe/Berlin') : null;
}

export function centroid(geometry) {
  const coords=[];
  const walk = a => {
    if (!Array.isArray(a)) return;
    if (typeof a[0]==='number' && typeof a[1]==='number') coords.push(a);
    else for (const c of a) walk(c);
  };
  walk(geometry?.coordinates);
  if (!coords.length) return null;
  return [coords.reduce((n,c)=>n+c[0],0)/coords.length,coords.reduce((n,c)=>n+c[1],0)/coords.length];
}

async function json(url, timeout=9500) {
  const controller = new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeout);
  try {
    const response=await fetch(url,{signal:controller.signal,headers:{Accept:'application/json','User-Agent':'AroundMe/1.0'}});
    if (!response.ok) throw new Error(`Provider returned HTTP ${response.status}`);
    const body=await response.text();
    if (body.length>12000000) throw new Error('Provider response exceeded size limit');
    try { return JSON.parse(body); } catch { throw new Error('Provider did not return valid JSON'); }
  } finally {clearTimeout(timer);}
}

async function cached(key,ttl,fn) {
  const hit=cache.get(key);
  if (hit && Date.now()<hit.until) return hit.data;
  if (pending.has(key)) return pending.get(key);
  const task=fn().then(data=>{
    if(cache.size>80) cache.delete(cache.keys().next().value);
    cache.set(key,{until:Date.now()+ttl,data});return data;
  }).finally(()=>pending.delete(key));
  pending.set(key,task);return task;
}

const source=(id,name,url,license,note='')=>({id,name,url,license,note,status:'connected',count:0,updatedAt:timestamp()});
const failure=(s,error)=>({...s,status:'unavailable',count:0,note:`${s.note ? s.note+' ' : ''}${error?.name==='AbortError'?'Provider timed out.':text(error?.message||'Provider unavailable.')}`,updatedAt:timestamp()});
const near=(p,lat,lon,radius)=>Number.isFinite(p.lat)&&Number.isFinite(p.lon)&&distanceKm(lat,lon,p.lat,p.lon)<=radius;

export function parseStreetFeatures(data, now=Date.now()) {
  if(!Array.isArray(data?.features)) throw new Error('Invalid street-activity response');
  return data.features.flatMap(f=>{
    const p=f.properties||{}, point=centroid(f.geometry);
    if(!point) return [];
    const start=germanDate(p.dat_beginn), end=germanDate(p.dat_ende,true);
    if(end && Date.parse(end)<now) return [];
    if(start && Date.parse(start)>now+14*86400000) return [];
    const subtype=text(p.ereignis)||'Street activity';
    const prefix=/Arbeitsstelle/i.test(subtype)?'Roadworks':/Film/i.test(subtype)?'Filming':/Veranstaltung/i.test(subtype)?'Street event':subtype;
    const location=[p.strasse,p.von_str && `near ${p.von_str}`,p.ortsteil].filter(Boolean).map(text).join(' · ');
    return [{id:`berlin-${f.id||p.importid}`,category:'traffic',subtype,title:`${prefix} · ${text(p.strasse)||text(p.ortsteil)||'Berlin'}`,description:[text(p.einschr),location,`Permit category: ${subtype}. Published planning record; on-site conditions may differ.`].filter(Boolean).join(' '),lat:point[1],lon:point[0],geometry:f.geometry,source:'Berlin street activity',sourceId:'berlin-streets',sourceUrl:'https://daten.berlin.de/datensaetze/planbare-ereignisse-im-offentlichen-strassenland-wfs-2c6359e2',publishedAt:null,updatedAt:null,startsAt:start,expiresAt:end,status:start&&Date.parse(start)>now?'upcoming':'active'}];
  });
}

async function streets({lat,lon,radius}) {
  const s=source('berlin-streets','Berlin street activity',WFS,'Datenlizenz Deutschland – Zero 2.0','Approved/planned street activity; exact locations shown as geometry.');
  try {
    const dy=radius/110.574,dx=radius/(111.32*Math.cos(lat*Math.PI/180));
    // Provider WAF rejects unnecessarily long floating-point coordinate strings.
    const bbox=[lon-dx,lat-dy,lon+dx,lat+dy].map(n=>n.toFixed(5)).join(',')+',CRS:84';
    const params=new URLSearchParams({service:'WFS',version:'2.0.0',request:'GetFeature',typeNames:'planb_ereignisse:ereignisse',outputFormat:'application/json',srsName:'CRS:84',bbox,count:'1000'});
    const data=await json(`${WFS}?${params}`,12000);
    const events=parseStreetFeatures(data).filter(e=>near(e,lat,lon,radius));
    const limited=data.numberMatched>data.numberReturned;
    return {events,source:{...s,count:events.length,updatedAt:data.timeStamp||s.updatedAt,status:limited?'limited':'connected',note:s.note+(limited?' Bounded sample: provider has more records in this area; this view is not exhaustive.':'')}};
  }catch(e){return {events:[],source:failure(s,e)};}
}

const weatherNames = code => ({0:'Clear sky',1:'Mostly clear',2:'Partly cloudy',3:'Overcast',45:'Fog',48:'Depositing rime fog',51:'Light drizzle',53:'Drizzle',55:'Heavy drizzle',61:'Light rain',63:'Rain',65:'Heavy rain',71:'Light snow',73:'Snow',75:'Heavy snow',80:'Rain showers',81:'Rain showers',82:'Heavy showers',95:'Thunderstorm',96:'Thunderstorm with hail',99:'Thunderstorm with hail'}[code]||'Weather conditions');
async function weather({lat,lon}) {
  const s=source('weather','Open-Meteo weather', 'https://open-meteo.com/','CC BY 4.0; free endpoint is for non-commercial use','Model-derived conditions, not a street-level sensor.');
  try {
    const data=await json(`${METEO}?${new URLSearchParams({latitude:String(lat),longitude:String(lon),current:'temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m',hourly:'temperature_2m',forecast_days:'2',timezone:'UTC'})}`);
    if(!data.current||!Number.isFinite(data.current.temperature_2m))throw new Error('Invalid weather response');
    const c=data.current,time=localTimeIso(c.time,'UTC');
    return {source:{...s,count:1,updatedAt:time},weather:{temperature:c.temperature_2m,humidity:c.relative_humidity_2m,windSpeed:c.wind_speed_10m,weatherCode:c.weather_code,description:weatherNames(c.weather_code),time,unit:'°C',hourly:(data.hourly?.time||[]).map((t,i)=>({time:localTimeIso(t,'UTC'),temperature:data.hourly.temperature_2m[i]})).filter(h=>h.time&&Date.parse(h.time)>=Date.now()&&Number.isFinite(h.temperature)).slice(0,24)}};
  }catch(e){return {source:failure(s,e)};}
}

async function air({lat,lon}) {
  const s=source('air','CAMS / Open-Meteo air quality','https://open-meteo.com/en/docs/air-quality-api','CC BY 4.0; CAMS ENSEMBLE; free endpoint non-commercial','Regional modeled air quality, not a local measurement.');
  try {
    const data=await json(`${AIR}?${new URLSearchParams({latitude:String(lat),longitude:String(lon),current:'pm10,pm2_5,european_aqi',forecast_days:'1',timezone:'UTC'})}`);
    if(!data.current||!Number.isFinite(data.current.european_aqi))throw new Error('Invalid air-quality response');
    const c=data.current,time=localTimeIso(c.time,'UTC');
    return {source:{...s,count:1,updatedAt:time},airQuality:{aqi:c.european_aqi,pm25:c.pm2_5,pm10:c.pm10,time,scale:'European AQI'}};
  }catch(e){return {source:failure(s,e)};}
}

async function places({lat,lon,radius}) {
  const s=source('places','Wikipedia nearby places','https://en.wikipedia.org/','CC BY-SA; Wikimedia terms','Reference context from geotagged articles. Not a live activity feed or a complete directory.');
  try {
    const data=await cached(`wiki:${lat.toFixed(3)}:${lon.toFixed(3)}:${radius}`,900000,()=>json(`${WIKI}?${new URLSearchParams({action:'query',list:'geosearch',gscoord:`${lat}|${lon}`,gsradius:String(Math.min(10000,radius*1000)),gslimit:'100',format:'json'})}`));
    if(!Array.isArray(data.query?.geosearch))throw new Error('Invalid reference-place response');
    const items=data.query.geosearch.map(p=>({id:`wiki-${p.pageid}`,category:'places',subtype:'Reference place',title:text(p.title),description:'Geotagged reference place from Wikipedia. Open the source to learn about this location. This marker does not indicate current activity.',lat:p.lat,lon:p.lon,source:'Wikipedia',sourceId:'places',sourceUrl:`https://en.wikipedia.org/?curid=${encodeURIComponent(p.pageid)}`,publishedAt:null,updatedAt:null,status:'reference'})).filter(p=>near(p,lat,lon,radius));
    return {source:{...s,count:items.length},places:items};
  }catch(e){return {source:failure(s,e),places:[]};}
}

export function parseDepartures(data, now=Date.now()) {
  if(!Array.isArray(data?.departures))throw new Error('Invalid transit departure response');
  return data.departures.flatMap(d=>{
    const l=d.stop?.location;
    if(!l||!Number.isFinite(l.latitude)||!Number.isFinite(l.longitude))return [];
    const time=d.when||d.plannedWhen;
    if(!time||Date.parse(time)<now-120000)return [];
    const delay=Number.isFinite(d.delay)?Math.round(d.delay/60):null;
    return [{id:`vbb-${d.tripId}-${time}`,category:'transit',subtype:d.line?.productName||'Departure',title:`${text(d.line?.name)||'Transit'} → ${text(d.direction)||'Departure'}`,description:`${text(d.stop.name)}. ${d.cancelled?'Cancelled.':delay===null?'Timetable only; no delay estimate.':delay>0?`${delay} min late.`:'On time.'}${d.platform?` Platform ${text(d.platform)}.`:''}`,lat:l.latitude,lon:l.longitude,source:'VBB via transport.rest',sourceId:'transit',sourceUrl:'https://unternehmen.vbb.de/digitale-services/',publishedAt:null,updatedAt:null,startsAt:time,expiresAt:time,status:d.cancelled?'published':'upcoming',line:text(d.line?.name),delay,stop:text(d.stop.name),departureAt:time}];
  });
}

async function transit({lat,lon,radius}) {
  const s=source('transit','VBB / transport.rest','https://v6.vbb.transport.rest/','Community API; upstream VBB terms apply','Near the selected position; departures are not vehicle locations. Community service has no availability guarantee.');
  try {
    const stops=await json(`${VBB}/locations/nearby?${new URLSearchParams({latitude:String(lat),longitude:String(lon),distance:String(Math.min(radius*1000,3000)),results:'3'})}`);
    if(!Array.isArray(stops))throw new Error('Invalid stop response');
    const results=await Promise.allSettled(stops.slice(0,3).map(st=>json(`${VBB}/stops/${encodeURIComponent(st.id)}/departures?duration=30&results=8`).then(d=>parseDepartures(d))));
    const events=results.flatMap(r=>r.status==='fulfilled'?r.value:[]).filter(p=>near(p,lat,lon,radius));
    if(stops.length && results.every(r=>r.status==='rejected'))throw new Error('Departure feeds unavailable');
    const ps=stops.filter(st=>st.location).map(st=>({id:`vbb-stop-${st.id}`,category:'places',subtype:'Transit stop',title:text(st.name),description:'Public transit stop. Departures appear in the transit layer when available.',lat:st.location.latitude,lon:st.location.longitude,source:'VBB via transport.rest',sourceId:'transit',sourceUrl:'https://unternehmen.vbb.de/digitale-services/',publishedAt:null,updatedAt:null,status:'reference'}));
    return {source:{...s,count:events.length,status:'limited'},events,places:ps};
  }catch(e){return {source:failure(s,e),events:[],places:[]};}
}

export function warningRecord(a,detail=null) {
  const payload=a.payload||{}, info=detail?.info?.find(i=>i.language?.startsWith('de'))||detail?.info?.[0]||{};
  const areas=Array.isArray(info.area)?info.area:[];
  const rings=areas.flatMap(area=>{
    const polygons=Array.isArray(area.polygon)?area.polygon:area.polygon?[area.polygon]:[];
    return polygons.map(poly=>String(poly).trim().split(/\s+/).map(pair=>pair.split(',').map(Number)).filter(p=>p.length===2&&Number.isFinite(p[0])&&Number.isFinite(p[1])&&Math.abs(p[0])<=90&&Math.abs(p[1])<=180).map(([latitude,longitude])=>[longitude,latitude])).filter(r=>r.length>=3).map(r=>r[0][0]===r.at(-1)[0]&&r[0][1]===r.at(-1)[1]?r:[...r,r[0]]);
  });
  const geometry=rings.length?{type:'MultiPolygon',coordinates:rings.map(r=>[r])}:undefined;
  const point=centroid(geometry)||[13.405,52.52];
  const expires=info.expires||payload.data?.validUntil||null;
  const sent=detail?.sent||a.sent||null;
  const areasText=areas.map(area=>text(area.areaDesc)).filter(Boolean).join('; ');
  return {id:`bbk-${text(a.id)}`,category:'alerts',title:text(info.headline||payload.headline)||'Berlin public warning',description:[text(info.description),areasText&&`Affected area: ${areasText}.`,geometry?'Area warning: marker is an approximate affected-area centre, not an incident address.':'Berlin area warning: marker is a city reference position, not an incident address. The provider did not supply a usable affected-area polygon.', 'Read the official notice for the affected area and instructions.'].filter(Boolean).join(' '),lat:point[1],lon:point[0],geometry,locationPrecision:geometry?'area':'city',source:'BBK / NINA',sourceId:'alerts',sourceUrl:'https://warnung.bund.de/',publishedAt:sent,updatedAt:sent,expiresAt:expires,severity:info.severity||payload.severity||null,status:'published'};
}

async function warnings() {
  const s=source('alerts','BBK public warnings','https://warnung.bund.de/','Official public warning content; BBK terms apply','Berlin area warnings. No incident-dispatch coverage. Dashboard interface may change; redistribution arrangements must be reviewed for commercial operation.');
  try {
    const data=await json('https://warnung.bund.de/api31/dashboard/110000000000.json');
    if(!Array.isArray(data))throw new Error('Invalid public warning response');
    const current=data.filter(a=>a.payload?.data?.validUntil ? Date.parse(a.payload.data.validUntil)>Date.now():true);
    const events=(await Promise.all(current.slice(0,12).map(async a=>{
      let detail=null;
      if(typeof a.id==='string'&&a.id.length<160){try{detail=await cached(`bbk:${a.id}`,120000,()=>json(`https://warnung.bund.de/api31/warnings/${encodeURIComponent(a.id)}.json`,4500));}catch{/* Keep the official area warning even if details are unavailable. */}}
      return warningRecord(a,detail);
    }))).filter(e=>!e.expiresAt||!Number.isFinite(Date.parse(e.expiresAt))||Date.parse(e.expiresAt)>Date.now());
    return {events,source:{...s,count:events.length,status:'limited',note:s.note+' Markers represent warning areas, not incident locations.'+(current.length>12?' Limited to twelve current warnings.':'')}};
  }catch(e){return {source:failure(s,e),events:[]};}
}

async function earthquakes({lat,lon,radius}) {
  const s=source('earthquakes','USGS earthquakes','https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php','USGS public data','Published earthquake observations from the last 24 hours within the selected radius. Preliminary observations may be revised.');
  try {
    const data=await cached('usgs-day',120000,()=>json('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson'));
    if(!Array.isArray(data.features))throw new Error('Invalid earthquake response');
    const events=data.features.filter(f=>Number.isFinite(f.properties?.time)&&Number.isFinite(f.properties?.updated)).map(f=>({id:`usgs-${f.id}`,category:'environment',subtype:'Earthquake',title:text(f.properties?.title)||'Earthquake',description:`Magnitude ${f.properties?.mag ?? 'unknown'}. ${text(f.properties?.place)}. Preliminary event observation.`,lat:f.geometry?.coordinates?.[1],lon:f.geometry?.coordinates?.[0],source:'USGS',sourceId:'earthquakes',sourceUrl:f.properties?.url||s.url,publishedAt:new Date(f.properties.time).toISOString(),updatedAt:new Date(f.properties.updated).toISOString(),status:'published'})).filter(p=>near(p,lat,lon,radius));
    return {events,source:{...s,count:events.length,updatedAt:new Date(data.metadata.generated).toISOString()}};
  }catch(e){return {source:failure(s,e),events:[]};}
}

async function seattle({lat,lon,radius}) {
  const s=source('seattle-fire','Seattle Fire public reports','https://cos-data.seattle.gov/d/kzjm-xkqj','City of Seattle open data terms','Published dispatch records, not verified outcomes or live unit locations. Only fire/rescue categories; recent 6 hours; point positions rounded.');
  try {
    const since=new Date(Date.now()-6*3600000).toLocaleString('sv-SE',{timeZone:'America/Los_Angeles'}).replace(' ','T');
    const params=new URLSearchParams({'$limit':'200','$order':'datetime DESC','$where':`datetime > '${since}'`});
    const data=await json(`https://cos-data.seattle.gov/resource/kzjm-xkqj.json?${params}`);
    if(!Array.isArray(data))throw new Error('Invalid Seattle response');
    const events=data.filter(d=>numeric(d.latitude)!==null&&numeric(d.longitude)!==null&&!/Aid|Medic|Medical|ALS|BLS/i.test(d.type||'')).map(d=>({id:`sea-${text(d.incident_number)}`,category:'alerts',subtype:'Published fire report',title:`Seattle Fire · ${text(d.type)}`,description:`Published dispatch category: ${text(d.type)}. The source does not confirm outcome or whether activity continues. Location shown approximately.`,lat:Math.round(numeric(d.latitude)*1000)/1000,lon:Math.round(numeric(d.longitude)*1000)/1000,source:'Seattle Fire Department',sourceId:'seattle-fire',sourceUrl:s.url,publishedAt:localTimeIso(d.datetime,'America/Los_Angeles'),updatedAt:null,status:'published'})).filter(p=>near(p,lat,lon,radius));
    return {events,source:{...s,count:events.length}};
  }catch(e){return {events:[],source:failure(s,e)};}
}

/** radius is in km. All results are bounded public-source observations or marked reference context. */
export async function getOverview(input={}) {
  const city=String(input.city||'berlin').toLowerCase();
  const defaults=city==='seattle'?[47.6062,-122.3321]:['nyc','new-york','newyork'].includes(city)?[40.7128,-74.006]:[52.52,13.405];
  const lat=Number(input.lat ?? defaults[0]),lon=Number(input.lon ?? defaults[1]),radius=Number(input.radius ?? 5);
  if(!Number.isFinite(lat)||lat<-85||lat>85||!Number.isFinite(lon)||lon<-180||lon>180||!Number.isFinite(radius)||radius<0.25||radius>25)throw new RangeError('Valid latitude, longitude and radius 0.25–25 km are required');
  const args={lat,lon,radius,city};
  const key=`overview:${city}:${lat.toFixed(4)}:${lon.toFixed(4)}:${radius}`;
  return cached(key,90000,async()=>{
    const berlin=lat>52.3&&lat<52.7&&lon>13.0&&lon<13.8;
    const tasks=[weather(args),air(args),places(args),earthquakes(args)];
    if(berlin)tasks.push(streets(args),transit(args),warnings(args),Promise.resolve({source:{...source('civic','Berlin civic reports','https://daten.berlin.de/datensaetze/ordnungsamt-online','Datenlizenz Deutschland – Namensnennung 2.0'),status:'unavailable',updatedAt:null,note:'Not connected in this version. The Ordnungsamt public endpoint did not respond during verification; zero here is not a count of city complaints.'}}));
    if(lat>47.3&&lat<47.8&&lon>-122.6&&lon<-122.0)tasks.push(seattle(args));
    if(!berlin&&!(lat>47.3&&lat<47.8&&lon>-122.6&&lon<-122.0))tasks.push(Promise.resolve({source:{...source('local-activity','Local activity integrations','https://data.cityofnewyork.us/','Provider-specific terms'),status:'unavailable',updatedAt:null,note:'Local incident, traffic and transit feeds are not connected for this area in this version. Weather, air quality, earthquake observations and reference places are available separately.'}}));
    const results=await Promise.all(tasks);
    const events=results.flatMap(r=>r.events||[]);
    const unique=[...new Map(events.map(e=>[e.id,e])).values()];
    unique.sort((a,b)=>distanceKm(lat,lon,a.lat,a.lon)-distanceKm(lat,lon,b.lat,b.lon));
    return {city,center:{lat,lon},radius,updatedAt:timestamp(),events:unique,places:results.flatMap(r=>r.places||[]),sources:results.map(r=>r.source),weather:results.find(r=>r.weather)?.weather||null,airQuality:results.find(r=>r.airQuality)?.airQuality||null,coverage:'Partial public-source coverage. An empty feed does not establish that nothing is happening.'};
  });
}
