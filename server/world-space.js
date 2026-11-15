/** Global public observations. Orbital positions are SGP4 predictions, never telemetry. */
import {twoline2satrec, propagate, gstime, eciToGeodetic} from 'satellite.js';

const cache = new Map(), pending = new Map();
const MAX_BYTES = 4_000_000;
const FEEDS = {
  earthquakes: {name: 'USGS earthquakes', url: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson', homepage: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php', ttl: 60_000, note: 'Worldwide USGS events in the last 24 hours. Coverage and review status vary; magnitudes and locations can be revised.', license: 'USGS public-domain data'},
  satellites: {name: 'CelesTrak / SGP4 orbital predictions', url: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=visual&FORMAT=tle', homepage: 'https://celestrak.org/NORAD/elements/', ttl: 300_000, note: 'CelesTrak visual-group satellites, including ISS when present. Positions and 90-minute ground tracks are computed with SGP4 from published TLEs, not live measured positions. Elements older than 14 days are omitted.', license: 'CelesTrak data terms; satellite.js MIT'},
  launches: {name: 'Launch Library 2', url: 'https://ll.thespacedevs.com/2.3.0/launches/upcoming/?limit=30&mode=normal', homepage: 'https://thespacedevs.com/llapi', ttl: 300_000, note: 'Upcoming worldwide launches at their published launch-pad locations. Scheduled times, vehicles and status may change.', license: 'The Space Devs Launch Library terms'},
  fires: {name: 'NASA EONET active wildfires', url: 'https://eonet.gsfc.nasa.gov/api/v3/events?status=open&category=wildfires&limit=100', homepage: 'https://eonet.gsfc.nasa.gov/', ttl: 300_000, note: 'NASA EONET open wildfire events and their latest supplied event locations. This is an event catalogue, not the FIRMS active-fire pixel feed or a fire perimeter.', license: 'NASA EONET open data; original event sources retain their terms'},
  cyclones: {name: 'NOAA NHC / CPHC cyclone advisories', url: 'https://www.nhc.noaa.gov/CurrentStorms.json', homepage: 'https://www.nhc.noaa.gov/', ttl: 300_000, note: 'Current NHC and CPHC storms in the Atlantic and eastern/central Pacific. Other basins are outside this feed; these points are advisory positions, not forecast tracks.', license: 'NOAA public-domain products'}
};
const text = (value, length = 700) => String(value ?? '').replace(/[\u0000-\u001f<>]/g, ' ').trim().slice(0, length);
const finite = value => typeof value === 'number' && Number.isFinite(value);
const point = (lat, lon) => finite(lat) && finite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
const numeric = value => typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
function date(value) { const n = typeof value === 'number' ? value : Date.parse(value); return Number.isFinite(n) ? new Date(n).toISOString() : null; }
function url(value, fallback) { try { const u = new URL(value); return u.protocol === 'https:' ? u.href : fallback; } catch { return fallback; } }
function fc(features = []) { return {type: 'FeatureCollection', features}; }
function toFeature(item) { return {type: 'Feature', id: item.id, properties: {id: item.id, title: item.title, kind: item.category}, geometry: {type: 'Point', coordinates: [item.lon, item.lat]}}; }

async function request(feed) {
  const c = new AbortController(), timeout = setTimeout(() => c.abort(), 8500);
  try {
    const response = await fetch(feed.url, {headers: {Accept: feed === FEEDS.satellites ? 'text/plain' : 'application/json', 'User-Agent': 'GodEyeBerlin/3.0 public-data viewer'}, signal: c.signal});
    if (!response.ok) throw new Error(`Provider returned HTTP ${response.status}`);
    const length = Number(response.headers.get('Content-Length'));
    if (length > MAX_BYTES) throw new Error('Provider response exceeds size limit');
    const body = await response.text();
    if (body.length > MAX_BYTES) throw new Error('Provider response exceeds size limit');
    return feed === FEEDS.satellites ? body : JSON.parse(body);
  } finally { clearTimeout(timeout); }
}
async function load(kind) {
  const previous = cache.get(kind);
  if (previous?.until > Date.now()) return previous;
  if (pending.has(kind)) return pending.get(kind);
  const task = request(FEEDS[kind]).then(data => {
    const result = {data, fetchedAt: new Date().toISOString(), until: Date.now() + FEEDS[kind].ttl};
    cache.set(kind, result); return result;
  }).finally(() => pending.delete(kind));
  pending.set(kind, task); return task;
}

export function parseEarthquakes(data) {
  if (!Array.isArray(data?.features)) throw new Error('Invalid USGS earthquake response');
  return data.features.slice(0, 2000).flatMap(f => {
    const [lon, lat, depth] = f?.geometry?.coordinates || [], p = f?.properties || {};
    if (f?.geometry?.type !== 'Point' || !point(lat, lon) || !date(p.time)) return [];
    return [{id: `usgs-${text(f.id || p.code, 80)}`, title: text(p.title || p.place || 'USGS earthquake'), lat, lon, category: 'earthquakes', source: FEEDS.earthquakes.name, sourceUrl: url(p.url, FEEDS.earthquakes.homepage), status: 'published', description: `${finite(p.mag) ? `Magnitude ${p.mag}. ` : 'Magnitude not supplied. '}${text(p.place)}${finite(depth) ? ` Depth ${depth.toFixed(1)} km.` : ''} Review status: ${text(p.status || 'not supplied')}.`, updatedAt: date(p.updated) || date(p.time), occurredAt: date(p.time), magnitude: finite(p.mag) ? p.mag : null, depthKm: finite(depth) ? depth : null}];
  });
}

export function parseLaunches(data) {
  if (!Array.isArray(data?.results)) throw new Error('Invalid Launch Library response');
  return data.results.slice(0, 30).flatMap(launch => {
    const pad = launch.pad || {}, lat = numeric(pad.latitude), lon = numeric(pad.longitude);
    if (!point(lat, lon)) return [];
    const scheduledAt = date(launch.net), provider = launch.launch_service_provider?.name, rocket = launch.rocket?.configuration?.full_name;
    return [{id: `launch-${text(launch.id, 100)}`, title: text(launch.name || 'Upcoming space launch'), lat, lon, category: 'launches', source: FEEDS.launches.name, sourceUrl: url(launch.url, FEEDS.launches.homepage), status: 'published', scheduledAt, startsAt: scheduledAt, updatedAt: date(launch.last_updated), description: text([launch.status?.name, scheduledAt ? `Scheduled ${scheduledAt}` : 'Time not supplied', provider, rocket, pad.name, launch.mission?.description].filter(Boolean).join(' · ')), vehicle: text(rocket, 160), launchStatus: text(launch.status?.name, 100), pad: text(pad.name, 160)}];
  });
}

export function parseFires(data) {
  if (!Array.isArray(data?.events)) throw new Error('Invalid EONET response');
  return data.events.slice(0, 100).flatMap(event => {
    if (!event.categories?.some(c => c?.id === 'wildfires') || event.closed) return [];
    const geometries = (event.geometry || []).filter(g => g?.type === 'Point' && point(g.coordinates?.[1], g.coordinates?.[0]) && date(g.date)).sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
    const latest = geometries[0]; if (!latest) return [];
    const original = event.sources?.find(s => typeof s?.url === 'string');
    return [{id: `eonet-${text(event.id, 100)}`, title: text(event.title || 'Active wildfire event'), lat: latest.coordinates[1], lon: latest.coordinates[0], category: 'fires', source: FEEDS.fires.name, sourceUrl: url(original?.url, FEEDS.fires.homepage), status: 'published', description: text(`${event.description || ''} Latest published point for an open EONET wildfire event. The point does not show the fire extent or a satellite fire-pixel detection.`), updatedAt: date(latest.date), magnitude: finite(latest.magnitudeValue) ? latest.magnitudeValue : null, magnitudeUnit: text(latest.magnitudeUnit, 80)}];
  });
}

export function parseCyclones(data) {
  if (!Array.isArray(data?.activeStorms)) throw new Error('Invalid NOAA cyclone response');
  return data.activeStorms.slice(0, 50).flatMap(storm => {
    const lat = numeric(storm.latitude), lon = numeric(storm.longitude);
    if (!point(lat, lon)) return [];
    const issuedAt = date(storm.lastUpdate || storm.lastUpdateTime || storm.advisoryTime);
    return [{id: `nhc-${text(storm.id || storm.binNumber, 100)}`, title: text(`${storm.classification || 'Tropical cyclone'} ${storm.name || storm.id || ''}`), lat, lon, category: 'cyclones', source: FEEDS.cyclones.name, sourceUrl: url(storm.publicAdvisory?.url || storm.forecastAdvisory?.url, FEEDS.cyclones.homepage), status: 'published', updatedAt: issuedAt, windKnots: finite(numeric(storm.intensity)) ? numeric(storm.intensity) : null, heading: finite(numeric(storm.movementDir)) ? numeric(storm.movementDir) : null, description: text([`NOAA advisory position in the NHC/CPHC coverage area.`, storm.intensity ? `Maximum wind ${text(storm.intensity)} knots.` : '', storm.movementDir ? `Movement heading ${text(storm.movementDir)}° at ${text(storm.movementSpeed)} knots.` : '', issuedAt ? `Issued ${issuedAt}.` : 'Advisory timestamp not supplied.'].join(' '))}];
  });
}

function orbitalPosition(record, at) {
  const result = propagate(record, at);
  if (!result?.position || !result.velocity || record.error) return null;
  const g = eciToGeodetic(result.position, gstime(at));
  const lat = g.latitude * 180 / Math.PI, lon = g.longitude * 180 / Math.PI;
  if (!point(lat, lon) || !finite(g.height) || g.height < 0) return null;
  return {lat, lon, altitude: g.height * 1000, speed: Math.hypot(result.velocity.x, result.velocity.y, result.velocity.z) * 3600};
}
export function parseSatelliteTles(body, at = new Date()) {
  if (typeof body !== 'string' || body.length > MAX_BYTES) throw new Error('Invalid CelesTrak TLE response');
  const lines = body.split(/\r?\n/).map(line => line.trim()).filter(Boolean), items = [], features = [];
  for (let i = 0; i < lines.length - 1 && items.length < 200; i++) {
    if (!/^1 [A-Z\d]/.test(lines[i]) || !/^2 [A-Z\d]/.test(lines[i + 1])) continue;
    const line1 = lines[i], line2 = lines[i + 1], name = i > 0 && !/^[12] /.test(lines[i - 1]) ? lines[i - 1].replace(/^0 /, '') : `Satellite ${line1.slice(2, 7).trim()}`;
    try {
      const record = twoline2satrec(line1, line2), epoch = new Date((record.jdsatepoch - 2440587.5) * 86400000);
      if (!Number.isFinite(epoch.getTime()) || Math.abs(at.getTime() - epoch.getTime()) > 14 * 86400000) continue;
      const p = orbitalPosition(record, at); if (!p) continue;
      const id = `satellite-${text(record.satnum, 20)}`, periodMinutes = 2 * Math.PI / record.no;
      const item = {id, title: text(name, 160), ...p, category: 'satellites', source: FEEDS.satellites.name, sourceUrl: 'https://celestrak.org/satcat/records.php?CATNR=' + encodeURIComponent(record.satnum), status: 'reference', updatedAt: at.toISOString(), epoch: epoch.toISOString(), periodMinutes, noradId: text(record.satnum, 20), tle1: line1, tle2: line2, description: `SGP4 predicted position at ${at.toISOString()}. TLE epoch ${epoch.toISOString()}. Height ${(p.altitude / 1000).toFixed(0)} km; orbital period ${periodMinutes.toFixed(1)} minutes. The ground track is a 90-minute prediction, not observed flight history.`};
      items.push(item);
      // Split at the antimeridian rather than drawing a line across the map.
      const segments = [[]];
      for (let minute = 0; minute <= 90; minute += 5) {
        const next = orbitalPosition(record, new Date(at.getTime() + minute * 60000));
        if (!next) continue;
        const segment = segments.at(-1), previous = segment.at(-1);
        if (previous && Math.abs(next.lon - previous[0]) > 180) segments.push([]);
        segments.at(-1).push([next.lon, next.lat]);
      }
      for (const [index, segment] of segments.entries()) if (segment.length >= 2) features.push({type: 'Feature', properties: {id, title: item.title, kind: 'satellites', geometryRole: 'predicted-orbit', prediction: true, segment: index}, geometry: {type: 'LineString', coordinates: segment}});
    } catch { /* A malformed orbital element never becomes a fabricated contact. */ }
    i++;
  }
  if (!items.length) throw new Error('No valid recent satellite elements were supplied');
  return {items, features: fc(features)};
}

export async function getSpaceLayer(kind, input = {}, env = {}) {
  const {lat, lon, radius = 5} = input;
  if (!Object.hasOwn(FEEDS, kind) || !point(lat, lon) || !finite(radius) || radius < 1 || radius > 20000) throw new RangeError('Choose a supported space layer, valid coordinates and radius');
  const feed = FEEDS[kind], checkedAt = new Date().toISOString();
  const source = {id: kind, name: feed.name, url: feed.homepage, license: feed.license, status: 'connected', note: feed.note, updatedAt: checkedAt, count: 0, coverage: 'global'};
  try {
    const loaded = await load(kind);
    const parsed = kind === 'satellites' ? parseSatelliteTles(loaded.data) : {items: ({earthquakes: parseEarthquakes, launches: parseLaunches, fires: parseFires, cyclones: parseCyclones})[kind](loaded.data)};
    const items = parsed.items;
    const latest = items.map(item => item.updatedAt).filter(Boolean).sort().at(-1);
    return {items, features: parsed.features || fc(items.map(toFeature)), fetchedAt: loaded.fetchedAt, source: {...source, count: items.length, updatedAt: latest || loaded.fetchedAt}};
  } catch (error) {
    return {items: [], features: fc(), fetchedAt: checkedAt, source: {...source, status: 'unavailable', note: `${feed.note} ${error?.name === 'AbortError' ? 'Provider request timed out.' : text(error?.message || 'Provider unavailable', 180)}`}};
  }
}
