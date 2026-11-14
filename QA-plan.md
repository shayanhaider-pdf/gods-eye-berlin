# Around Me QA plan

Test against actual server responses and provider failures. A successful UI render alone does not verify feed coverage.

| Flow | Check | Expected result |
| --- | --- | --- |
| Initial Berlin view | Open the app at desktop size; wait for feeds and map resources | Recognizable Berlin map, readable controls, real source status and timestamps; no fabricated incident counts |
| Map interaction | Pan, zoom, change bearing/pitch, reset north, recenter | Controls operate without losing selected location; overlays remain aligned |
| API partial failure | Return an error for one upstream feed while others succeed | Available layers remain usable; failed source is marked unavailable and never represented as connected |
| Total/offline failure | Make the overview request fail or time out | Actionable retry/offline state; old data, if retained, remains explicitly dated and stale |
| Layer filters | Toggle each category; toggle all off and back on | Map and list show the same filtered set; empty view has an explanation |
| Event inspection | Select a map marker, then a list item | Matching detail opens with category, source, original link, location, publication/update time and known status |
| Nearby radius | Change radius around the selected focus | Requests and displayed items match the radius; counts update; no incident is moved to the focus point |
| City change | Switch Berlin to each supported US city and back | Map and city-specific source status update; no previous-city records persist as current data |
| Location access | Deny geolocation, then test timeout/unavailable position | Clear message; manual city/map exploration still works; no claim of location detection |
| Search | Search a known location and an impossible query | Valid match recenters; no-result state explains the lack of a match; query is safely encoded |
| Mobile view | Inspect at 390 × 844 and 768 × 1024 | Map remains usable; navigation and panels do not overlap; touch targets and close controls remain reachable |
| Keyboard | Tab through controls; activate filters; Escape detail/source panels | Visible focus, labelled icon controls, expected activation and dismissal; no trapped focus behind hidden panels |
| Source provenance | Open source inspector and each source link | Attribution, license, fetch time and provider limitations are available; links use safe new-tab behavior |
| Time validity | Inspect expired, scheduled, currently active and timestamp-missing records | Labels reflect the data; missing source timestamps remain unknown; fetch time is not substituted for event time |
| Refresh races | Change city/radius rapidly while requests are pending | Earlier responses do not overwrite the newest selected area |
| Rendering safety | Feed text includes markup-like text or invalid coordinates | Text is displayed safely; invalid coordinates do not crash or produce markers at 0,0 |

## Environment verification limit

The current managed Linux image exposes `sites-preview`, but the offered tool set has no desktop JavaScript/browser-control tool (`cua_repl.js`). The Sites managed preview instructions require that tool for browser QA and prohibit substituting an improvised browser-control path. Browser layout and interaction checks therefore remain pending until that capability is exposed. Source/build/API checks can still run.
