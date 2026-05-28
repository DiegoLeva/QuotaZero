# CLAUDE.md — App Rilievi Pro

Context for Claude Code working in this repo. Keep it short and current.

## What this is

A single-page web app for **cadastral field surveys** (rilievi catastali) in the province of Frosinone (Lazio, Italy). Surveyors open it on a phone/tablet in the field to:

- view aerial imagery (Google / Bing / AGEA) overlaid with the official **Agenzia delle Entrate** cadastral WMS (particelle, fabbricati, numeri particella);
- search a parcel by *Comune / Foglio / Particella* and have its real polygon highlighted on the map;
- jump to a specific comune by name (centroid via PostGIS);
- view the **Punti Fiduciali (TAF)** of the current viewport as a toggleable layer, with popup linking to the official AdE monografia PDF;
- long-press the map to identify the parcel under the finger;
- import field surveys (`.kml` / `.geojson`) and toggle them as layers;
- measure distances;
- cache map tiles + KML state for **offline** use on site.

Deployed on **Vercel**.

## Architecture (it's intentionally tiny)

```
index.html                      # 100% of the frontend — vanilla JS + Leaflet, no build step
api/cerca-particella.js         # serverless fn — PostGIS query, centroid of one parcel
api/cerca-comune.js             # serverless fn — PostGIS query, centroid of a whole comune
api/punti-fiduciali.js          # serverless fn — Punti Fiduciali by bbox (or comune)
api/monografia.js               # serverless fn — resolves a fresh AdE PDF URL by scraping risultato.php
api/wms-proxy.js                # serverless fn — CORS proxy for WMS GetFeatureInfo
scripts/import-fiduciali.mjs    # one-shot importer for the TAF GeoJSON into `punti_fiduciali`
package.json                    # only dep: `pg` (used by the serverless fns)
```

No bundler, no framework, no transpiler. Frontend libraries are loaded from CDN inside `index.html`:
- Leaflet 1.9.4
- leaflet-omnivore 0.3.4 (KML → GeoJSON)
- Material Symbols Rounded (icons)

## Key endpoints and external services

| Purpose | URL / source |
|---|---|
| Catasto WMS (parcels, buildings, labels) | `https://wms.cartografia.agenziaentrate.gov.it/inspire/wms/ows01.php` — CRS `EPSG:4258`, only responds at zoom ≥ 16 |
| Ortofoto AGEA 2012 | `https://wms.pcn.minambiente.it/ogc?map=...ortofoto_colore_12.map` |
| Google Satellite tiles | `https://{mt0-3}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}` |
| Bing Satellite tiles | `https://ecn.t{0-3}.tiles.virtualearth.net/tiles/a{quadkey}.jpeg` (quadkey computed client-side) |
| Parcel lookup DB | Neon Postgres + PostGIS, table `particelle_catastali (comune, foglio, allegato, particella, geometry)` |
| Punti Fiduciali DB | Same Neon DB, table `punti_fiduciali (codice_pf, comune, foglio, allegato, particella, descrizione, namefile, geom)` |
| AdE Monografie portal | `https://www1.agenziaentrate.gov.it/servizi/Monografie/` — scraped by `/api/monografia` to resolve fresh PDF URLs (the `key` in download links is server-generated and not stable, see backend contract below) |

## Backend contract — `/api/cerca-particella`

`GET /api/cerca-particella?comune=<codice>&foglio=<n>&particella=<n>&allegato=<lettera>`

- `comune` is the ISTAT/Belfiore code (e.g. `D810` = Frosinone). The list of supported codes is hard-coded in the `<select id="searchComune">` inside `index.html` — currently the ~80 comuni of the Frosinone province.
- Foglio/particella are matched with leading zeros stripped, against both forms.
- `allegato` is optional: empty (or missing) matches rows where the DB column is `NULL` (most parcels); a letter like `A` / `B` matches that specific allegato. The match uses `IS NOT DISTINCT FROM` so `NULL = NULL` is treated as equal. The frontend splits user input like `5A` into `foglio=5` + `allegato=A` before calling the endpoint.
- Returns `{ centro: [lat, lng] }` on hit, `404` on miss. (The geometry column on the DB is still queried implicitly through `ST_Centroid`, but the polygon itself is not serialized — the frontend currently only centers the map and shows a popup.)
- Requires env var `DATABASE_URL` (Neon connection string with `?sslmode=require`).

## Backend contract — `/api/cerca-comune`

`GET /api/cerca-comune?comune=<codice>`

Returns `{ centro: [lat, lng] }` — centroid of the **union** of all particelle of that Belfiore code. Used by the "Vai al comune" search dialog. `404` if the comune has no rows in `particelle_catastali`.

## Backend contract — `/api/punti-fiduciali`

`GET /api/punti-fiduciali?bbox=<w>,<s>,<e>,<n>` *(preferred — viewport mode)*
`GET /api/punti-fiduciali?comune=<codice>` *(legacy — load all PFs of one comune)*

- `bbox` is the current Leaflet `map.getBounds()` as `west,south,east,north` in EPSG:4326. PostGIS uses `ST_MakeEnvelope(...)::geography` + `ST_Intersects` against the GIST index. Hard-capped at `LIMIT 2000`.
- Returns `{ count, punti: [{ codice, comune, foglio, allegato, particella, descrizione, namefile, lat, lng }, ...] }`.
- `namefile` is the variable part of the AdE PDF URL (e.g. `A032-0100-07`) — we strip the unstable `key/fs/dir` and only store the filename. Format: `{COMUNE}-{FOGLIO×10 padded to 4 digits}-{PF prefix 2 digits}`.
- Response is HTTP-cached `s-maxage=86400` since the dataset is essentially static.

## Backend contract — `/api/monografia`

`GET /api/monografia?co=<codice>&foglio=<n>&namefile=<filename>` → **HTTP 302 to the PDF**

- The AdE Monografie download URL has the shape `download.php?key=NNN&fs=15&dir=NNN&namefile=...`. The `key` is **server-generated and tied to a specific listing**; pre-baked URLs (as in the original GeoJSON) silently 404 or fall back to a default file. **Do not store full URLs** — store only the `namefile` and resolve at click time.
- This endpoint fetches `https://www1.agenziaentrate.gov.it/servizi/Monografie/risultato.php?co=<co>&foglio=<foglio>` (works anonymously over GET, no cookies), greps the HTML for the requested `namefile`, extracts the matching `key/fs/dir`, and `302`s the user to the fresh download URL.
- If the `namefile` is not found in the listing (foglio mismatch, retired PF, etc.), it falls back to `302` → the result page itself, so the user can still browse. The frontend opens the bottone with `target="_blank"`, so this all happens in a separate tab.
- No env vars needed; one outbound HTTP call to AdE per click. ~500–1000 ms typical.

## Backend contract — `/api/wms-proxy`

`GET /api/wms-proxy?url=<encoded WMS URL>`

Pass-through proxy that fetches the URL server-side and returns the body. Exists only to bypass CORS on the Agenzia delle Entrate WMS for `GetFeatureInfo` calls. Frontend falls back to a direct fetch if the proxy fails.

## Conventions worth keeping

- **No comments in code unless the *why* is non-obvious.** The repo's existing code already follows this — keep it that way.
- All UI strings are **in Italian**. So are commit messages and toasts.
- Visual style is a deliberate **cyberpunk/HUD** look (neon cyan `#00f5ff`, danger pink `#ff2d6f`, lime `#a5ff2f`). CSS variables live at the top of the `<style>` block in `index.html`. Don't drift away from this palette without asking.
- State persists in `localStorage` under key `georilievo_pro_state_v3`. Offline tile cache uses the Cache API under name `georilievo-pro-tiles-v2`. **Bump the version suffix** if you make a breaking change to either schema.
- Layer z-index is managed via named Leaflet panes — see the array at ~line 581 of `index.html`. New raster layers should go in a dedicated pane, not the default one.

## Keeping the docs in sync

**Whenever you add or substantially change a feature, endpoint, table, or external dependency, update BOTH this file (`CLAUDE.md`) AND `README.md` in the same commit.**

- `README.md` is the human-facing project doc (Italian, end-user / new-contributor oriented). Read it at the start of any non-trivial task so your changes don't contradict what's already documented for the user.
- `CLAUDE.md` is the agent-facing context (English, terse, technical). Keep it short and current — prune stale notes instead of letting them rot.
- Examples of "substantial": new API endpoint, new DB table or column, new layer/toggle in the UI, change to a contract (request/response shape, env var, storage key), new external service dependency, change to the deploy or import flow. Bug fixes and small refactors don't need doc updates unless they change a contract.
- If you remove or rename something documented here or in the README, remove/rename it in the docs too.

## Running / deploying

- Local: any static server pointed at the repo root works for the frontend, but `/api/*` only runs under `vercel dev` (or in production). Without it, parcel search and the WMS proxy fall back / fail gracefully.
- Production: push to the connected Vercel project. `DATABASE_URL` must be set in Vercel env vars.

## Things to double-check before changing

- The cadastral WMS is rate-limited and slow. Don't add layers that hit it on every map move.
- `caches.add(...)` in `saveOffline()` uses `mode: 'no-cors'` — required for cross-origin tile providers, but it means you can't read the cached responses, only serve them. Don't "fix" this.
- The long-press timer is `720 ms` — tuned for touchscreens. Changing it will affect mobile UX.
