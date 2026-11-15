const validPoint = p => Number.isFinite(p?.lat) && Number.isFinite(p?.lon) && Math.abs(p.lat) <= 85 && Math.abs(p.lon) <= 180;
const distanceMetres = (a, b) => Math.hypot((a.lat - b.lat) * 111320, (a.lon - b.lon) * 111320 * Math.cos(b.lat * Math.PI / 180));

export function coordinateSearch(query) {
  const m = query.trim().match(/^(-?\d{1,2}(?:\.\d+)?)\s*[,;]\s*(-?\d{1,3}(?:\.\d+)?)$/);
  if (!m) return null;
  const p = {lat: Number(m[1]), lon: Number(m[2])};
  return validPoint(p) ? {...p, label: `${p.lat.toFixed(6)}, ${p.lon.toFixed(6)}`} : null;
}

/** Browser-owned permission and positioning; coordinates are never persisted here. */
export class LocationTracker {
  constructor({geolocation, permissions, onPosition = () => {}, onStatus = () => {}}) {
    Object.assign(this, {geolocation, permissions, onPosition, onStatus});
    this.following = false;
    this.request = 0;
    this.interaction = 0;
    this.watch = null;
    this.destroyed = false;
  }
  async start() {
    const interaction = this.interaction;
    try {
      const p = await this.permissions?.query({name: 'geolocation'});
      if (this.destroyed || interaction !== this.interaction) return;
      if (p?.state === 'denied') {
        this.onStatus({state: 'denied', automatic: true});
        return;
      }
    } catch { /* Some browsers do not expose geolocation through Permissions. */ }
    if (!this.destroyed && interaction === this.interaction) this.locate(true);
  }
  suspend() {
    this.following = false; this.interaction++;
    if (this.position) this.onStatus({state: 'located', automatic: true, accuracy: this.position.accuracy, following: false});
  }
  locate(automatic = false) {
    if (this.destroyed) return;
    this.interaction++;
    if (!this.geolocation) { this.onStatus({state: 'unavailable', automatic}); return; }
    const request = ++this.request;
    this.following = true;
    this.lastCentered = null;
    this.clearWatch();
    this.onStatus({state: 'locating', automatic});
    const success = position => {
      if (this.destroyed || request !== this.request) return;
      const p = {lat: position.coords.latitude, lon: position.coords.longitude, accuracy: position.coords.accuracy, timestamp: position.timestamp};
      if (!validPoint(p)) { failure({code: 2}); return; }
      if (Number.isFinite(p.timestamp) && Number.isFinite(this.position?.timestamp) && p.timestamp < this.position.timestamp) return;
      this.position = p;
      const center = this.following && (!this.lastCentered || distanceMetres(p, this.lastCentered) >= 20 || p.accuracy < this.lastCentered.accuracy / 2);
      if (center) this.lastCentered = p;
      this.onPosition(p, {center});
      this.onStatus({state: 'located', automatic, accuracy: p.accuracy, following: this.following});
    };
    const failure = error => {
      if (this.destroyed || request !== this.request) return;
      this.onStatus({state: error?.code === 1 ? 'denied' : error?.code === 3 ? 'timeout' : 'unavailable', automatic});
    };
    const options = {enableHighAccuracy: true, timeout: 15000, maximumAge: 30000};
    try {
      this.geolocation.getCurrentPosition(position => {
        success(position);
        if (this.destroyed || request !== this.request || !this.geolocation.watchPosition) return;
        this.watch = this.geolocation.watchPosition(success, failure, {...options, maximumAge: 10000});
      }, failure, options);
    } catch { failure({code: 2}); }
  }
  clearWatch() { if (this.watch !== null) this.geolocation?.clearWatch?.(this.watch); this.watch = null; }
  destroy() { this.destroyed = true; this.request++; this.clearWatch(); }
}

const empty = () => ({type: 'FeatureCollection', features: []});
export function accuracyArea(p) {
  if (!validPoint(p) || !Number.isFinite(p.accuracy) || p.accuracy <= 0) return empty();
  const lat = p.lat * Math.PI / 180, lon = p.lon * Math.PI / 180, angular = p.accuracy / 6371008.8;
  const coordinates = Array.from({length: 65}, (_, i) => {
    const bearing = i / 64 * 2 * Math.PI;
    const phi = Math.asin(Math.sin(lat) * Math.cos(angular) + Math.cos(lat) * Math.sin(angular) * Math.cos(bearing));
    const lambda = lon + Math.atan2(Math.sin(bearing) * Math.sin(angular) * Math.cos(lat), Math.cos(angular) - Math.sin(lat) * Math.sin(phi));
    return [lambda * 180 / Math.PI, phi * 180 / Math.PI];
  });
  return {type: 'FeatureCollection', features: [{type: 'Feature', properties: {}, geometry: {type: 'Polygon', coordinates: [coordinates]}}]};
}

/** Persistent location symbols, independent of the observation and data layers. */
export class LocationView {
  constructor({createMarker, fly}) { Object.assign(this, {createMarker, fly}); }
  attach(map) {
    this.map = map;
    map.addSource('location-accuracy', {type: 'geojson', data: empty()});
    map.addLayer({id: 'location-accuracy-fill', type: 'fill', source: 'location-accuracy', paint: {'fill-color': '#59b8ff', 'fill-opacity': 0.10}});
    map.addLayer({id: 'location-accuracy-line', type: 'line', source: 'location-accuracy', paint: {'line-color': '#79c7ff', 'line-width': 1, 'line-opacity': 0.55}});
    this.render();
    if (this.pendingFlight) { const p = this.pendingFlight; this.pendingFlight = null; this.fly(p); }
  }
  setPosition(p) { this.position = p; this.render(); }
  setFocus(p, fly = true) {
    if (!validPoint(p)) return;
    this.focus = p;
    this.pin?.remove(); this.pin = null;
    this.render();
    if (fly) { if (this.map) this.fly(p); else this.pendingFlight = p; }
  }
  clearFocus() { this.focus = null; this.pendingFlight = null; this.pin?.remove(); this.pin = null; }
  render() {
    if (!this.map) return;
    if (this.position) {
      const p = this.position;
      if (!this.dot) this.dot = this.createMarker('user', 'Your location').setLngLat([p.lon, p.lat]).addTo(this.map);
      this.dot.setLngLat([p.lon, p.lat]);
      const label = `Your location${Number.isFinite(p.accuracy) ? ` · accuracy ±${Math.round(p.accuracy)} m` : ''}`;
      this.dot.getElement().setAttribute('aria-label', label);
      this.dot.getElement().setAttribute('title', label);
      this.map.getSource('location-accuracy').setData(accuracyArea(p));
    }
    if (this.focus?.kind === 'search' && !this.pin) this.pin = this.createMarker('search', this.focus.label).setLngLat([this.focus.lon, this.focus.lat]).addTo(this.map);
  }
  destroy() {
    this.dot?.remove(); this.pin?.remove();
    if (this.map?.removeLayer) {
      for (const id of ['location-accuracy-line', 'location-accuracy-fill']) if (this.map.getLayer(id)) this.map.removeLayer(id);
      if (this.map.getSource('location-accuracy')) this.map.removeSource('location-accuracy');
    }
    this.map = null; this.pendingFlight = null;
  }
}
