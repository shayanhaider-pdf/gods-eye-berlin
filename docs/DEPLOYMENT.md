# Build and hosting

## Build and test

Use Node.js 24 or later:

```sh
npm ci
npm run build
npm run check
npm test
```

The build produces a Cloudflare Worker ES module at dist/server/index.js with the frontend assets embedded. The app requires server-backed API routes and cannot run as a plain GitHub Pages static site without adapting those routes.

## Local use

```sh
npm run dev
```

The local server binds to 127.0.0.1 by default and serves the same Worker implementation. PORT may select a different local port. Public feeds may be unavailable or rate limited; source failures are exposed by the app.

## Existing deployment

https://around-me-berlin-gods-eye.arsalanhaider.chatgpt.site

The existing Sites identity is retained in .openai/hosting.json. Source upload and production publication require an authorized Sites connection; there are no deployment credentials in this repository. scripts/prepare-source.mjs is a Sites-specific helper that accepts a short-lived credential through stdin. Do not place credentials in repository files.

A GitHub commit does not automatically publish a new Sites version. Until a dedicated deployment workflow is configured, application changes must be built, verified and explicitly deployed to the existing Site.
