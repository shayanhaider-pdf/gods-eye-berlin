/**
 * Illustrative city motion. Positions are generated along mapped geometry and are
 * never observations, dispatch locations, density estimates or timetable predictions.
 * The owning UI must retain a visible SIMULATION label whenever this is enabled.
 */
const RAD = Math.PI / 180;
const METRES = 111320;
const MAX_ACTORS = 240;
const EMPTY = { type: 'FeatureCollection', features: [] };

export function seededRandom(seed = 1) {
  let a = typeof seed === 'number' ? seed >>> 0 : hash(String(seed));
  return () => {
    a += 0x6D2B79F5;
    let n = a;
    n = Math.imul(n ^ n >>> 15, n | 1);
    n ^= n + Math.imul(n ^ n >>> 7, n | 61);
    return ((n ^ n >>> 14) >>> 0) / 4294967296;
  };
}

function hash(value) {
  let h = 2166136261;
  for (const c of value) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

export function metresBetween(a, b) {
  const x = (b[0] - a[0]) * Math.cos((a[1] + b[1]) * .5 * RAD) * METRES;
  const y = (b[1] - a[1]) * METRES;
  return Math.hypot(x, y);
}

/** Precompute cumulative distances once; duplicate vertices cannot poison headings. */
export function preparePath(coordinates, properties = {}) {
  if (!Array.isArray(coordinates)) return null;
  const points = [];
  for (const coordinate of coordinates) {
    if (!Array.isArray(coordinate) || !Number.isFinite(coordinate[0]) || !Number.isFinite(coordinate[1]) || Math.abs(coordinate[0]) > 180 || Math.abs(coordinate[1]) > 85) continue;
    if (!points.length || metresBetween(points[points.length - 1], coordinate) > .05) points.push([coordinate[0], coordinate[1]]);
  }
  if (points.length < 2) return null;
  const cumulative = [0];
  for (let i = 1; i < points.length; i++) cumulative.push(cumulative[i - 1] + metresBetween(points[i - 1], points[i]));
  const length = cumulative[cumulative.length - 1];
  if (!(length > 3)) return null;
  return { points, cumulative, length, properties, dwells: [] };
}

/** Distance is reflected at endpoints, so actors never teleport across a route gap. */
export function positionOnPath(path, distance, offsetMetres = 0) {
  if (!path?.points?.length || !(path.length > 0) || !Number.isFinite(distance)) return null;
  const circuit = path.length * 2;
  const cycle = ((distance % circuit) + circuit) % circuit;
  const reverse = cycle > path.length;
  const at = reverse ? circuit - cycle : cycle;
  let lo = 0, hi = path.cumulative.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (path.cumulative[mid] <= at) lo = mid; else hi = mid;
  }
  const a = path.points[lo], b = path.points[hi];
  const fraction = Math.min(1, Math.max(0, (at - path.cumulative[lo]) / (path.cumulative[hi] - path.cumulative[lo])));
  const lng = a[0] + (b[0] - a[0]) * fraction;
  const lat = a[1] + (b[1] - a[1]) * fraction;
  const dx = (b[0] - a[0]) * Math.cos(lat * RAD), dy = b[1] - a[1];
  const bearing = Math.atan2(dy, dx) + (reverse ? Math.PI : 0);
  return {
    coordinates: [lng - Math.sin(bearing) * offsetMetres / (METRES * Math.cos(lat * RAD)), lat + Math.cos(bearing) * offsetMetres / METRES],
    bearing, at, reverse,
  };
}

function featurePaths(collection) {
  const output = [];
  for (const feature of collection?.features || []) {
    const geometry = feature?.geometry;
    const parts = geometry?.type === 'LineString' ? [geometry.coordinates] : geometry?.type === 'MultiLineString' ? geometry.coordinates : [];
    for (let i = 0; i < parts.length; i++) {
      const path = preparePath(parts[i], { ...feature.properties, part: i });
      if (path) output.push(path);
    }
  }
  return output;
}

function routeMode(path) {
  const raw = String(path.properties.mode || path.properties.route_type || '').toLowerCase();
  if (raw === 'bus' || raw === '3' || raw === '700') return 'buses';
  if (raw === 'tram' || raw === '0' || raw === '900') return 'trams';
  if (['ubahn', 'sbahn', 'rail', 'subway', 'train', '1', '2', '100', '109', '400'].includes(raw)) return 'trains';
  return null;
}

function nearestPathDistance(path, point) {
  let best = Infinity, bestAt = 0;
  const cos = Math.cos(point[1] * RAD);
  for (let i = 1; i < path.points.length; i++) {
    const a = path.points[i - 1], b = path.points[i];
    const ax = (a[0] - point[0]) * cos * METRES, ay = (a[1] - point[1]) * METRES;
    const bx = (b[0] - point[0]) * cos * METRES, by = (b[1] - point[1]) * METRES;
    const dx = bx - ax, dy = by - ay, square = dx * dx + dy * dy;
    const t = square ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / square)) : 0;
    const distance = Math.hypot(ax + dx * t, ay + dy * t);
    if (distance < best) { best = distance; bestAt = path.cumulative[i - 1] + (path.cumulative[i] - path.cumulative[i - 1]) * t; }
  }
  return { distance: best, at: bestAt };
}

export function classifyActivity(event) {
  if (!event || event.status === 'reference' || event.status === 'upcoming' || event.category === 'places' || event.category === 'transit') return null;
  const now = Date.now();
  if (event.startsAt && Date.parse(event.startsAt) > now || event.expiresAt && Date.parse(event.expiresAt) < now) return null;
  const words = `${event.subtype || ''} ${event.title || ''} ${event.description || ''}`;
  if (/construction|roadworks|baustell|arbeitsstell|excavat|grünarbeiten/i.test(words)) return 'construction';
  if (/film|dreh|shoot/i.test(words)) return 'filming';
  if (/veranstaltung|festival|concert|konzert|street event|market|markt/i.test(words)) return 'gathering';
  if (/umz[uü]g|moving|halteverbot/i.test(words)) return 'moving';
  if (event.category === 'alerts' || event.category === 'environment') return 'notice';
  if (event.category === 'traffic') return 'traffic';
  return null;
}

/** Pure actor integrator used by the renderer and tests. */
export function advanceActor(actor, seconds, multiplier = 4) {
  if (!(seconds > 0) || !Number.isFinite(seconds) || !actor.path || actor.paused) return actor;
  const dt = Math.min(seconds, .1) * Math.max(.25, Math.min(12, multiplier));
  if (actor.wait > 0) { actor.wait = Math.max(0, actor.wait - dt); return actor; }
  const old = positionOnPath(actor.path, actor.distance);
  const nextDistance = actor.distance + actor.speed * dt;
  const next = positionOnPath(actor.path, nextDistance);
  if (old && next && actor.kind !== 'people' && actor.kind !== 'cars') {
    const stop = actor.path.dwells.find(at => old.reverse === next.reverse && (old.reverse ? at <= old.at && at >= next.at : at >= old.at && at <= next.at) && Math.abs(at - (actor.lastStop ?? -1e6)) > 2);
    if (stop !== undefined) {
      actor.lastStop = stop;
      actor.wait = actor.kind === 'trains' ? 15 : 8;
    }
  }
  actor.distance = nextDistance;
  return actor;
}

export class CitySimulation {
  constructor(map, { onStats = () => {} } = {}) {
    this.map = map;
    this.onStats = onStats;
    this.visibility = { people: true, cars: true, buses: true, trains: true, trams: true, activityCrews: true, enabled: true };
    this.timeScale = 4;
    this.paused = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches || false;
    this.destroyed = false;
    this.actors = [];
    this.activity = [];
    this.routes = [];
    this.roadPaths = [];
    this.stations = [];
    this.time = 0;
    this.lastTick = 0;
    this.lastStats = 0;
    this.frame = null;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'city-simulation-canvas';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.canvas.setAttribute('data-simulation', 'illustrative');
    map.getCanvasContainer().appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d', { alpha: true });
    this._resize = () => { this.resize(); this.draw(); };
    this._move = () => { if (this.paused || !this.visibility.enabled) this.draw(); };
    this._idle = () => { clearTimeout(this.roadTimer); this.roadTimer = setTimeout(() => this.sampleRoads(), 250); };
    this._visibility = () => { this.lastTick = 0; if (document.hidden) this.stop(); else this.start(); };
    map.on('resize', this._resize);
    map.on('move', this._move);
    map.on('idle', this._idle);
    document.addEventListener('visibilitychange', this._visibility);
    this.resize();
    this.sampleRoads();
    this.start();
  }

  resize() {
    const rect = this.map.getCanvas().getBoundingClientRect();
    this.width = Math.max(1, rect.width);
    this.height = Math.max(1, rect.height);
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    this.canvas.width = Math.round(this.width * dpr);
    this.canvas.height = Math.round(this.height * dpr);
    this.canvas.style.width = this.width + 'px';
    this.canvas.style.height = this.height + 'px';
    this.ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  setNetwork({ routes = EMPTY, stations = EMPTY, roads = EMPTY } = {}) {
    this.routes = featurePaths(routes).filter(path => routeMode(path));
    this.stations = (stations.features || []).filter(feature => feature.geometry?.type === 'Point').slice(0, 500);
    if (roads.features?.length) this.roadPaths = featurePaths(roads);
    this.rebuildActors();
    this.sampleRoads();
  }

  setActivities(events = []) {
    const unique = new Set();
    this.activity = events.flatMap(event => {
      if (!Number.isFinite(event.lat) || !Number.isFinite(event.lon)) return [];
      const kind = classifyActivity(event);
      const key = `${Number(event.lon).toFixed(4)}:${Number(event.lat).toFixed(4)}:${kind}`;
      if (!kind || unique.has(key)) return [];
      unique.add(key);
      return [{ id: event.id, coordinates: [event.lon, event.lat], kind, seed: hash(String(event.id)), title: event.title }];
    }).slice(0, 36);
    this.draw(); this.report();
  }

  setVisibility(values = {}) {
    for (const key of Object.keys(this.visibility)) if (typeof values[key] === 'boolean') this.visibility[key] = values[key];
    this.canvas.hidden = !this.visibility.enabled;
    if (this.visibility.enabled) this.start(); else this.stop();
    this.draw(); this.report();
  }

  setPaused(value) {
    const changed = this.paused !== !!value;
    this.paused = !!value;
    if (!changed) return;
    this.lastTick = 0;
    if (this.paused) this.stop(); else this.start();
    this.draw(); this.report();
  }

  setSpeed(multiplier) {
    if (Number.isFinite(multiplier)) this.timeScale = Math.max(.25, Math.min(12, multiplier));
    this.report();
  }

  sampleRoads() {
    if (this.destroyed || !this.map.isStyleLoaded?.()) return;
    try {
      const ids = (this.map.getStyle()?.layers || []).filter(layer => layer.type === 'line' && /road|street|path|pedestrian/i.test(`${layer['source-layer']} ${layer.id}`) && !/rail|boundary|tunnel|bridge|simulation|route/i.test(layer.id)).map(layer => layer.id);
      if (!ids.length) return;
      const features = this.map.queryRenderedFeatures(undefined, { layers: ids });
      const seen = new Set(), roads = [];
      for (const feature of features) {
        const p = feature.properties || {};
        const detail = `${p.kind || ''} ${p.kind_detail || ''} ${p.class || ''} ${p.subclass || ''}`;
        if (/rail|motorway|freeway|trunk|ferry/i.test(detail)) continue;
        const geometry = feature.geometry;
        const lines = geometry?.type === 'LineString' ? [geometry.coordinates] : geometry?.type === 'MultiLineString' ? geometry.coordinates : [];
        for (const line of lines) {
          if (!line?.length) continue;
          const key = `${line[0].map(x => x.toFixed(5)).join(',')}:${line[line.length - 1].map(x => x.toFixed(5)).join(',')}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const path = preparePath(line, { ...p, pedestrian: /path|foot|pedestrian|steps|cycle/i.test(detail) });
          if (path?.length > 25 && path.length < 12000) roads.push(path);
        }
      }
      if (roads.length) {
        const rand = seededRandom('street-order');
        this.roadPaths = roads.sort(() => rand() - .5).slice(0, 130);
        this.rebuildActors();
      }
    } catch { /* Tile changes may make a rendered road layer unavailable temporarily. */ }
  }

  rebuildActors() {
    const random = seededRandom('around-me-city-simulation');
    const next = [];
    const centre = this.map.getCenter();
    const byMode = { trains: [], trams: [], buses: [] };
    for (const path of this.routes) {
      const kind = routeMode(path);
      if (kind) byMode[kind].push(path);
    }
    // Prioritise real route segments nearest the view, not an arbitrary dataset order.
    const nearest = path => Math.min(...path.points.filter((_, i) => i % Math.max(1, Math.floor(path.points.length / 12)) === 0).map(point => metresBetween(point, [centre.lng, centre.lat])));
    const unique = paths => {
      const seen = new Set();
      return paths.sort((a, b) => nearest(a) - nearest(b)).filter(path => {
        const key = path.properties.name ? `${path.properties.mode}:${path.properties.name}` : path.properties.id || String(path.points[0]);
        if (seen.has(key)) return false; seen.add(key); return true;
      });
    };
    const make = (kind, path, i) => { const closest = nearestPathDistance(path, [centre.lng, centre.lat]); const span = Math.min(path.length, Math.max(700, Math.min(5000, 5000 * 2 ** (13 - this.map.getZoom())))); const initialAt = Math.max(0, Math.min(path.length, closest.at + (random() - .5) * span)); return ({ id: `${kind}:${path.properties.id || path.points[0]}:${i}`, kind, path, distance: random() > .5 ? initialAt : path.length * 2 - initialAt, speed: kind === 'people' ? 1.15 + random() * .55 : kind === 'cars' ? 5 + random() * 6 : kind === 'buses' ? 5 + random() * 3 : kind === 'trams' ? 6 + random() * 4 : 9 + random() * 7, phase: random() * Math.PI * 2, wait: 0, lastStop: null, offset: kind === 'people' ? 4 + random() * 2 : kind === 'cars' ? 1.8 : 0, color: path.properties.color || null }); };
    for (const kind of ['trains', 'trams', 'buses']) {
      const paths = unique(byMode[kind]).slice(0, kind === 'trains' ? 26 : kind === 'trams' ? 18 : 28);
      for (const [i, path] of paths.entries()) {
        if (!path.dwells.length && this.stations.length) {
          // Station locations are reference geometry; dwell remains illustrative.
          const points = path.points;
          const minX = Math.min(...points.map(p => p[0])), maxX = Math.max(...points.map(p => p[0]));
          const minY = Math.min(...points.map(p => p[1])), maxY = Math.max(...points.map(p => p[1]));
          const ids = path.properties.stopIds;
          const candidates = this.stations.filter(station => {
            const [x, y] = station.geometry.coordinates;
            const stationLines = station.properties?.lines; const stationModes = station.properties?.modes; return x >= minX - .001 && x <= maxX + .001 && y >= minY - .001 && y <= maxY + .001 && (!Array.isArray(ids) || ids.includes(station.properties?.id)) && (!Array.isArray(stationLines) || !path.properties.name || stationLines.includes(path.properties.name)) && (!Array.isArray(stationModes) || !path.properties.mode || stationModes.includes(path.properties.mode));
          }).slice(0, 100);
          path.dwells = [...new Set(candidates.map(station => nearestPathDistance(path, station.geometry.coordinates)).filter(p => p.distance < 70).map(p => Math.round(p.at)))].sort((a, b) => a - b);
        }
        next.push(make(kind, path, i));
        if (kind === 'trains' && path.length > 2500) next.push(make(kind, path, i + 100));
      }
    }
    let carPaths = this.roadPaths.filter(path => !path.properties.pedestrian);
    if (!carPaths.length) carPaths = byMode.buses;
    const walkingPaths = this.roadPaths.length ? this.roadPaths : [];
    for (let i = 0; i < Math.min(88, carPaths.length * 2); i++) next.push(make('cars', carPaths[i % carPaths.length], i));
    for (let i = 0; i < Math.min(75, walkingPaths.length * 2); i++) next.push(make('people', walkingPaths[i % walkingPaths.length], i));
    const oldActors = new Map(this.actors.map(actor => [actor.id, actor]));
    this.actors = next.slice(0, MAX_ACTORS).map(actor => {
      const old = oldActors.get(actor.id);
      return old && old.path.points[0][0] === actor.path.points[0][0] && Math.abs(old.path.length - actor.path.length) < 1 ? { ...actor, distance: old.distance, wait: old.wait, lastStop: old.lastStop } : actor;
    });
    this.draw(); this.report(); this.start();
  }

  start() {
    if (this.destroyed || this.frame || this.paused || !this.visibility.enabled || document.hidden) return;
    this.frame = requestAnimationFrame(time => this.tick(time));
  }

  stop() {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = null;
    this.lastTick = 0;
  }

  tick(time) {
    this.frame = null;
    if (this.destroyed || this.paused || !this.visibility.enabled || document.hidden) return;
    if (!this.lastTick || time - this.lastTick >= 32) {
      const seconds = this.lastTick ? Math.min(.1, (time - this.lastTick) / 1000) : 0;
      this.lastTick = time;
      this.time += seconds;
      for (const actor of this.actors) if (this.visibility[actor.kind]) advanceActor(actor, seconds, this.timeScale);
      this.draw();
      if (time - this.lastStats > 1500) { this.lastStats = time; this.report(); }
    }
    this.start();
  }

  report() {
    const stats = { people: 0, cars: 0, buses: 0, trains: 0, trams: 0, activityCrews: this.visibility.activityCrews && this.visibility.enabled ? this.activity.length : 0, total: 0, visible: this.visibleActorCount || 0, paused: this.paused || !!document.hidden, enabled: this.visibility.enabled, simulation: true, timeScale: this.timeScale };
    for (const actor of this.actors) if (this.visibility.enabled && this.visibility[actor.kind]) { stats[actor.kind]++; stats.total++; }
    stats.total += stats.activityCrews;
    try { this.onStats(stats); } catch { /* A display callback must never stop motion. */ }
  }

  draw() {
    const ctx = this.ctx;
    if (!ctx || this.destroyed) return;
    ctx.clearRect(0, 0, this.width, this.height);
    this.visibleActorCount = 0;
    if (!this.visibility.enabled) return;
    const zoom = this.map.getZoom();
    const scale = Math.min(1.65, Math.max(.7, .65 + (zoom - 12) * .13));
    for (const actor of this.actors) {
      if (!this.visibility[actor.kind] || actor.kind === 'people' && zoom < 12) continue;
      const position = positionOnPath(actor.path, actor.distance, actor.offset);
      const ahead = positionOnPath(actor.path, actor.distance + 5, actor.offset);
      if (!position || !ahead) continue;
      const point = this.map.project(position.coordinates), next = this.map.project(ahead.coordinates);
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < -25 || point.y < -25 || point.x > this.width + 25 || point.y > this.height + 25) continue;
      this.visibleActorCount++;
      const angle = Math.atan2(next.y - point.y, next.x - point.x) + Math.PI / 2;
      ctx.save(); ctx.translate(point.x, point.y); ctx.rotate(angle); ctx.scale(scale, scale);
      if (actor.kind === 'people') this.drawPerson(ctx, this.time * 7 + actor.phase, '#ceddde', .9);
      else this.drawVehicle(ctx, actor);
      ctx.restore();
    }
    if (this.visibility.activityCrews) for (const activity of this.activity) {
      const point = this.map.project(activity.coordinates);
      if (point.x < -40 || point.y < -40 || point.x > this.width + 40 || point.y > this.height + 40) continue;
      ctx.save(); ctx.translate(point.x, point.y); ctx.scale(scale, scale); this.drawActivity(ctx, activity, this.time); ctx.restore();
    }
  }

  drawPerson(ctx, phase, color = '#d9e2e2', opacity = 1) {
    const step = Math.sin(phase) * 1.6;
    ctx.globalAlpha = opacity;
    ctx.strokeStyle = '#536e7d'; ctx.lineWidth = 1.1; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-.9, 1); ctx.lineTo(-1.3, 3 + step); ctx.moveTo(.9, 1); ctx.lineTo(1.3, 3 - step); ctx.stroke();
    ctx.fillStyle = color; ctx.fillRect(-1.6, -1.4, 3.2, 3.6);
    ctx.fillStyle = '#e0d8c6'; ctx.beginPath(); ctx.arc(0, -2.2, 1.2, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  }

  drawVehicle(ctx, actor) {
    const bus = actor.kind === 'buses', rail = actor.kind === 'trains', tram = actor.kind === 'trams';
    const color = bus ? '#f2c868' : rail ? String(actor.color || '#91d4c5') : tram ? '#dfaf72' : ['#c6d2d8', '#c9b696', '#7ca5b5'][hash(actor.id) % 3];
    const width = bus || rail || tram ? 5.4 : 3.9;
    const length = rail ? 12 : tram ? 14 : bus ? 10 : 6;
    ctx.shadowColor = '#03090e'; ctx.shadowBlur = 3; ctx.shadowOffsetY = 1;
    if (rail) {
      ctx.fillStyle = '#09161c'; ctx.fillRect(-width / 2, -length / 2, width, length * 2.3);
      for (let i = 0; i < 3; i++) {
        ctx.fillStyle = color; ctx.fillRect(-width / 2, -length / 2 + i * 9, width, 8);
        ctx.fillStyle = '#233943'; ctx.fillRect(-width / 2 + .7, -length / 2 + i * 9 + 1.3, width - 1.4, 1.5);
      }
    } else {
      ctx.fillStyle = '#07111a'; ctx.fillRect(-width / 2 - .7, -length / 2 - .6, width + 1.4, length + 1.2);
      ctx.fillStyle = color; ctx.fillRect(-width / 2, -length / 2, width, length);
      ctx.fillStyle = '#29444f'; ctx.fillRect(-width / 2 + .6, -length / 2 + 1, width - 1.2, bus || tram ? 1.7 : 1.4);
      if (bus || tram) { ctx.fillStyle = '#d3e3dc88'; ctx.fillRect(-width / 2 + .8, -1, width - 1.6, length / 2.4); }
      ctx.fillStyle = '#eed7a7'; ctx.fillRect(-width / 2, -length / 2 - .3, .8, 1); ctx.fillRect(width / 2 - .8, -length / 2 - .3, .8, 1);
      ctx.fillStyle = '#bc7364'; ctx.fillRect(-width / 2, length / 2 - .7, .8, .8); ctx.fillRect(width / 2 - .8, length / 2 - .7, .8, .8);
    }
    ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
  }

  drawActivity(ctx, activity, time) {
    const phase = (activity.seed % 100) / 10, pulse = (Math.sin(time * 2 + phase) + 1) / 2;
    const color = activity.kind === 'notice' ? '#ee8b80' : '#edb775';
    ctx.strokeStyle = color; ctx.globalAlpha = .12 + pulse * .12; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(0, 0, 12 + pulse * 5, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1;
    if (activity.kind === 'construction') {
      // Excavator body, hinged arm and three helmeted workers: a vignette, not a count.
      ctx.save(); ctx.translate(-7, 2);
      ctx.fillStyle = '#14212a'; ctx.fillRect(-5, -3, 11, 7);
      ctx.fillStyle = '#db9b4c'; ctx.fillRect(-4, -4, 8, 6);
      ctx.fillStyle = '#6d8791'; ctx.fillRect(-3, -4, 3, 3);
      const arm = -.5 + Math.sin(time * 1.3 + phase) * .35;
      ctx.rotate(arm); ctx.strokeStyle = '#e7b361'; ctx.lineWidth = 2.2; ctx.beginPath(); ctx.moveTo(2, -1); ctx.lineTo(9, -6); ctx.lineTo(13, -3 + Math.sin(time + phase) * 2); ctx.stroke();
      ctx.fillStyle = '#ba8a53'; ctx.fillRect(11, -3 + Math.sin(time + phase) * 2, 4, 2.8); ctx.restore();
      for (let i = 0; i < 3; i++) {
        const a = i * 2.1 + phase;
        ctx.save(); ctx.translate(Math.cos(a + Math.sin(time * .35 + i) * .3) * 13, Math.sin(a) * 8); ctx.rotate(Math.sin(time * .7 + i) * .4); this.drawPerson(ctx, time * 6 + i, '#e2a855', .95); ctx.fillStyle = '#f4d279'; ctx.beginPath(); ctx.arc(0, -2.5, 1.6, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      }
      this.drawCone(ctx, -14, -8); this.drawCone(ctx, 15, 8);
    } else if (activity.kind === 'filming') {
      ctx.strokeStyle = '#b8c6d1'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-5, 0); ctx.lineTo(-9, 8); ctx.moveTo(-5, 0); ctx.lineTo(0, 8); ctx.stroke();
      ctx.fillStyle = '#bfd0da'; ctx.fillRect(-8, -5, 8, 5); ctx.beginPath(); ctx.moveTo(0, -4); ctx.lineTo(4, -6); ctx.lineTo(4, 0); ctx.lineTo(0, -1); ctx.fill();
      ctx.save(); ctx.translate(10 + Math.sin(time * .8 + phase) * 4, 1); this.drawPerson(ctx, time * 5, '#baacdb'); ctx.restore();
      ctx.fillStyle = '#d6b775'; ctx.fillRect(-12, -8, 6, 1.4);
    } else if (activity.kind === 'gathering') {
      for (let i = 0; i < 6; i++) { const a = i * 2.4 + phase; ctx.save(); ctx.translate(Math.cos(a) * (6 + i % 3) + Math.sin(time * .6 + i) * 2, Math.sin(a) * 7); this.drawPerson(ctx, time * 4 + i, ['#b4cecd', '#c3a9d1', '#dcbd8d'][i % 3], .9); ctx.restore(); }
    } else if (activity.kind === 'moving') {
      ctx.fillStyle = '#ced3cd'; ctx.fillRect(-13, -5, 9, 14); ctx.fillStyle = '#4e7786'; ctx.fillRect(-12, -3, 7, 3);
      ctx.save(); ctx.translate(4 + Math.sin(time + phase) * 5, 2); this.drawPerson(ctx, time * 6, '#c0c8d3'); ctx.fillStyle = '#bb966b'; ctx.fillRect(0, -1, 4, 4); ctx.restore();
      ctx.fillStyle = '#9e815f'; ctx.fillRect(12, 0, 4, 4); ctx.fillRect(10, 5, 4, 4);
    } else if (activity.kind === 'traffic') {
      this.drawCone(ctx, -7, 0); this.drawCone(ctx, 7, 0); ctx.strokeStyle = '#d7a865'; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(-10, 5); ctx.lineTo(10, 5); ctx.stroke(); ctx.setLineDash([]);
    } else {
      ctx.strokeStyle = '#e5a393'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(6, 5); ctx.lineTo(-6, 5); ctx.closePath(); ctx.stroke(); ctx.fillStyle = '#e5a393'; ctx.fillRect(-.7, -2, 1.4, 3.4); ctx.fillRect(-.7, 3, 1.4, 1.2);
    }
  }

  drawCone(ctx, x, y) {
    ctx.fillStyle = '#12212a'; ctx.fillRect(x - 2.5, y + 1.5, 5, 2);
    ctx.fillStyle = '#e9a268'; ctx.beginPath(); ctx.moveTo(x, y - 3); ctx.lineTo(x + 2, y + 2); ctx.lineTo(x - 2, y + 2); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#e9d9bd'; ctx.lineWidth = .8; ctx.beginPath(); ctx.moveTo(x - 1, y); ctx.lineTo(x + 1, y); ctx.stroke();
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true; this.stop(); clearTimeout(this.roadTimer);
    this.map.off('resize', this._resize); this.map.off('move', this._move); this.map.off('idle', this._idle);
    document.removeEventListener('visibilitychange', this._visibility);
    this.canvas.remove(); this.actors = []; this.activity = [];
  }
}
