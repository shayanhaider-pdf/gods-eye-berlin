/** Public context feeds. Observed data, model fields and reference catalogs stay distinct. */
const cache = new Map(), pending = new Map();
const kinds = new Set(['news', 'wildlife', 'radio', 'militaryFlights', 'firePerimeters', 'airquality', 'clouds', 'lightning']);
const fc = features => ({type: 'FeatureCollection', features});
const now = () => new Date().toISOString();
const finite = x => typeof x === 'number' && Number.isFinite(x);
const text = (v, max = 500) => String(v ?? '').replace(/<[^>]*>/g, ' ').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const point = p => Array.isArray(p) && finite(p[0]) && finite(p[1]) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 85;
const date = v => { if(v===null||v===undefined||v==='')return null;const t = new Date(v); return Number.isFinite(t.getTime()) ? t.toISOString() : null; };
const link = value => { try { const u = new URL(value); return ['https:', 'http:'].includes(u.protocol) ? u.href : null; } catch { return null; } };
function km(a, b) { const rad = Math.PI / 180, dlat = (a[1] - b[1]) * rad, dlon = (a[0] - b[0]) * rad; const h = Math.sin(dlat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dlon / 2) ** 2; return 12742 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h))); }
const near = (p, area, minimum = 0) => point(p) && km(p, [area.lon, area.lat]) <= Math.max(minimum, area.radius);
function bounds({lat, lon, radius}) { const dy = radius / 111.32, dx = radius / Math.max(1, 111.32 * Math.cos(lat * Math.PI / 180)); return [Math.max(-180, lon - dx), Math.max(-85, lat - dy), Math.min(180, lon + dx), Math.min(85, lat + dy)]; }

async function request(url, asText = false, limit = 4000000) {
  const r = await fetch(url, {headers: {Accept: asText ? 'application/xml,text/xml' : 'application/json', 'User-Agent': 'GodEyeBerlin/3.0 public-source explorer'}, signal: AbortSignal.timeout(9000)});
  if (!r.ok) throw new Error(`Provider returned HTTP ${r.status}`);
  if (Number(r.headers.get('Content-Length')) > limit) throw new Error('Provider response exceeds the size limit');
  const reader = r.body?.getReader();
  let body = '';
  if (reader) {
    const decoder = new TextDecoder(); let bytes = 0;
    try { while (true) { const {done, value} = await reader.read(); if (done) break; bytes += value.byteLength; if (bytes > limit) throw new Error('Provider response exceeds the size limit'); body += decoder.decode(value, {stream: true}); } body += decoder.decode(); }
    catch (error) { await reader.cancel().catch(() => {}); throw error; }
  } else { body = await r.text(); if (body.length > limit) throw new Error('Provider response exceeds the size limit'); }
  return asText ? body : JSON.parse(body);
}
function source(kind) {
  const catalog = {
    news: ['GDELT geographic news mentions', 'https://www.gdeltproject.org/', 'Geocoded places mentioned in reports from the last day, within at least 100 km. A report mention does not establish an incident at its marker. GDELT terms; linked publishers retain article rights.'],
    wildlife: ['iNaturalist public observations', 'https://www.inaturalist.org/', 'Recent research-grade observations, including historical observations. Published coordinates may be obscured. These are observation records, not live animal positions. Observation and photo licenses vary.'],
    radio: ['Radio Browser station directory', 'https://www.radio-browser.info/', 'Public station directory coordinates describe station locations, not transmitter coverage. Streams remain subject to broadcaster terms and browser playback restrictions.'],
    militaryFlights: ['adsb.lol public broadcast aircraft', 'https://www.adsb.lol/', 'Only public ADS-B positions whose provider database marks the aircraft as military. Classification is a database flag, not an inference about mission or activity. Coverage is incomplete.'],
    firePerimeters: ['NIFC interagency fire perimeters', 'https://data-nifc.opendata.arcgis.com/', 'Published US interagency fire perimeter polygons. Mapping and publication can lag conditions; this is not a live fire front.'],
    airquality: ['Open-Meteo / CAMS air-quality model', 'https://open-meteo.com/en/docs/air-quality-api', 'Regional modeled air quality at the scan centre, not a street-level sensor reading. Open-Meteo CC BY 4.0 / CAMS; free API non-commercial terms apply.'],
    clouds: ['NASA GIBS daily satellite imagery', 'https://earthdata.nasa.gov/gibs', 'MODIS Terra daily true-color imagery shows observed cloud context. This is yesterday’s daily image, not a live satellite video or a dedicated cloud mask. NASA EOSDIS attribution.'],
    lightning: ['Lightning observations', 'https://www.blitzortung.org/', 'No licensed lightning observation provider is configured. Rain radar and cloud imagery are not used to invent lightning strikes.']
  };
  const [name, url, note] = catalog[kind];
  return {name, url, note, count: 0, status: 'connected', updatedAt: now()};
}
const item = (kind, id, title, p, s, extra = {}) => ({id: `${kind}-${text(id, 180)}`, title: text(title, 220), lat: p[1], lon: p[0], category: kind, source: s.name, sourceUrl: s.url, status: 'published', description: s.note, updatedAt: null, ...extra});

export function parseNews(data, area, s = source('news')) {
  if (!Array.isArray(data?.features)) throw new Error('Invalid GDELT geographic response');
  return data.features.filter(f => f?.geometry?.type === 'Point' && near(f.geometry.coordinates, area, 100)).slice(0, 100).map((f, i) => {
    const p = f.properties || {}, article = link(p.url || p.sourceUrl || p.articleurl), title = p.name || p.title || p.location || 'News report mention';
    return item('news', p.id ?? `${f.geometry.coordinates.join(',')}-${i}`, title, f.geometry.coordinates, s, {sourceUrl: article || s.url, status: 'reference', description: `${text(p.description || p.html, 1200) || s.note} Geocoded report mention; verify the original report.`, updatedAt: date(p.date || p.datetime || p.timestamp)});
  });
}
export function parseWildlife(data, area, s = source('wildlife')) {
  if (!Array.isArray(data?.results)) throw new Error('Invalid iNaturalist response');
  return data.results.flatMap(o => {
    const p = o.geojson?.type === 'Point' ? o.geojson.coordinates : typeof o.location === 'string' ? o.location.split(',').map(Number).reverse() : null;
    if (!near(p, area)) return [];
    const name = o.taxon?.preferred_common_name || o.taxon?.name || 'Wildlife observation';
    return [item('wildlife', o.id, name, p, s, {status: 'reference', sourceUrl: `https://www.inaturalist.org/observations/${encodeURIComponent(o.id)}`, description: `${text(o.taxon?.name)}. ${o.observed_on ? `Observed ${text(o.observed_on)}. ` : ''}${o.obscured || o.geoprivacy ? 'Published coordinates may be obscured. ' : ''}${s.note}`, updatedAt: date(o.time_observed_at || o.observed_on), imageUrl: link(o.photos?.[0]?.url), license: text(o.license_code || 'License unspecified; consult source')})];
  }).slice(0, 100);
}
export function parseRadio(data, area, s = source('radio')) {
  if (!Array.isArray(data)) throw new Error('Invalid Radio Browser directory');
  return data.filter(r => near([r.geo_long, r.geo_lat], area) && r.lastcheckok !== 0).slice(0, 100).map(r => item('radio', r.stationuuid, r.name || 'Radio station', [r.geo_long, r.geo_lat], s, {status: 'reference', sourceUrl: link(r.homepage) || s.url, audioUrl: link(r.url_resolved || r.url), description: `${text(r.tags)}${r.bitrate ? ` · ${text(r.bitrate)} kbps` : ''}. ${s.note}`, updatedAt: date(r.lastchecktime_iso8601)}));
}
export function parseMilitaryAircraft(data, area, s = source('militaryFlights')) {
  if (!Array.isArray(data?.ac)) throw new Error('Invalid public aircraft response');
  const timestamp = finite(data.now) ? data.now > 1e12 ? data.now : data.now * 1000 : Date.now();
  return data.ac.filter(a => (Number(a.dbFlags) & 1) === 1 && near([a.lon, a.lat], area, 100) && finite(a.seen_pos) && a.seen_pos >= 0 && a.seen_pos < 120 && a.alt_baro !== 'ground').slice(0, 200).map(a => item('militaryFlights', a.hex, text(a.flight) || text(a.r) || 'Publicly broadcast aircraft', [a.lon, a.lat], s, {heading: finite(a.track) ? a.track : null, speed: finite(a.gs) ? a.gs * 1.852 : null, altitude: finite(a.alt_geom) ? a.alt_geom * 0.3048 : finite(a.alt_baro) ? a.alt_baro * 0.3048 : null, aircraftType: text(a.t), updatedAt: new Date(timestamp - a.seen_pos * 1000).toISOString()}));
}
export function cleanPerimeterGeometry(geometry) {
  if (!['Polygon', 'MultiPolygon'].includes(geometry?.type)) return null;
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  if (!Array.isArray(polygons) || polygons.length > 100) return null;
  let count = 0;
  for (const polygon of polygons) {
    if (!Array.isArray(polygon) || !polygon.length || polygon.length > 100) return null;
    for (const ring of polygon) {
      if (!Array.isArray(ring) || ring.length < 4) return null;
      if (ring[0]?.[0] !== ring.at(-1)?.[0] || ring[0]?.[1] !== ring.at(-1)?.[1]) return null;
      for (const p of ring) { if (!point(p) || ++count > 50000) return null; }
    }
  }
  return {type: geometry.type, coordinates: geometry.coordinates};
}
export function parsePerimeters(data, s = source('firePerimeters')) {
  if (!Array.isArray(data?.features)) throw new Error('Invalid fire perimeter response');
  const features = [], items = [];
  for (const f of data.features.slice(0, 50)) {
    const g = cleanPerimeterGeometry(f.geometry); if (!g) continue;
    const p = f.properties || {}, name = text(p.poly_IncidentName || p.IncidentName || p.incidentname) || 'Published fire perimeter', id = text(p.poly_IRWINID || p.IRWINID || p.OBJECTID || items.length), ring = (g.type === 'Polygon' ? g.coordinates : g.coordinates[0])[0];
    const centre = ring.slice(0, -1).reduce((a, p) => [a[0] + p[0] / (ring.length - 1), a[1] + p[1] / (ring.length - 1)], [0, 0]);
    const record = item('firePerimeters', id, name, centre, s, {updatedAt: date(p.poly_DateCurrent || p.DateCurrent || p.ModifiedOnDateTime), acres: finite(p.poly_GISAcres) ? p.poly_GISAcres : finite(p.GISAcres) ? p.GISAcres : null});
    items.push(record); features.push({type: 'Feature', geometry: g, properties: {id: record.id, title: record.title, category: 'firePerimeters'}});
  }
  return {items, features: fc(features)};
}

async function load(kind, area) {
  const s = source(kind);
  try {
    let items;
    if (kind === 'news') {
      const u = new URL('https://api.gdeltproject.org/api/v2/geo/geo');
      u.search = new URLSearchParams({query: '(flood OR earthquake OR wildfire OR transport OR protest)', mode: 'pointdata', format: 'geojson', timespan: '24h'});
      items = parseNews(await request(u), area, s);
    } else if (kind === 'wildlife') {
      const u = new URL('https://api.inaturalist.org/v1/observations'); u.search = new URLSearchParams({lat: String(area.lat), lng: String(area.lon), radius: String(area.radius), per_page: '100', geo: 'true', quality_grade: 'research', order_by: 'observed_on', order: 'desc'});
      items = parseWildlife(await request(u), area, s);
    } else if (kind === 'radio') {
      const u = new URL('https://de1.api.radio-browser.info/json/stations/search');
      u.search = new URLSearchParams({hidebroken: 'true', has_geo_info: 'true', limit: '2000', order: 'clickcount', reverse: 'true'});
      items = parseRadio(await request(u, false, 7000000), area, s);
      s.note += ' Directory is limited to the 2,000 most-clicked geolocated stations; an empty view does not establish no stations nearby.';
    } else if (kind === 'militaryFlights') {
      const radiusNm = Math.ceil(Math.max(100, area.radius) / 1.852);
      items = parseMilitaryAircraft(await request(`https://api.adsb.lol/v2/point/${area.lat.toFixed(4)}/${area.lon.toFixed(4)}/${radiusNm}`), area, s);
    } else if (kind === 'firePerimeters') {
      const u = new URL('https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Interagency_Perimeters_Current/FeatureServer/0/query');
      u.search = new URLSearchParams({where: '1=1', geometry: bounds(area).join(','), geometryType: 'esriGeometryEnvelope', inSR: '4326', outSR: '4326', spatialRel: 'esriSpatialRelIntersects', outFields: '*', resultRecordCount: '50', f: 'geojson'});
      const parsed = parsePerimeters(await request(u), s);
      return {...parsed, source: {...s, count: parsed.items.length}};
    } else if (kind === 'airquality') {
      const u = new URL('https://air-quality-api.open-meteo.com/v1/air-quality');
      u.search = new URLSearchParams({latitude: String(area.lat), longitude: String(area.lon), current: 'european_aqi,us_aqi,pm2_5,pm10,ozone', timezone: 'UTC'});
      const data = await request(u), c = data.current;
      if (!c || ![c.european_aqi, c.us_aqi, c.pm2_5, c.pm10, c.ozone].some(finite)) throw new Error('No current model fields supplied');
      const values = Object.fromEntries(['european_aqi', 'us_aqi', 'pm2_5', 'pm10', 'ozone'].filter(k => finite(c[k])).map(k => [k, c[k]]));
      items = [item(kind, 'model-centre', `Air quality${finite(c.european_aqi) ? ` · European AQI ${c.european_aqi}` : ''}`, [area.lon, area.lat], s, {values, updatedAt: date(c.time?.endsWith('Z') ? c.time : `${c.time}Z`), description: `${Object.entries(values).map(([k, v]) => `${k}: ${v}${c && data.current_units?.[k] ? ` ${text(data.current_units[k])}` : ''}`).join(' · ')}. ${s.note}`})];
    } else if (kind === 'clouds') {
      const check=await fetch('https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_CorrectedReflectance_TrueColor/default/'+new Date(Date.now()-86400000).toISOString().slice(0,10)+'/GoogleMapsCompatible_Level9/0/0/0.jpg',{method:'HEAD',signal:AbortSignal.timeout(9000)});if(!check.ok)throw new Error('Observed satellite imagery is unavailable');
      const day = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      return {items: [], tiles: [`https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_CorrectedReflectance_TrueColor/default/${day}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`], tileSize: 256, maxzoom: 9, observedDate: day, source: {...s, count: 1, updatedAt: null}};
    } else {
      return {items: [], source: {...s, status: 'needs-key', updatedAt: null}};
    }
    return {items, source: {...s, count: items.length}};
  } catch (error) {
    return {items: [], source: {...s, status: 'unavailable', note: `${s.note} ${error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'Provider timed out.' : text(error?.message || 'Provider unavailable', 160)}`, updatedAt: null}};
  }
}

export async function getContextLayer(kind, input = {}, env = {}) {
  const {lat, lon, radius = 5} = input;
  if (!kinds.has(kind) || !finite(lat) || !finite(lon) || Math.abs(lat) > 85 || Math.abs(lon) > 180 || !finite(radius) || radius < 1 || radius > 20) throw new RangeError('Choose a valid context layer, map coordinate and radius from 1 to 20 km');
  const key = `${kind}:${lat.toFixed(3)}:${lon.toFixed(3)}:${radius}`;
  if (cache.get(key)?.until > Date.now()) return cache.get(key).value;
  if (pending.has(key)) return pending.get(key);
  const work = load(kind, {lat, lon, radius}).then(value => {
    if (cache.size > 100) cache.delete(cache.keys().next().value);
    cache.set(key, {value, until: Date.now() + (value.source.status === 'unavailable' ? 30000 : kind === 'militaryFlights' ? 30000 : kind === 'clouds' ? 3600000 : 300000)});
    return value;
  }).finally(() => pending.delete(key));
  pending.set(key, work); return work;
}
