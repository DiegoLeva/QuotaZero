# CLAUDE.md — App Rilievi Pro

Context for Claude Code working in this repo. Keep it short and current.

## What this is

A single-page web app for **cadastral field surveys** (rilievi catastali) in the province of Frosinone (Lazio, Italy). Surveyors open it on a phone/tablet in the field to:

- view aerial imagery (Google / Bing / AGEA) overlaid with the official **Agenzia delle Entrate** cadastral WMS (particelle, fabbricati, numeri particella);
- search a parcel by *Comune / Foglio / Particella* and have its real polygon highlighted on the map;
- long-press the map to identify the parcel under the finger;
- import field surveys (`.kml` / `.geojson`) and toggle them as layers;
- measure distances;
- cache map tiles + KML state for **offline** use on site.

Deployed on **Vercel**.

## Architecture (it's intentionally tiny)

```
index.html                      # 100% of the frontend — vanilla JS + Leaflet, no build step
api/cerca-particella.js         # Vercel serverless fn — Postgres/PostGIS spatial query
api/wms-proxy.js                # Vercel serverless fn — CORS proxy for WMS GetFeatureInfo
package.json                    # only dep: `pg` (used by the serverless fn)
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

## Backend contract — `/api/cerca-particella`

`GET /api/cerca-particella?comune=<codice>&foglio=<n>&particella=<n>&allegato=<lettera>`

- `comune` is the ISTAT/Belfiore code (e.g. `D810` = Frosinone). The list of supported codes is hard-coded in the `<select id="searchComune">` inside `index.html` — currently the ~80 comuni of the Frosinone province.
- Foglio/particella are matched with leading zeros stripped, against both forms.
- `allegato` is optional: empty (or missing) matches rows where the DB column is `NULL` (most parcels); a letter like `A` / `B` matches that specific allegato. The match uses `IS NOT DISTINCT FROM` so `NULL = NULL` is treated as equal. The frontend splits user input like `5A` into `foglio=5` + `allegato=A` before calling the endpoint.
- Returns `{ centro: [lat, lng] }` on hit, `404` on miss. (The geometry column on the DB is still queried implicitly through `ST_Centroid`, but the polygon itself is not serialized — the frontend currently only centers the map and shows a popup.)
- Requires env var `DATABASE_URL` (Neon connection string with `?sslmode=require`).

## Backend contract — `/api/wms-proxy`

`GET /api/wms-proxy?url=<encoded WMS URL>`

Pass-through proxy that fetches the URL server-side and returns the body. Exists only to bypass CORS on the Agenzia delle Entrate WMS for `GetFeatureInfo` calls. Frontend falls back to a direct fetch if the proxy fails.

## Conventions worth keeping

- **No comments in code unless the *why* is non-obvious.** The repo's existing code already follows this — keep it that way.
- All UI strings are **in Italian**. So are commit messages and toasts.
- Visual style is a deliberate **cyberpunk/HUD** look (neon cyan `#00f5ff`, danger pink `#ff2d6f`, lime `#a5ff2f`). CSS variables live at the top of the `<style>` block in `index.html`. Don't drift away from this palette without asking.
- State persists in `localStorage` under key `georilievo_pro_state_v3`. Offline tile cache uses the Cache API under name `georilievo-pro-tiles-v2`. **Bump the version suffix** if you make a breaking change to either schema.
- Layer z-index is managed via named Leaflet panes — see the array at ~line 581 of `index.html`. New raster layers should go in a dedicated pane, not the default one.

## Running / deploying

- Local: any static server pointed at the repo root works for the frontend, but `/api/*` only runs under `vercel dev` (or in production). Without it, parcel search and the WMS proxy fall back / fail gracefully.
- Production: push to the connected Vercel project. `DATABASE_URL` must be set in Vercel env vars.

## Things to double-check before changing

- The cadastral WMS is rate-limited and slow. Don't add layers that hit it on every map move.
- `caches.add(...)` in `saveOffline()` uses `mode: 'no-cors'` — required for cross-origin tile providers, but it means you can't read the cached responses, only serve them. Don't "fix" this.
- The long-press timer is `720 ms` — tuned for touchscreens. Changing it will affect mobile UX.
