# God Eye Berlin

## [▶ Open God Eye Berlin](https://around-me-berlin-gods-eye.arsalanhaider.chatgpt.site)

The public app opens directly. **No ChatGPT account, GitHub account, sign-in or access request is required.**

Berlin transit, stations, history, geography, public activity, animated observed rain radar, model weather fields and clearly labelled simulations share a cinematic map. Place/address search flies to a labelled pin. Device location uses browser permission and shows reported accuracy.

Version 3 adds **World data** and **Mission control**: 30 source controls, global globe view, terrain, satellite predictions and ground tracks, quakes, launches, wildfire/cyclone context, public infrastructure, mapped cameras, Panoramax photos, news, wildlife, radio, directions, contact tracking, scenes, annotations, display looks and shareable views. Every feed identifies its source and coverage. Some controls explicitly report unavailable or missing-provider states.

The requested reference is [Bilawal Sidhu’s God’s Eye View](https://github.com/bilawalsidhu/gods-eye-view). **This public integration is not full feature parity.** See the [52-family comparison](docs/UPSTREAM-PARITY.md) for exactly what works and what still needs implementation, keys or a persistent backend. The [complete original engine](docs/ORIGINAL-ENGINE.md) is pinned under `vendor/gods-eye-view` for running the original stack.

### Run this app

```sh
npm ci
npm run dev
```

Build: `npm run build`. Check: `npm run check`. Tests: `npm test`. The source builds a Worker with embedded frontend assets. Hosting identity is in `.openai/hosting.json`.

[Location behaviour](docs/LOCATION.md) · [Source families and gaps](docs/UPSTREAM-PARITY.md) · [Original license and data terms](docs/licenses/gods-eye-view-LICENSE.txt)

Public source data may be delayed or incomplete. Simulation, model fields, predicted orbits and observed data are labelled separately. Third-party data and imagery retain their source terms.
