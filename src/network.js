/** Real published transport geometry. This module never invents vehicle positions. */
export const TRANSPORT_MODES = Object.freeze(['ubahn', 'sbahn', 'tram', 'bus', 'rail', 'ferry']);
const COLORS = Object.freeze({ ubahn: '#5ba8f5', sbahn: '#62c984', tram: '#f1745f', bus: '#b69be3', rail: '#d9b877', ferry: '#60cbd4' });
const NAMES = Object.freeze({ ubahn: 'U-Bahn', sbahn: 'S-Bahn', tram: 'Tram', bus: 'Bus', rail: 'Regional rail', ferry: 'Ferry' });
const ORDER = ['bus', 'ferry', 'rail', 'tram', 'sbahn', 'ubahn'];
const EMPTY = () => ({ type: 'FeatureCollection', features: [] });
const DEFAULT_VISIBILITY = Object.freeze({ ubahn: true, sbahn: true, tram: true, bus: true, rail: true, ferry: true, stations: true, labels: true });

function array(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return [];
  try { const parsed = JSON.parse(value); if (Array.isArray(parsed)) return parsed; } catch {}
  return value.split(/[,;|]/).map(v => v.trim()).filter(Boolean);
}

function coordinate(point) {
  return Array.isArray(point) && point.length >= 2 && Number.isFinite(point[0]) && Number.isFinite(point[1]) && Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 85;
}

function lineGeometry(geometry) {
  if (geometry?.type === 'LineString') return Array.isArray(geometry.coordinates) && geometry.coordinates.length >= 2 && geometry.coordinates.every(coordinate);
  if (geometry?.type === 'MultiLineString') return Array.isArray(geometry.coordinates) && geometry.coordinates.length > 0 && geometry.coordinates.every(line => Array.isArray(line) && line.length >= 2 && line.every(coordinate));
  return false;
}

function searchText(value) {
  return String(value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().replace(/ß/g, 'ss');
}

function color(value, fallback) {
  const s = String(value || '');
  if (/^#[0-9a-f]{6}$/i.test(s)) return s;
  if (/^[0-9a-f]{6}$/i.test(s)) return '#' + s;
  return fallback;
}

/** Pure normalisation and filtering, exported to allow map-independent validation. */
export function filterTransportData(data = {}, visibility = DEFAULT_VISIBILITY, query = '') {
  const enabled = { ...DEFAULT_VISIBILITY, ...visibility };
  const q = searchText(query).trim();
  const routes = (Array.isArray(data.routes?.features) ? data.routes.features : []).flatMap((feature, i) => {
    const p = feature?.properties || {};
    if (!TRANSPORT_MODES.includes(p.mode) || !enabled[p.mode] || !lineGeometry(feature.geometry)) return [];
    const name = String(p.name || p.line || NAMES[p.mode]);
    if (q && !searchText([name, p.longName, p.description, NAMES[p.mode]].filter(Boolean).join(' ')).includes(q)) return [];
    return [{ ...feature, properties: { ...p, id: String(p.id ?? feature.id ?? `route-${i}`), name, color: color(p.color, COLORS[p.mode]), modeName: NAMES[p.mode] } }];
  });
  const stations = !enabled.stations ? [] : (Array.isArray(data.stations?.features) ? data.stations.features : []).flatMap((feature, i) => {
    const p = feature?.properties || {};
    if (feature?.geometry?.type !== 'Point' || !coordinate(feature.geometry.coordinates)) return [];
    const modes = [...new Set([...array(p.modes), p.mode].filter(mode => TRANSPORT_MODES.includes(mode)))];
    const visibleModes = modes.filter(mode => enabled[mode]);
    if (!visibleModes.length) return [];
    const lines = [...new Set(array(p.lines).map(String))];
    const name = String(p.name || p.title || 'Unnamed stop');
    if (q && !searchText([name, ...lines, ...modes.map(mode => NAMES[mode])].join(' ')).includes(q)) return [];
    const mode = ['ubahn', 'sbahn', 'rail', 'tram', 'ferry', 'bus'].find(mode => visibleModes.includes(mode));
    const major = visibleModes.some(mode => ['ubahn', 'sbahn', 'rail'].includes(mode));
    const badge = visibleModes.includes('ubahn') && visibleModes.includes('sbahn') ? 'U / S' : visibleModes.includes('ubahn') ? 'U' : visibleModes.includes('sbahn') ? 'S' : '';
    return [{ ...feature, properties: { ...p, id: String(p.id ?? feature.id ?? `station-${i}`), name, mode, modes, visibleModes, lines, color: COLORS[mode], major, badge, label: name } }];
  });
  return { routes: { type: 'FeatureCollection', features: routes }, stations: { type: 'FeatureCollection', features: stations } };
}

function asRecord(feature) {
  const p = feature.properties || {};
  const lines = feature.geometry?.type === 'LineString' ? [feature.geometry.coordinates] : feature.geometry?.type === 'MultiLineString' ? feature.geometry.coordinates : [];
  const longest = lines.reduce((a, b) => b.length > a.length ? b : a, []);
  const point = feature.geometry?.type === 'Point' ? feature.geometry.coordinates : longest[Math.floor(longest.length / 2)];
  return { ...p, modes: array(p.modes), lines: array(p.lines), title: p.name, lon: point?.[0], lat: point?.[1], geometry: feature.geometry, feature };
}

export class TransportNetwork {
  constructor(map, { onStation, onRoute } = {}) {
    this.map = map;
    this.onStation = onStation;
    this.onRoute = onRoute;
    this.data = { routes: EMPTY(), stations: EMPTY() };
    this.filtered = this.data;
    this.visibility = { ...DEFAULT_VISIBILITY };
    this.query = '';
    this.installed = false;
    this.destroyed = false;
    this.handlers = [];
    this.ids = [];
    this.loadHandler = () => { if (!this.installed) { this.install(); this.update(); } };
    map.on('load', this.loadHandler);
    // A caller may construct us during its own load callback after adding other
    // GeoJSON sources. Those sources temporarily make isStyleLoaded() false.
    // The next idle event completes installation without requiring a second load.
    map.on('idle', this.loadHandler);
    if (map.isStyleLoaded?.()) this.loadHandler();
  }

  install() {
    if (this.installed || this.destroyed) return;
    const map = this.map;
    // Network is placed below activity markers, so a nearby activity remains selectable.
    const before = ['record-glow', 'records', 'area-center'].find(id => map.getLayer(id));
    const font = map.getStyle()?.layers?.find(layer => Array.isArray(layer.layout?.['text-font']))?.layout['text-font'] || ['Open Sans Regular'];
    const regularFont = ['Montserrat Medium', 'Open Sans Regular', 'Noto Sans Regular'];
    this.font = font;
    map.addSource('transport-routes', { type: 'geojson', data: EMPTY(), attribution: 'Transport network © VBB, CC BY 4.0' });
    map.addSource('transport-stations', { type: 'geojson', data: EMPTY() });
    const add = layer => { map.addLayer(layer, before); this.ids.push(layer.id); };
    for (const mode of ORDER) {
      const filter = ['==', ['get', 'mode'], mode];
      const light = mode === 'bus' || mode === 'ferry';
      add({ id: `transport-${mode}-glow`, type: 'line', source: 'transport-routes', filter,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 9, light ? 1.8 : 3, 13, light ? 4 : 8, 17, light ? 7 : 13], 'line-opacity': light ? 0.055 : 0.12, 'line-blur': 3 } });
      add({ id: `transport-${mode}`, type: 'line', source: 'transport-routes', filter,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 9, light ? 0.5 : 1, 13, light ? 1 : 2.2, 17, light ? 2 : 4.2], 'line-opacity': light ? 0.42 : 0.9, ...(mode === 'ferry' ? { 'line-dasharray': [3, 3] } : {}) } });
      add({ id: `transport-${mode}-labels`, type: 'symbol', source: 'transport-routes', minzoom: mode === 'bus' ? 13.5 : 10.5, filter,
        layout: { 'symbol-placement': 'line', 'symbol-spacing': mode === 'bus' ? 500 : 330, 'text-field': ['get', 'name'], 'text-font': regularFont, 'text-size': ['interpolate', ['linear'], ['zoom'], 10, 9, 16, 11], 'text-letter-spacing': 0.05, 'text-max-angle': 35, 'text-padding': 7, 'text-keep-upright': true },
        paint: { 'text-color': ['get', 'color'], 'text-halo-color': '#080f17', 'text-halo-width': 2.5, 'text-opacity': mode === 'bus' ? 0.65 : 1 } });
    }
    add({ id: 'transport-station-major-halo', type: 'circle', source: 'transport-stations', minzoom: 10, filter: ['==', ['get', 'major'], true],
      paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 2.5, 14, 5, 18, 8], 'circle-color': '#0b131d', 'circle-stroke-color': ['get', 'color'], 'circle-stroke-width': 1.5, 'circle-opacity': 0.98 } });
    add({ id: 'transport-station-minor', type: 'circle', source: 'transport-stations', minzoom: 13, filter: ['!=', ['get', 'major'], true],
      paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 13, 1.8, 16, 3.4, 19, 5], 'circle-color': ['get', 'color'], 'circle-stroke-color': '#0b131d', 'circle-stroke-width': 1.1, 'circle-opacity': 0.88 } });
    add({ id: 'transport-station-names', type: 'symbol', source: 'transport-stations', minzoom: 11,
      filter: ['==', ['get', 'major'], true],
      layout: { 'text-field': ['get', 'name'], 'text-font': regularFont, 'text-size': ['interpolate', ['linear'], ['zoom'], 11, 9, 16, 12], 'text-anchor': 'left', 'text-offset': [0.7, 0], 'text-padding': 7, 'text-max-width': 13, 'text-optional': true, 'symbol-sort-key': ['case', ['==', ['get', 'mode'], 'ubahn'], 0, 1] },
      paint: { 'text-color': '#dae4ed', 'text-halo-color': '#07101b', 'text-halo-width': 2.5 } });
    add({ id: 'transport-stop-names', type: 'symbol', source: 'transport-stations', minzoom: 14.5,
      filter: ['!=', ['get', 'major'], true],
      layout: { 'text-field': ['get', 'name'], 'text-font': regularFont, 'text-size': 10, 'text-anchor': 'left', 'text-offset': [0.6, 0], 'text-padding': 12, 'text-max-width': 14, 'text-optional': true },
      paint: { 'text-color': '#b1c0cf', 'text-halo-color': '#07101b', 'text-halo-width': 2 } });
    this.stationLayers = ['transport-station-major-halo', 'transport-station-minor', 'transport-station-names', 'transport-stop-names'];
    const activityAt = e => map.getLayer('records') && map.queryRenderedFeatures(e.point, { layers: ['records'] }).length;
    const stationClick = e => {
      if (activityAt(e) || !e.features?.length || e.originalEvent?.__transportHandled) return;
      if (e.originalEvent) e.originalEvent.__transportHandled = true;
      this.onStation?.(asRecord(e.features[0]));
    };
    const routeClick = e => {
      if (activityAt(e) || !e.features?.length || e.originalEvent?.__transportHandled) return;
      const renderedStationLayers = this.stationLayers.filter(id => map.getLayer(id));
      if (renderedStationLayers.length && map.queryRenderedFeatures(e.point, { layers: renderedStationLayers }).length) return;
      if (e.originalEvent) e.originalEvent.__transportHandled = true;
      this.onRoute?.(asRecord(e.features[0]));
    };
    const cursorIn = () => { map.getCanvas().style.cursor = 'pointer'; };
    const cursorOut = () => { map.getCanvas().style.cursor = ''; };
    for (const id of this.stationLayers) {
      this.listen('click', id, stationClick); this.listen('mouseenter', id, cursorIn); this.listen('mouseleave', id, cursorOut);
    }
    for (const mode of ORDER) {
      this.listen('click', `transport-${mode}`, routeClick); this.listen('mouseenter', `transport-${mode}`, cursorIn); this.listen('mouseleave', `transport-${mode}`, cursorOut);
    }
    this.installed = true;
  }

  listen(event, layer, handler) {
    this.map.on(event, layer, handler);
    this.handlers.push([event, layer, handler]);
  }

  setData({ routes, stations } = {}) {
    if (this.destroyed) return;
    this.data = { routes: routes?.type === 'FeatureCollection' ? routes : EMPTY(), stations: stations?.type === 'FeatureCollection' ? stations : EMPTY() };
    this.update();
  }

  setVisibility(values = {}) {
    if (this.destroyed) return;
    let changed = false;
    for (const key of Object.keys(DEFAULT_VISIBILITY)) if (typeof values[key] === 'boolean' && this.visibility[key] !== values[key]) { this.visibility[key] = values[key]; changed = true; }
    if (changed) this.update();
  }

  setFilter(query = '') {
    if (this.destroyed) return;
    const q = String(query).slice(0, 200);
    if (q === this.query) return;
    this.query = q;
    this.update();
  }

  update() {
    if (this.destroyed) return;
    this.filtered = filterTransportData(this.data, this.visibility, this.query);
    if (!this.installed) return;
    this.map.getSource('transport-routes')?.setData(this.filtered.routes);
    this.map.getSource('transport-stations')?.setData(this.filtered.stations);
    for (const id of this.ids) {
      if (!this.map.getLayer(id)) continue;
      const isLabel = id.endsWith('-labels') || id.endsWith('-names');
      const station = id.startsWith('transport-station-') || id === 'transport-stop-names';
      const mode = TRANSPORT_MODES.find(mode => id === `transport-${mode}` || id.startsWith(`transport-${mode}-`));
      const visible = (!isLabel || this.visibility.labels) && (!station || this.visibility.stations) && (!mode || this.visibility[mode]);
      this.map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
    }
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.map.off('load', this.loadHandler);
    this.map.off('idle', this.loadHandler);
    for (const args of this.handlers) this.map.off(...args);
    for (const id of [...this.ids].reverse()) if (this.map.getLayer(id)) this.map.removeLayer(id);
    for (const id of ['transport-stations', 'transport-routes']) if (this.map.getSource(id)) this.map.removeSource(id);
    this.handlers = [];
    this.ids = [];
    this.map.getCanvas().style.cursor = '';
  }
}
