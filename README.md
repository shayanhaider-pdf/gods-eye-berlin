# God Eye Berlin

## [▶ Open God Eye Berlin](https://around-me-berlin-gods-eye.arsalanhaider.chatgpt.site)

A cinematic Berlin atlas with transport networks, named stations, history, public activity, weather overlays and clearly labeled simulated city movement.

**To see the app:** click **Open God Eye Berlin** above. The existing deployed app currently requires its authorized ChatGPT sign-in; public GitHub source does not change its access settings.

**To run it on your computer:**

```sh
git clone https://github.com/shayanhaider-pdf/gods-eye-berlin.git
cd gods-eye-berlin
npm ci
npm run dev
```

Open the localhost URL printed by the development server. Node.js 24 or later is required.

This repository contains the app source, source-backed dataset snapshots, dataset generation scripts, automated tests, QA checklist, build/deployment tooling and project documentation.

- [Project brief and delivery status](docs/PROJECT.md)
- [Next improvements](docs/ROADMAP.md)
- [Sources and attribution](docs/DATA-SOURCES.md)
- [Build and hosting](docs/DEPLOYMENT.md)
- [Browser QA checklist](QA-plan.md)

---

## Implementation notes

Version 2 expands the observatory into a sourced, animated Berlin explorer. New layers include real published U-Bahn, S-Bahn, tram, bus, regional rail and ferry paths; named stops and line memberships; history, architecture, culture, memorials, geography and parks; radar, model weather fields, public aircraft observations and official district pulse boundaries.

The embedded VBB GTFS snapshot contains 1,341 representative service-pattern geometries and 4,523 named stop/station groups across Berlin and its border area. Counts of geometries are not counts of distinct lines. The catalogue contains nine U-Bahn line names, 16 S-Bahn, 31 tram, 432 bus, 29 regional and seven ferry names within the snapshot's selection. These are published service shapes, not exact engineering track surveys or a guarantee of current service.

The history atlas includes 116 attributed places, including 23 station/former-station entries. Curated full excerpts work without runtime Wikipedia access. Other place/station details use bounded Wikimedia lookup and disclose fallback matches. Text is reused under the source CC BY-SA terms with attribution; it is not AI-generated history. Reproduction scripts and snapshot provenance are included.

All people, cars, buses, trains, trams and activity crews are **illustrative simulation**, normally at 4× movement speed. Their movement follows mapped paths and route geometry; construction/filming/event scenes use applicable public activity records. They are not tracked people, traffic measurements or observed vehicle positions. Reduced-motion preferences pause the scene until the user explicitly resumes it. Real public aircraft observations remain separate from simulation.

Fly Berlin tours visit source-backed places with smooth camera transitions. Street View moves to a close map perspective and links to available public panoramas in the provider's own viewer; no panorama availability or integrated Google imagery is fabricated.

Intelligence tools provide transparent rules for delay clusters and street-work concentrations; possible shared-station transfer connections; and a sampled activity index assigned to the 12 official ALKIS Berlin district boundaries (dl-de-zero-2.0). An index reflects the returned scan sample, not complete district coverage, crowd density or safety. Weather overlays show regional modeled values and observed past radar, not a prediction of a storm's future path.

Time Machine and Ghost Mode use actual public observations captured in this browser. IndexedDB retains at most 96 captures for up to 48 hours, including the selected observation area and timestamps. No records are collected while the app is closed. Earlier observations and a typical-day baseline are not invented. Ghost compares an available recorded same-hour observation yesterday, not a statistically established typical day. Replay provides a clear-recordings control.

Validation now includes source/geometry/expiry tests, real-network simulation component tests, MapLibre style-spec validation, API boundary/partial failure tests, replay/signal tests and DOM control smoke tests. DOM tests are not visual or real-WebGL browser QA. The managed image still lacks the required browser-control tool.

Berlin-first public-information map with selected US area views. A dark tactical map, satellite imagery, optional 3D buildings, source-backed activity records, location search, layer and radius controls, record details and GeoJSON export.

## Development

Node 24+. Run `npm ci`, `npm run build`, `npm test`, and `npm run check`. `npm run build` packages the frontend and API as one Cloudflare Worker ES module at `dist/server/index.js`. The tracked Sites identity is in `.openai/hosting.json`. No API keys are needed for the connected feeds.

The frontend is vanilla JavaScript with MapLibre GL JS. Server adapters have independent timeouts, bounded responses and short-lived memory caches. API endpoints accept only validated coordinates and bounded search terms; no arbitrary upstream URLs.

## Connected sources and practical limits

- Berlin street activity: official WFS `gdi.berlin.de/services/wfs/planb_ereignisse`, dl-de-zero-2.0. Queries cap the returned feature count and expose limited coverage. Permit dates are distinct from publication dates.
- VBB via transport.rest: nearby stops and published departures, not live vehicle positions. Community service, upstream VBB terms, no uptime guarantee.
- BBK/NINA: Berlin official public warnings, area-level context. Public dashboard interface and redistribution terms should be reviewed for commercial operation.
- Open-Meteo weather and CAMS air quality: model-derived observations, CC BY 4.0; free API is for noncommercial use. Air-quality scale is European AQI.
- Wikipedia geosearch: coordinate-tagged reference places, CC BY-SA/Wikimedia terms. Places are not live incidents or a comprehensive venue directory.
- USGS: nearby earthquake observations, preliminary and revisable.
- Seattle Fire: recent published fire/rescue dispatch categories; medical categories omitted, locations rounded, no unit tracking. Publication does not prove ongoing activity or outcome.
- Photon/OSM: user-initiated location search. No background geocoding.

Map: © OpenStreetMap contributors (ODbL), © CARTO. Satellite imagery: © Esri, Vantor, Earthstar Geographics, GIS User Community. Satellite imagery is a dated geographic backdrop, not a live feed. MapLibre GL JS is BSD-3-Clause, esbuild is MIT; see installed package licenses. No code from the researched dashboard repositories was copied.

The app does not fabricate incidents, animate vehicles as observations, or treat an empty feed as evidence that an area is quiet. Publication times remain unknown where upstream does not provide them. Coordinates are sent to relevant providers when requesting nearby data; selected observation areas and public point records are retained only in this browser’s bounded replay store as described above. City/radius/layer preferences stay in localStorage. API results are transiently cached in Worker memory.

## Verification

Data adapter/parser and Worker boundary/integration tests cover expiration, time zones, invalid inputs, malformed provider responses and partial failure. Live Berlin adapter requests were smoke-tested during development. The managed environment lacks the required browser-control tool, so visual/mobile interaction QA could not be completed here. See QA-plan.md for the browser acceptance checklist.

New Sites are owner-private by default. Publishing preserves that audience. The Sites workflow helper is absent in this image, so `scripts/prepare-source.mjs` provides an equivalent credential-on-stdin Git push and deployment-archive fallback. It never writes repository credentials to disk.
