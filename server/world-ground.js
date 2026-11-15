import {distanceKm, lineIntersectsRadius} from './transport.js';

const OVERPASS = 'https://overpass-api.de/api/interpreter';
const OSM = 'https://www.openstreetmap.org';
const MAX_ITEMS = 350;
const TTL = 5 * 60 * 1000;
const cache = new Map();
const pending = new Map();
const fc = features => ({type: 'FeatureCollection', features});
const clean = value => typeof value === 'string' ? value.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 400) : '';
const pointValid = p => Number.isFinite(p?.lat) && Number.isFinite(p?.lon) && Math.abs(p.lat) <= 85 && Math.abs(p.lon) <= 180;

const catalog = {
  cameras: {name: 'Mapped public cameras', filters: ['["man_made"="surveillance"]'], note: 'OpenStreetMap camera locations and descriptive tags. A mapped camera is not a verified accessible video stream; no footage or personal observations are supplied.'},
  alpr: {name: 'Mapped plate-reader cameras', filters: ['["surveillance:type"~"^(ALPR|ANPR|alpr|anpr|number_plate_recognition)$"]', '["camera:type"~"^(ALPR|ANPR|alpr|anpr)$"]'], note: 'Public OpenStreetMap ALPR / ANPR location tags only. No plate numbers, vehicle identities or camera access.'},
  datacenters: {name: 'Data centres', filters: ['["telecom"="data_center"]', '["building"="data_center"]'], note: 'OpenStreetMap mapped data-centre buildings and facilities. Reference infrastructure, not live occupancy or power measurements.'},
  dams: {name: 'Dams and weirs', filters: ['["waterway"~"^(dam|weir)$"]', '["man_made"="dam"]'], note: 'OpenStreetMap mapped dams and weirs. No water-level or structural condition measurements.'},
  installations: {name: 'Mapped installations', filters: ['["landuse"="military"]', '["military"~"^(base|airfield|barracks|naval_base|training_area)$"]'], note: 'Public OpenStreetMap facility boundaries and names. Reference mapping only; no current personnel, readiness or operations information.'},
  seaMarks: {name: 'Sea marks', filters: ['["seamark:type"]'], note: 'OpenStreetMap sea marks, buoys and navigation structures. Reference mapping, not an approved navigation chart.'},
  skiPistes: {name: 'Ski pistes', filters: ['["piste:type"]'], note: 'OpenStreetMap piste paths and areas. Conditions and opening status are not observed.'},
  shipwrecks: {name: 'Mapped shipwrecks', filters: ['["historic"="wreck"]', '["seamark:type"="wreck"]'], note: 'Public OpenStreetMap wreck locations and descriptive tags. Positions may be approximate.'},
  bikeshare: {name: 'Bikeshare stations', filters: ['["amenity"="bicycle_rental"]'], note: 'OpenStreetMap mapped bicycle-rental and bikeshare stations. This reference layer does not provide live bike or dock availability.'},
  rail: {name: 'Rail infrastructure', filters: ['["railway"~"^(station|halt|rail|light_rail|tram|subway)$"]'], note: 'OpenStreetMap mapped rail paths and stops. The Berlin transport layers separately provide the VBB reference network; these are not live vehicle positions.'},
  transit: {name: 'Transit stops', filters: ['["public_transport"~"^(platform|stop_position|station)$"]', '["highway"="bus_stop"]'], note: 'OpenStreetMap public transport stops and platforms. Departure estimates and tracked vehicle positions are not supplied by this source.'},
  traffic: {name: 'Road works and traffic signals', filters: ['["highway"~"^(construction|traffic_signals)$"]'], note: 'OpenStreetMap road construction and traffic signals. No live flow speeds or congestion observations. Illustrative cars in the Berlin scene remain simulated.'},
  cables: {name: 'Mapped submarine cables', filters: ['["seamark:type"="cable_submarine"]', '["man_made"="submarine_cable"]', '["route"="submarine_cable"]'], note: 'OpenStreetMap mapped submarine cables. This source does not include the separately licensed TeleGeography dataset from the original project.'},
  airspaceRestricted: {name: 'Mapped airspace references', filters: ['["boundary"="airspace"]', '["airspace:type"~"^(restricted|prohibited|danger)$"]'], note: 'OpenStreetMap airspace reference features, where mapped. Not an official FAA / DFS operational restriction or NOTAM feed; verify current restrictions with the aviation authority.'},
};

const gated = {
  vessels: {name: 'Live vessel AIS', url: 'https://aisstream.io/', status: 'needs-key', note: 'The original live ship layer requires an AISStream API key and a persistent stream service. No live vessel backend is configured for this public deployment.'},
  streetlevel: {name: 'Street-level imagery', url: 'https://www.mapillary.com/developer', status: 'needs-key', note: 'Mapillary street-level photos require a public Mapillary client token. The existing place details can open available Street View separately; no panorama is claimed here.'},
  gnss: {name: 'GNSS integrity', url: 'https://gpsjam.org/', status: 'unavailable', note: 'No current GNSS interference observations are configured. Interference cannot be inferred from ordinary map data or the device location accuracy circle.'},
};

export const groundKinds = [...Object.keys(catalog), ...Object.keys(gated)];

export function validateGroundArea({lat, lon, radius = 5} = {}) {
  if (!pointValid({lat, lon}) || !Number.isFinite(radius) || radius < 1 || radius > 20) throw new RangeError('Valid coordinates and a radius between 1 and 20 km are required.');
  return {lat, lon, radius};
}

function source(kind, status, count = 0, extra = '') {
  const c = catalog[kind] || gated[kind];
  return {id: `world-${kind}`, name: c.name, url: c.url || 'https://www.openstreetmap.org/copyright', license: c.url ? undefined : 'ODbL 1.0', status, count, updatedAt: new Date().toISOString(), note: [c.note, extra].filter(Boolean).join(' ')};
}

export function groundQuery(kind, area) {
  if (!catalog[kind]) throw new RangeError('Choose a mapped ground layer.');
  const {lat, lon, radius} = validateGroundArea(area);
  const around = `(around:${Math.round(radius * 1000)},${lat.toFixed(6)},${lon.toFixed(6)})`;
  return `[out:json][timeout:7];(${catalog[kind].filters.map(f => `nwr${f}${around};`).join('')});out center geom ${MAX_ITEMS};`;
}

function elementGeometry(element) {
  const coordinates = element.geometry?.map(p => [p.lon, p.lat]).filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 85);
  if (coordinates?.length > 1) {
    const a = coordinates[0], b = coordinates.at(-1);
    if (coordinates.length >= 4 && a[0] === b[0] && a[1] === b[1] && element.tags?.area !== 'no' && !element.tags?.highway && !element.tags?.railway && !element.tags?.waterway && !element.tags?.['piste:type']) return {type: 'Polygon', coordinates: [coordinates]};
    return {type: 'LineString', coordinates};
  }
  return null;
}

function elementPoint(element, geometry) {
  if (pointValid(element)) return {lat: element.lat, lon: element.lon};
  if (pointValid(element.center)) return element.center;
  const coordinates = geometry?.type === 'Polygon' ? geometry.coordinates[0] : geometry?.coordinates;
  if (!coordinates?.length) return null;
  return {lat: coordinates.reduce((n, p) => n + p[1], 0) / coordinates.length, lon: coordinates.reduce((n, p) => n + p[0], 0) / coordinates.length};
}

export function parseGroundElements(kind, payload, area) {
  const {lat, lon, radius} = validateGroundArea(area);
  if (!catalog[kind] || !Array.isArray(payload?.elements)) throw new TypeError('The map provider did not return elements.');
  const items = [], features = [], seen = new Set();
  for (const element of payload.elements) {
    if (items.length >= MAX_ITEMS) break;
    if (!['node', 'way', 'relation'].includes(element?.type) || !Number.isSafeInteger(element.id) || element.id < 1) continue;
    const id = `${kind}-osm-${element.type}-${element.id}`;
    if (seen.has(id)) continue;
    const geometry = elementGeometry(element), point = elementPoint(element, geometry);
    if (!pointValid(point)) continue;
    const line = geometry?.type === 'Polygon' ? geometry.coordinates[0] : geometry?.coordinates;
    if (distanceKm(lat, lon, point.lat, point.lon) > radius && (!line || !lineIntersectsRadius(line, lat, lon, radius))) continue;
    const tags = element.tags && typeof element.tags === 'object' ? element.tags : {};
    const name = clean(tags['name:en']) || clean(tags.name) || clean(tags.operator) || clean(tags.ref) || catalog[kind].name.replace(/s$/, '');
    const detailKeys = ['operator', 'network', 'ref', 'railway', 'waterway', 'seamark:type', 'piste:type', 'piste:difficulty', 'surveillance:type', 'surveillance', 'camera:direction', 'capacity', 'height', 'start_date', 'historic', 'airspace:type'];
    const details = detailKeys.map(k => clean(tags[k]) ? `${k}: ${clean(tags[k])}` : '').filter(Boolean);
    const item = {id, title: name, ...point, category: kind, source: 'OpenStreetMap contributors', sourceUrl: `${OSM}/${element.type}/${element.id}`, license: 'ODbL 1.0', status: 'reference', description: [catalog[kind].note, ...details].join(' · '), updatedAt: Number.isFinite(Date.parse(element.timestamp)) ? new Date(element.timestamp).toISOString() : null};
    items.push(item); seen.add(id);
    if (geometry) features.push({type: 'Feature', id, properties: {id, title: name, category: kind, source: item.source, sourceUrl: item.sourceUrl}, geometry});
  }
  return {items, features: fc(features)};
}

async function publicJSON(url) {
 const r=await fetch(url,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(9000)});if(!r.ok)throw new Error('Public provider unavailable');const t=await r.text();if(t.length>8000000)throw new Error('Provider response exceeds limit');return JSON.parse(t);
}
export function parseBikeAvailability(info,status,area) {
 if(!Array.isArray(info?.data?.stations)||!Array.isArray(status?.data?.stations))throw new Error('Invalid GBFS stations');
 const live=new Map(status.data.stations.map(s=>[s.station_id,s]));
 return info.data.stations.filter(s=>pointValid(s)&&distanceKm(area.lat,area.lon,s.lat,s.lon)<=area.radius&&live.has(s.station_id)).slice(0,350).map(s=>{const a=live.get(s.station_id),stamp=Number(a.last_reported);return {id:'bikeshare-citibike-'+s.station_id,title:clean(s.name),lat:s.lat,lon:s.lon,category:'bikeshare',source:'Citi Bike / GBFS',sourceUrl:'https://citibikenyc.com/system-data',status:'published',updatedAt:Number.isFinite(stamp)&&stamp>0?new Date(stamp*1000).toISOString():null,description:`${Number.isFinite(a.num_bikes_available)?a.num_bikes_available:'Unknown'} bikes · ${Number.isFinite(a.num_docks_available)?a.num_docks_available:'Unknown'} docks. Published station availability; values may have changed.`,bikes:a.num_bikes_available,docks:a.num_docks_available};});
}
async function streetPhotos(area) {
 const dy=area.radius/111.32,dx=dy/Math.max(.1,Math.cos(area.lat*Math.PI/180)),bbox=[area.lon-dx,area.lat-dy,area.lon+dx,area.lat+dy];
 try{const d=await publicJSON('https://api.panoramax.xyz/api/search?'+new URLSearchParams({bbox:bbox.join(','),limit:'40'}));if(!Array.isArray(d.features))throw new Error('Invalid photo response');
 const items=d.features.filter(f=>f.geometry?.type==='Point'&&pointValid({lon:f.geometry.coordinates[0],lat:f.geometry.coordinates[1]})).map(f=>{const props=f.properties||{},asset=f.assets?.hd?.href||f.assets?.sd?.href||f.assets?.image?.href||f.assets?.thumbnail?.href;return {id:'streetlevel-'+f.id,title:clean(props.title)||'Panoramax street image',lon:f.geometry.coordinates[0],lat:f.geometry.coordinates[1],category:'streetlevel',source:'Panoramax contributors',sourceUrl:'https://panoramax.xyz/#pic='+encodeURIComponent(f.id),status:'reference',description:'Published street photograph. Capture date and contributor license apply; this is not live imagery.',updatedAt:Number.isFinite(Date.parse(props.datetime))?new Date(props.datetime).toISOString():null,imageUrl:typeof asset==='string'&&asset.startsWith('https://')?asset:undefined,license:clean(props.license)||'See original photograph for contributor and license'};});
 return {items,source:{name:'Panoramax public street imagery',url:'https://panoramax.xyz/',status:'connected',count:items.length,note:'Public photographs where contributors have coverage; optional Mapillary/Google integrations remain separate.',updatedAt:new Date().toISOString()}};
 }catch{return {items:[],source:{name:'Panoramax public street imagery',url:'https://panoramax.xyz/',status:'unavailable',count:0,note:'Public photograph provider could not be reached. No synthetic street images are substituted.',updatedAt:null}};}
}
export async function getGroundLayer(kind, area, env = {}) {
  if (!groundKinds.includes(kind)) throw new RangeError('Unknown ground layer.');
  const {lat, lon, radius} = validateGroundArea(area);
  if(kind==='streetlevel')return streetPhotos({lat,lon,radius});
  if(kind==='bikeshare'&&Math.abs(lat-40.73)<.7&&Math.abs(lon+74)<.7){try{const [info,status]=await Promise.all(['station_information','station_status'].map(k=>publicJSON('https://gbfs.citibikenyc.com/gbfs/2.3/en/'+k+'.json'))),items=parseBikeAvailability(info,status,{lat,lon,radius});return {items,source:{name:'Citi Bike / GBFS',url:'https://citibikenyc.com/system-data',status:'connected',count:items.length,note:'Published New York station availability. Elsewhere this layer falls back to mapped OSM stations.',updatedAt:new Date().toISOString()}};}catch{/* Retain an explicit mapped-station fallback. */}}
  if (gated[kind]) return {items: [], features: fc([]), source: source(kind, gated[kind].status)};
  const key = `${kind}:${lat.toFixed(3)}:${lon.toFixed(3)}:${radius}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.time < TTL) return hit.value;
  if (pending.has(key)) return pending.get(key);
  const request = (async () => {
    try {
      const response = await fetch(OVERPASS, {method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json'}, body: new URLSearchParams({data: groundQuery(kind, {lat, lon, radius})}), signal: AbortSignal.timeout(9000)});
      if (!response.ok) throw new Error(`Provider returned ${response.status}`);
      const text = await response.text();
      if (text.length > 8 * 1024 * 1024) throw new Error('The map provider response is too large');
      const data = parseGroundElements(kind, JSON.parse(text), {lat, lon, radius});
      const value = {...data, source: source(kind, 'connected', data.items.length, data.items.length >= MAX_ITEMS ? `The response is capped at ${MAX_ITEMS} mapped features; reduce the observation radius to inspect a smaller area.` : '')};
      cache.set(key, {time: Date.now(), value});
      while (cache.size > 48) cache.delete(cache.keys().next().value);
      return value;
    } catch {
      return {items: [], features: fc([]), source: source(kind, 'unavailable', 0, 'The public map provider could not be reached. No substitute locations were generated.')};
    } finally { pending.delete(key); }
  })();
  pending.set(key, request);
  return request;
}
