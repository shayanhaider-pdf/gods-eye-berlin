# Original God’s Eye View: parity checklist

Audit date: 2026-11-15. Original repository: [bilawalsidhu/gods-eye-view](https://github.com/bilawalsidhu/gods-eye-view). Pinned source commit: [3d25a284f9186dcc936c26e0c4f745337b402e37](https://github.com/bilawalsidhu/gods-eye-view/tree/3d25a284f9186dcc936c26e0c4f745337b402e37).

This document records the requested target, not a claim that all original features are available in the Berlin deployment. Each unchecked item still needs implementation and verification against that deployed app. Berlin’s existing transit atlas, historical/geographic stories, illustrative city activity, rain radar, replay and precise location handling remain useful additions; similarly named controls do not prove parity with the original.

## Public deployment 3.0.0

The site now adds **30 world-source controls** with per-source counts, timestamps, provenance, coverage and unavailable states. Keyless source contracts include USGS earthquakes, CelesTrak SGP4 satellites and predicted tracks, launch schedules, EONET wildfire events, NOAA cyclone positions, OSM infrastructure/cameras, Citi Bike availability, Panoramax photos, iNaturalist, GDELT, Radio Browser, NIFC perimeters and model air quality. Existing Berlin weather, transit, history and simulation remain.

Mission control adds globe/terrain, north/tilt, five display looks, loaded-contact tracking/trails/ID boxes, geometric satellite passes, radio playback, camera scenes, manual marks/routes, validated JSON imports/exports, OSRM directions, share-view links and browser speech commands.

These are deliberately described at their implemented fidelity. **Full upstream parity is not complete.** In particular, the hosted app does not run Cesium photogrammetry, the original fleet models, persistent AIS collection, original camera/HLS packs, all transit operators, the 96-source Library, AI voice/analyst services, SDR/receiver controls or the advanced import/scene engines. The machine-readable checklist now records a deployment note for every one of the 52 families. An empty source is not proof of no real-world activity.

The complete original engine is pinned as a Git submodule in the GitHub repo; [run it with its original backend](ORIGINAL-ENGINE.md). This makes the full original code available without misrepresenting what the public Worker runs. Source/API credentials and runtime services are still required for the features that need them.

## Evidence

Reviewed `README.md`, `LICENSE`, `package.json`, `docs/CURRENT-STATE.md`, `DATA_SOURCES.md`, `src/app/sourceComposition.js`, `src/app/catalog.js` and the complete source tree. The tree contains 3,804 entries, including 96 Data Library JSON manifests. The older “Not Currently in Runtime” paragraph still says weather radar was removed; current source contracts and the current README explicitly register observed radar, satellite clouds and lightning. Current code wins over that stale paragraph.

Machine-readable checklist: [data/upstream-features.json](../data/upstream-features.json). The original code license is preserved at [docs/licenses/gods-eye-view-LICENSE.txt](licenses/gods-eye-view-LICENSE.txt).

## Complete feature families

| Verified in this deployment | Original feature | Sources / keys | Runtime and fidelity requirements |
| --- | --- | --- | --- |
| [ ] | **3D globe, map stacks and terrain** | Esri, OSM, Cesium ion, Google. None for Esri/OSM; Cesium ion or Google for photorealistic 3D. | Cesium WebGL client; terrain/imagery services. |
| [ ] | **Civil flights, metadata and trails** | OpenSky, adsb.lol. Optional OpenSky credentials. | Bounded server polling/cache. |
| [ ] | **Military ADS-B flights and emergency broadcasts** | adsb.lol. None. | Bounded server polling/cache. |
| [ ] | **Live AIS vessels** | AISStream. AISStream key. | Persistent outbound WebSocket collector and cache. |
| [ ] | **Satellites, six classes, orbits and visible passes** | CelesTrak, SATCAT, UCS. None. | TLE propagation and satellite metadata. |
| [ ] | **30-day space missions and launch playback** | Launch Library 2, CelesTrak. Optional paid LL2 token. | Server cache; launch/orbit models. |
| [ ] | **Earthquakes, magnitude/depth/time details** | USGS. None. | GeoJSON polling. |
| [ ] | **Canadian AQHI readings** | ECCC GeoMet. None. | Canada-only station catalog and observations. |
| [ ] | **Road simulation and measured congestion** | OSM, TomTom. TomTom for live traffic flow. | Road tiles, optional flow proxy; positions simulated. |
| [ ] | **Live buses, trams, metro, ferries and delayed playback** | Operator GTFS-Realtime feeds. None for supported feeds. | Protocol parsing, histories and regional feeds. |
| [ ] | **Live trains, rail paths, next stops and delays** | 30 operator feeds and opt-in GTFS packs. None for supported feeds. | Protocol/XML parsing, built static route packs. |
| [ ] | **Bike station availability** | GBFS operators. None. | Discovery/catalog and regional station queries. |
| [ ] | **Drive/walk/cycle routing, steps and route flights** | OSRM / FOSSGIS / OSM. None. | Bounded routing proxy and camera playback. |
| [ ] | **Mapped public still cameras, live HLS and nearest-camera handoff** | Official regional transportation agencies. Some packs require agreements or credentials. | Image/HLS proxies; bounded sessions, source licenses. |
| [ ] | **Mapped ALPR camera locations and tags** | OpenStreetMap / DeFlock mapping. None. | Viewport OSM acquisition; locations only. |
| [ ] | **Embedded street imagery and coverage** | Mapillary, Google, KartaView, Panoramax. Mapillary token; Google key; none for KartaView/Panoramax. | Provider viewers and coverage/photo services. |
| [ ] | **Recent Sentinel/Landsat/VIIRS imagery, box selection, days and exports** | NASA CMR, GIBS, Worldview Snapshots. None. | Browser catalog/tiles; availability and attribution. |
| [ ] | **World radio map and analog tuner** | Radio Browser / broadcasters. None. | Directory proxy, playback stream compatibility. |
| [ ] | **Datacenter infrastructure** | OSM extract. None. | Bundled ODbL snapshot and attribution. |
| [ ] | **Dam infrastructure** | OpenInfraMap / OSM. None. | Bundled ODbL snapshot and attribution. |
| [ ] | **Submarine cable routes and landings** | TeleGeography. None; noncommercial data terms. | Bundled CC BY-NC-SA data. |
| [ ] | **Mapped military-site context** | OpenFreeMap / OSM. Optional configured Overpass or Google. | Viewport tile acquisition; incomplete community mapping. |
| [ ] | **FAA prohibited and restricted special-use airspace** | FAA SUA. None. | Paged FeatureServer polygons; US-only and not UAS planning. |
| [ ] | **Active fire detections** | NASA FIRMS. FIRMS map key for live detections. | Bounded CSV/raster queries; time/source metadata. |
| [ ] | **Wildfire perimeters and containment** | NIFC WFIGS, InciWeb. None. | Paged ArcGIS polygons and verified incident links. |
| [ ] | **Navigation accuracy aggregation** | adsb.lol; GPSJAM formula. None. | Point snapshot aggregation; no interference assertion. |
| [ ] | **S2 GhostMaps selectable intelligence products** | S2 Underground GitHub KMZ. None; CC BY-NC-SA 4.0 data. | KMZ parsing, edition selection and event-age filters. |
| [ ] | **Shipwreck records, eras, depth and histories** | EMODnet, Wikidata. None. | WFS/SPARQL merge and stale-source metadata. |
| [ ] | **Conflict and local news, hotspots, timelines and outlines** | GDELT, optional Liveuamap / World News API. World News API for Local; paid Liveuamap optional. | News ingestion/cache; country outline resolution. |
| [ ] | **Wildlife observations and density with photo credits** | iNaturalist, Acartia. None. | Paced queries; sensitive locations preserved. |
| [ ] | **Animated forecast wind and speed/temperature/pressure fields** | NOAA GFS, ECMWF IFS. None. | GRIB decoding/grid cache and particle renderer. |
| [ ] | **Observed rain, satellite clouds and lightning timeline** | NOAA nowCOAST. None. | Observed-frame services; regional coverage limits. |
| [ ] | **Cyclone advisories, forecast tracks and uncertainty cones** | NOAA NHC / CPHC. None. | Advisory GIS parsing; Atlantic/Pacific coverage. |
| [ ] | **Sea mark overlay** | OpenSeaMap. None. | Raster tile overlay; attribution. |
| [ ] | **Ski piste overlay** | OpenSnowMap. None. | Raster tile overlay; no bulk download. |
| [ ] | **Place search, filters and analytical follow-ups** | Configured OSM Overpass server. Own Overpass upstream configuration. | Bounded OSM proxy and query tools. |
| [ ] | **Local ADS-B receiver input** | User receiver. Own receiver. | Local Node receiver bridge. |
| [ ] | **Local RTL-SDR controls** | User USB RTL-SDR receiver. Own hardware. | WebUSB-compatible browser / receiver stack. |
| [ ] | **Data Library: 96 source manifests** | Regional imagery, environment, hazards, infrastructure and terrain providers. Per-entry terms; most keyless. | Validated manifests; datasets, imagery and terrain loaders. |
| [ ] | **Life-size 3D fleet and glyph/model level of detail** | Upstream procedural models. None. | Cesium model collections and type mappings. |
| [ ] | **Click-to-track, trails, metadata, detection boxes and IDs** | Loaded source entities. None. | Tracking lifecycle, picking and projected labels. |
| [ ] | **250-km contacts roster and global context** | Loaded flights, military, vessels, installations. Depends on selected feeds. | Context ownership, filters and camera state. |
| [ ] | **Aircraft cockpit, vessel bridge and orbital views** | Loaded tracked entities and terrain. Depends on feed / map source. | Cesium 3D cameras, ground/mesh guards. |
| [ ] | **CRT, NVG, thermal/FLIR, Noir and other sensor looks** | GLSL post-processing. None. | Cesium shader pipeline; visual effect, not thermal measurement. |
| [ ] | **Tactical/Minimal/Cyber HUD, scope, telemetry and visual controls** | App state. None. | Responsive UI, keyboard access and shader settings. |
| [ ] | **Cinematic scene director, tours, files and bundles** | Authored camera moves and data packs. Depends on scene content. | Scene lifecycle, preview, import/export and camera anchors. |
| [ ] | **Manual and voice pins, routes and area annotations** | User annotations; source-backed boundaries. Voice needs OpenAI; optional source lookups. | Drawing lifecycle, resolver, geometry and edit controls. |
| [ ] | **GeoJSON, KML, KMZ and GPX import** | User local files. None. | Client parsers, styles, metadata and terrain placement. |
| [ ] | **Share camera/style/layers/options/tracked target, reset globe** | App state. None. | Deterministic versioned URLs; tracked-target handoff. |
| [ ] | **Hands-free voice and analyst queries** | OpenAI Realtime. OpenAI API key; upstream local OAuth option. | Server ephemeral token minting, WebRTC, tool schemas and cost controls. |
| [ ] | **MCP server and embeddable conversation panel** | Upstream app tools. Depends on operation. | Persistent Node MCP server / panel build. |
| [ ] | **Bhote Koshi flood replay, before/after imagery and witness sources** | Vantor / GeoPera / witness links. Noncommercial imagery and derived-data terms. | Scene playback, source links and special data pack. |

## Important details within the families

- **Satellites:** individual classification switches for Stations, Imaging, Telecom, Starlink, Probes and Debris; live counts, full Starlink shell, orbital tracks, metadata and next visible rise/peak/set calculations. Propagated positions are calculated from orbital elements, not direct live observations.
- **CCTV:** official packs cover numerous US/Canadian regions and countries including London, Finland, Norway, Estonia, Taiwan and NSW. Coverage is provider-specific; the original does not offer a universal camera feed for every Berlin street. Some packs are opt-in or require an agency agreement. HLS, snapshots, Street View and synthetic fallbacks must remain distinguishable.
- **Transit and rail:** original live vehicle positions are distinct from Berlin’s existing moving timetable/route illustrations. Upstream uses delayed playback between real reports, selected-vehicle trails, mode/service filters, histories and optional built GTFS path packs. Berlin cannot be called live simply because a train marker moves.
- **Observed weather:** NOAA rain coverage is contiguous-US; satellite imagery can be regional or global; lightning is Americas/Pacific. Those source limits must stay visible. Berlin’s current RainViewer radar is a useful separate observed source.
- **Directions:** route profiles, terrain-following geometry, turn-by-turn steps and fly-along playback; not a straight line labelled as directions.
- **Street level:** KartaView and Panoramax are keyless, Mapillary requires its public client token, and Google needs its enabled Maps key. Full parity includes coverage, image cones, embedded viewer, provider switches and expansion.
- **Detection and sensor looks:** projected labels, screen boxes, IDs and trails are visualisations of loaded assets. “Thermal”/FLIR is a shader look and does not provide measured thermal imagery.
- **News and wildlife:** machine-coded news locations can be wrong. Wildlife sightings are not a census, and sensitive locations remain obscured. Retain image creator/licence attribution.
- **Data Library:** all 96 manifests, not only a few sample layers. Includes regional orthophotos, terrain, hazard feeds, dams/plants/bridges/structures, geology, hydrography, water maps, tides and ecological density. Each needs its coverage, service contract and attribution.
- **Imports and annotations:** show/hide, fly-to, remove, styles, geometry metadata and lifecycle cleanup. Manual mark rename/recolour and source-backed boundaries are separate from displaying an arbitrary circle.
- **Share and director:** deterministic saved state includes the camera, enabled layers, allowlisted options, selected target and visual configuration; scene bundles include camera anchors, authored moves and data packs.
- **Voice:** upstream provides tool-driven operations and analyst counts/filters/ranking, not only browser speech-to-text. API sessions have spend telemetry, warnings and a hard cap. Public deployment must not expose a shared owner credential or loopback-only OAuth/key-management routes.

## Runtime constraints

The original is a Vite/Vue/Cesium application backed by Node provider middleware. Its supported engines are Node 24.14+ (below 25) or Node 26.x. The repository currently pins Node 24.22.2 in CI/Docker. Its dependency set includes Cesium, Vue/Pinia, satellite.js, HLS decoding, GRIB/WASM handling, vector-tile/Parquet readers, MapillaryJS, WebUSB receiver components and provider-specific parsers.

The current Berlin site serves an embedded MapLibre client from a Cloudflare Worker. The original’s Vite middleware cannot be copied into that Worker unchanged: persistent AIS WebSockets, receiver bridges, filesystem caches, bounded HLS session collectors, the local MCP server and provider libraries need individual adapters or a separately hosted persistent Node backend. Cesium photorealistic 3D is a different rendering stack from MapLibre building extrusions. Shipping a compiled frontend without its provider routes does not implement the original features.

A useful implementation may integrate public providers natively while retaining Berlin’s current experience, but full parity is complete only when every relevant row above has working UI, actual data/source status, appropriate runtime support and deployed verification. Unsupported or unconfigured feeds should report their reason, rather than appear as fictional observations or a successful empty result.

## Keys and provider access

| Capability | Required configuration |
| --- | --- |
| Google photorealistic 3D / Google search / Google Street View | Eligible Cesium ion public assets token for ion-hosted 3D, or enabled/billing-backed Google Maps key. Street View/search have their own API requirements. Preserve visible provider credits. |
| AI voice and HUD/analyst summaries | OpenAI API key with a server token broker; the original’s ChatGPT/Codex OAuth option is explicitly local/loopback-only. |
| Live AIS vessels | AISStream key and persistent collector. |
| NASA live active fires | FIRMS map key. A bundled snapshot is historical reference. |
| Measured road congestion | TomTom key. Keyless moving road actors remain simulations. |
| Mapillary | Mapillary client token. KartaView/Panoramax offer different keyless coverage. |
| Local country news | World News API key and its usage/cache terms. GDELT conflict reports are keyless; optional Liveuamap is paid. |
| Higher OpenSky / launch allowances | Optional OpenSky credentials / paid Launch Library 2 token. |
| OSM place analysis | Operator-configured Overpass upstream; original intentionally disables the tool without it. |
| Local receivers | User-owned ADS-B / RTL-SDR hardware and appropriate local/browser access. |

No existing key values were read or copied during this audit.

## Licensing and attribution

The original source code and its procedural fleet models are MIT licensed. Preserve the Bilawal Sidhu copyright and licence notice in substantial reused code. The licence does **not** license third-party data:

- TeleGeography submarine cables: **CC BY-NC-SA 3.0**. Commercial use requires separate permission or removal.
- S2 Underground GhostMaps: **CC BY-NC-SA 4.0**.
- Bhote Koshi imagery and derived river path: **CC BY-NC 4.0** (Vantor/GeoPera). Witness-linked posts retain their owners’ terms.
- OSM/OpenInfraMap datacentres, dams and other OSM-derived data: **ODbL 1.0**, with attribution and applicable data share-alike terms.
- EMODnet heritage shipwrecks: **CC BY 4.0**, excluding non-open wrecksite.eu-derived records. Wikidata: **CC0**.
- NASA FIRMS detections: US public-domain/CC0 source with requested citation.
- Live imagery, camera feeds, radio streams, news, maps and other provider data retain their provider terms. Agency agreement and embedding restrictions apply to individual CCTV packs.

Keep attribution inside the app as well as in documentation. Do not reuse upstream promotional screenshots/GIFs as standalone visual assets; their media provenance notes specify separate rights.


## Verified provider availability

Production checks returned live USGS events, CelesTrak orbital elements, Panoramax street photos and NASA daily imagery. During this release, Overpass timed out or rejected requests, Launch Library and iNaturalist returned rate limits, and the routing service could not be reached from the hosted runtime. These return explicit unavailable states. Berlin data-center queries can use the original OSM snapshot as a labelled reference fallback; its extraction date is unknown. Public provider availability is not a deployment guarantee.

The 11-record Berlin infrastructure subset in `data/berlin-infrastructure.json` is derived from the pinned upstream OpenStreetMap dataset and remains ODbL 1.0. See its source link; the original README states that the extraction date was not recorded. No contact-oriented tags were added.
