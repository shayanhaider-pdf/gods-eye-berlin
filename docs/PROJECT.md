# Project brief

God Eye Berlin (also called Around Me) combines publicly available information about the surrounding area in a God’s Eye-style map. Berlin is the primary city. Selected US views have more limited coverage.

## Current delivery

Version 2 is publicly accessible at https://around-me-berlin-gods-eye.arsalanhaider.chatgpt.site. Visitors can open it directly from this repository without signing in to ChatGPT or GitHub. Its source was originally developed in the connected Sites workspace and is now maintained here as a complete GitHub snapshot.

Implemented: selectable transport modes and named stations; history, architecture, memorials, culture, geography and park layers; public activity and departure data; animated people, vehicles and activity scenes; flying tours; rain radar, model weather and aircraft layers; district pulse, rule-based signals, connection tracing and browser-recorded replay.

The initial snapshot includes 116 attributed historical/reference places and published VBB route geometries. Simulated movement is illustrative, not tracking. Earlier observations and typical-day baselines are not invented. See README and source notes for provider and coverage limits.

## Verification

The v2 build passed 61 automated tests before publication, including DOM controls, API validation, partial-provider failures, transit geometry, simulation contracts, source attribution and replay logic. Real browser layout/WebGL verification remains a separate QA step documented in QA-plan.md.

## Original project notes

The project is also tracked in Notion as “Around Me | Berlin Public Activity”. The repository contains the implementation and a concise project record; it does not copy unrelated private workspace content.
