# Location and camera behaviour

Location update: 2.1.0.

- On opening the app, browser geolocation asks for permission if necessary. A granted permission is reused on later visits. The camera centres on the returned position, with a blue dot and an accuracy circle.
- My location requests a fresh high-accuracy fix and resumes following. Large movements or substantially better fixes update the camera; small GPS jitter does not restart flights.
- Submit a place or address to fly to the first geocoder match and display a labelled amber pin. Other matches remain selectable. House numbers and postcodes are preserved when supplied by the provider.
- Latitude, longitude searches work directly, for example `52.516275, 13.377704`. `My location`, `where am I`, `near me`, and `mein Standort` invoke device location.
- Searching, changing city, inspecting a place, dragging the map or entering replay stops following. Device updates can still move the blue dot without overriding the selected place. My location resumes following.
- Search and device symbols stay visible when the observation ring or public-data layers are hidden. Pending search flights are applied after the map loads.

Geolocation is controlled by the browser and device. A dot represents the returned position; the displayed accuracy describes its uncertainty. If permission is denied, enable location access for the site in browser settings, then press My location. Search works without location permission. Place searches use the Photon / OpenStreetMap public geocoder; coordinates identify its returned point, which can be a building, street or area centroid depending on the match.

The location tracker adds no persistent coordinate storage. Area requests still send the scan centre to the app's public-data endpoints, and existing Time Machine captures can include that scan centre.

Validation: all 70 unit, DOM, API and MapLibre-style checks pass. Tests cover precise coordinates, numbered address labels, camera intent before map load, permission failure, high-accuracy requests, stale responses, device updates after searching, GPS jitter and watch cleanup. Browser permission prompts and a physical device GPS fix need device/browser testing; this workspace has no browser automation tool.
