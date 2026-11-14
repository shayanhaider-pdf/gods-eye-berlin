# Sources and attribution

Provider content is separate from the project’s original code. Dataset snapshot metadata and source links are retained in the JSON files.

| Layer | Source | Terms / limits |
| --- | --- | --- |
| Transport network | VBB GTFS, https://unternehmen.vbb.de/digitale-services/datensaetze/ | CC BY 4.0; representative static service patterns, not live positions or engineering track surveys |
| Street activity | Berlin WFS planb_ereignisse, https://gdi.berlin.de/services/wfs/planb_ereignisse | Data licence Germany Zero 2.0; bounded permit sample |
| District boundaries | Berlin ALKIS, https://gdi.berlin.de/services/wfs/alkis_bezirke | Data licence Germany Zero 2.0 |
| Historical/reference text | Wikipedia / Wikimedia; individual URLs in data/explore-berlin.json | CC BY-SA; individual attribution and excerpt notes are displayed in the app |
| Departures | VBB through transport.rest | Community endpoint; upstream VBB terms apply; availability varies |
| Public warnings | BBK / NINA | Official public warning content; redistribution terms apply |
| Weather and air | Open-Meteo / CAMS | CC BY 4.0; free endpoints are for noncommercial use; regional modeled values |
| Rain radar | RainViewer | Provider API terms and attribution; past observed frames, not a storm prediction |
| Aircraft | OpenSky Network | Provider terms; operational/commercial licensing and rate limits apply; empty feeds remain empty |
| Places/search/map | Wikipedia, Photon / OpenStreetMap, CARTO | Wikimedia / ODbL / provider attribution and service policies |
| Satellite backdrop | Esri World Imagery | Esri and source-provider attribution; dated imagery, not live video |
| Earthquakes / Seattle reports | USGS / City of Seattle | Source-specific public data terms; observations and published reports may be incomplete |

Snapshot regeneration scripts are in scripts/fetch-transport.py, scripts/fetch-explore.py and scripts/fetch-explore-detail.py. Regeneration needs the provider services and Python packages named by each script; the existing snapshots are included so normal builds do not need regeneration.

MapLibre GL JS: BSD-3-Clause. esbuild: MIT. linkedom: ISC. Refer to each installed dependency’s license. No new license for the original project code is implied by publishing the repository.
