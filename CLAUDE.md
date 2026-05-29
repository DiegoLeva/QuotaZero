# CLAUDE.md — QuotaZero

Context for Claude Code working in this repo. Keep it short and current.

## What this is

A single-page web app for **cadastral field surveys** (rilievi catastali) in the province of Frosinone (Lazio, Italy). Surveyors open it on a phone/tablet in the field to:

- view aerial imagery (Google / Bing / AGEA) overlaid with the official **Agenzia delle Entrate** cadastral WMS (particelle, fabbricati, numeri particella) and, optionally, the **Isoipse** (5 m contour lines) WMS from the Regione Lazio geoportal with the elevation value (`cv_liv_q`) labeled along each polyline;
- search a parcel by *Comune / Foglio / Particella* and have its real polygon highlighted on the map;
- jump to a specific comune by name (centroid via PostGIS);
- view the **Punti Fiduciali (TAF)** of the current viewport as a toggleable layer, with popup linking to the official AdE monografia PDF;
- **add their own Punti Fiduciali** in the field (a dataset separate from the official TAF): Google-Earth-style centered-crosshair placement, a modal to enter a name + attach "spigolo"/"dettaglio" photos, persistence to a dedicated DB table, and a downloadable **ZIP package** (metadata + photos + 1:1000 satellite ortophoto + 1:2000 white-background cadastral extract);
- long-press the map to identify the parcel under the finger;
- import field surveys (`.kml` / `.geojson`) and toggle them as layers;
- launch a **Google Maps multi-waypoint route** for any imported layer (≥ 2 Points), starting from current GPS position and using the Points in KML order;
- measure distances;
- cache map tiles + KML state for **offline** use on site.

Deployed on **Vercel**.

## Architecture (it's intentionally tiny)

```
index.html                      # 100% of the frontend — vanilla JS + Leaflet, no build step
sw.js                           # service worker — intercepts tile requests for the four tile providers and serves from Cache (so saved offline tiles actually load when the device is offline)
api/cerca-particella.js         # serverless fn — PostGIS query, centroid of one parcel
api/cerca-comune.js             # serverless fn — PostGIS query, centroid of a whole comune
api/punti-fiduciali.js          # serverless fn — official Punti Fiduciali (TAF) by bbox (or comune), read-only
api/punti-rilievo.js            # serverless fn — CRUD of OUR added Punti Fiduciali (GET bbox / POST / PUT / DELETE)
api/particella-vicina.js        # serverless fn — nearest particella (comune/foglio/allegato/particella) to a lat/lng, PostGIS KNN

api/monografia.js               # serverless fn — resolves a fresh AdE PDF URL by scraping risultato.php
api/wms-proxy.js                # serverless fn — CORS proxy for WMS GetFeatureInfo / WFS / AGEA tiles / Google tiles (used by the ZIP ortophoto)
scripts/import-fiduciali.mjs    # one-shot importer for the TAF GeoJSON into `punti_fiduciali`
scripts/create-punti-rilievo.sql # one-shot DDL for the `punti_rilievo` table (run once in Neon console)
package.json                    # only dep: `pg` (used by the serverless fns)
```

No bundler, no framework, no transpiler. Frontend libraries are loaded from CDN inside `index.html`:
- Leaflet 1.9.4
- leaflet-omnivore 0.3.4 (KML → GeoJSON)
- JSZip 3.10.1 (builds the downloadable PF package)
- Material Symbols Rounded (icons)

## Key endpoints and external services

| Purpose | URL / source |
|---|---|
| Catasto WMS (parcels, buildings, labels) | `https://wms.cartografia.agenziaentrate.gov.it/inspire/wms/ows01.php` — CRS `EPSG:4258`, only responds at zoom ≥ 16 |
| Ortofoto AGEA 2012 | `https://wms.pcn.minambiente.it/ogc?map=...ortofoto_colore_12.map` |
| Isoipse Lazio (curve di livello 5 m) | `https://geoportale.regione.lazio.it/geoserver/ows` — layer `geonode:curve_livello`. The Lazio GeoServer **refuses inline `SLD_BODY`** (`Dynamic style usage is forbidden`), the only published style is unlabeled orange lines, **and it does not send CORS headers** — so the WFS call goes through `/api/wms-proxy`. The frontend fetches the layer as **WFS 1.0.0 GeoJSON** (`outputFormat=application/json`, `srsName=EPSG:4326`, bbox-filtered with the trailing `,EPSG:4326` CRS marker to stop GeoServer from interpreting the bbox in the layer's native EPSG:25833, `maxFeatures=600`) on every `moveend`/`zoomend` (debounced 320 ms). Each polyline is drawn with `L.geoJSON` in yellow `#ffcc33` on `isoipsePane` (z-index 475), and the `cv_liv_q` value is shown as a permanent Leaflet tooltip (class `.iso-tip`, neon-yellow text with a dark text-shadow halo) anchored at the polyline's midpoint. Hidden below zoom 13 to avoid pulling thousands of features. |
| Google Satellite tiles | `https://{mt0-3}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}` |
| Bing Satellite tiles | `https://ecn.t{0-3}.tiles.virtualearth.net/tiles/a{quadkey}.jpeg` (quadkey computed client-side) |
| Parcel lookup DB | Neon Postgres + PostGIS, table `particelle_catastali (comune, foglio, allegato, particella, geometry)` |
| Punti Fiduciali DB | Same Neon DB, table `punti_fiduciali (codice_pf, comune, foglio, allegato, particella, descrizione, namefile, geom)` — official TAF, read-only |
| Punti Fiduciali "miei" DB | Same Neon DB, table `punti_rilievo (id, comune, seq, nome, lat, lng, geom, created_at)` — PFs added in-app. DDL in `scripts/create-punti-rilievo.sql` (run manually once). |
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

## Backend contract — `/api/punti-rilievo`

CRUD of the **PFs added in-app** (table `punti_rilievo`). Distinct from the official `/api/punti-fiduciali`. Run `scripts/create-punti-rilievo.sql` in Neon once before deploy. Requires `DATABASE_URL`.

- `GET ?bbox=<w>,<s>,<e>,<n>` → `{ count, punti: [{ id, comune, seq, nome, lat, lng, createdAt }] }`. Without `bbox`, returns up to 2000 rows. PostGIS `ST_Intersects` on the GIST index.
- `POST` (JSON `{ comune, nome, lat, lng }`) → inserts and **assigns `seq` = next progressive for that `comune`** (`COALESCE(MAX(seq),0)+1` scoped by `comune IS NOT DISTINCT FROM`), counting only our rows. Returns the created row (with `seq`, `id`, `createdAt`).
- `PUT` (JSON `{ id, nome, lat?, lng? }`) → updates the name (and position if `lat`/`lng` provided). `seq`/`comune` are immutable so the package name stays stable.
- `DELETE ?id=<id>` → removes the row.
- Photos are **never** sent here (kept in-session only on the client). `comune`/`seq` exist purely to build the ZIP package name `{comune}PF_{seq} - {lat},{lng}.zip`.

## Backend contract — `/api/monografia`

`GET /api/monografia?co=<codice>&foglio=<n>&namefile=<filename>` → **HTTP 302 to the PDF**

- The AdE Monografie download URL has the shape `download.php?key=NNN&fs=15&dir=NNN&namefile=...`. The `key` is **server-generated and tied to a specific listing**; pre-baked URLs (as in the original GeoJSON) silently 404 or fall back to a default file. **Do not store full URLs** — store only the `namefile` and resolve at click time.
- This endpoint fetches `https://www1.agenziaentrate.gov.it/servizi/Monografie/risultato.php?co=<co>&foglio=<foglio>` (works anonymously over GET, no cookies), greps the HTML for the requested `namefile`, extracts the matching `key/fs/dir`, and `302`s the user to the fresh download URL.
- If the `namefile` is not found in the listing (foglio mismatch, retired PF, etc.), it falls back to `302` → the result page itself, so the user can still browse. The frontend opens the bottone with `target="_blank"`, so this all happens in a separate tab.
- No env vars needed; one outbound HTTP call to AdE per click. ~500–1000 ms typical.

## Backend contract — `/api/wms-proxy`

`GET /api/wms-proxy?url=<encoded OGC base URL>&<extra WMS params…>`

Pass-through OGC proxy. Reads the target endpoint from the `url` query parameter and forwards every other query parameter onto it before fetching. Sends permissive CORS headers and handles binary responses (images, PDFs) with `arrayBuffer` so they aren't corrupted by text decoding. Used by:
- **AdE WMS GetFeatureInfo** (long-press identify): frontend falls back to a direct fetch if the proxy fails on that path.
- **Isoipse WFS** against the Regione Lazio GeoServer, which doesn't send CORS headers — the call must go through the proxy or the browser blocks it.
- **AGEA WMS tiles** (Geoportale Nazionale Ortofoto 2012): the upstream server redirects HTTPS requests to HTTP for tile delivery, which the browser blocks as Mixed Content. The proxy fetches server-side and returns the JPEG over HTTPS. Frontend constructs the layer with `L.tileLayer.wms("/api/wms-proxy?url=" + encodeURIComponent(PCN_AGEA_URL), {...})` — Leaflet appends `LAYERS/BBOX/WIDTH/...` as extra query params, and the proxy stitches them onto the WMS endpoint. The proxy sets `Cache-Control: public, max-age=86400, s-maxage=604800` on image responses so Vercel CDN can absorb most of the load.
- **Google satellite tiles & AdE WMS GetMap, for the PF ZIP package**: the ZIP image builders fetch Google tiles and AdE GetMap responses through the proxy so the composited canvas stays **same-origin** (cross-origin tiles would taint the canvas and break `toBlob`/export). The Google tile URL is passed whole as `url=` (its own `lyrs/x/y/z` query is preserved by `new URL()`).

Because AGEA now flows through the proxy (same-origin), `wms.pcn.minambiente.it` is **no longer** in the `sw.js` tile host patterns.

## Conventions worth keeping

- **No comments in code unless the *why* is non-obvious.** The repo's existing code already follows this — keep it that way.
- All UI strings are **in Italian**. So are commit messages and toasts.
- Visual style is a deliberate **cyberpunk/HUD** look (neon cyan `#00f5ff`, danger pink `#ff2d6f`, lime `#a5ff2f`). CSS variables live at the top of the `<style>` block in `index.html`. Don't drift away from this palette without asking.
- State persists in `localStorage` under key `quotazero_state_v1` (current map view + imported KMLs, saved by the "Salva area di rilievo" button). **UI preferences** persist independently under key `quotazero_prefs_v1`, auto-saved on every change. Schema: `{ background: { active: "google"|"bing"|"agea", opacity: 0..1 }, globalOpacity: 0..1, parcels: {visible, opacity, color}, buildings: {...}, labels: {...}, fiduciali: {...}, rilievo: {visible, opacity, color}, isoipse: {visible, opacity, color, labels} }`. `rilievo` styles OUR added PFs (default visible, pink `#ff2d6f`). Background is a single mutually-exclusive selector (the chosen base layer is added to the map, the other two are removed). The **effective opacity** of every overlay layer (everything except background) is `prefs[key].opacity * prefs.globalOpacity` — the global slider acts as a master multiplier on top of per-layer fine-tuning. `prefs.isoipse.labels` is a boolean that toggles the contour-value tooltips without removing the polylines. Offline tile cache uses the Cache API under name `quotazero-tiles-v1`. **Bump the version suffix** if you make a breaking change to any of these schemas.
- Layer z-index is managed via named Leaflet panes — see the array at ~line 581 of `index.html`. New raster layers should go in a dedicated pane, not the default one. Our added PFs live on `rilievoPane` (z 466).
- **Adding a PF / ZIP package** (in `index.html`): a centered fixed `.pf-crosshair` + `.pf-placebar` drive placement (the point is `map.getCenter()`, no draggable marker — pan the map under the crosshair). `lookupParcelInfo()` fills comune/foglio/particella: first `reverseParcel()` (AdE GetFeatureInfo, fixed ~4 m bbox so it resolves at any zoom — the exact parcel under the point), then falls back to `/api/particella-vicina` (PostGIS `<->` KNN nearest parcel) when the point is outside any parcel (flagged `approx`). Those three fields are **editable `<input>`s** (the comune feeds `seq`/package naming on save); the name field is **pre-filled** with `PF{foglio}{allegato}-{particella}` and live-updates as you edit foglio/particella, unless the user types their own. The edit modal has a **Sposta** button that re-enters placement for an existing point (keeping photos) and recomputes everything on OK; `seq`/`comune` stay stable on the DB even if the point crosses a comune. The generated images carry **no center marker** (the point is implied by the centered framing). The ZIP (`JSZip` from CDN) bundles: `metadata.txt`, the in-session photos, `ortofoto_1000.jpg` (square 1772 px ≈ 150 m ground, composed from **Google tiles routed through `/api/wms-proxy`** so the canvas stays same-origin and exportable), and `mappa_catastale_2000.png` (945×709 ≈ 160×120 m, white bg, three AdE WMS GetMap calls via proxy with SLD: parcels = thin black stroke/no fill, fabbricati = `#999999` fill + double-width black stroke, `codice_plla` = particella numbers in black). The px↔ground math assumes a 300 DPI print at the stated scales; keep both images consistent if you change one. `metadata.txt` also appends **computed coordinates**: geographic (ETRF2000/WGS84, = the stored lat/lng) and UTM-ETRF2000 (zone + Est/Nord, via `toUtmEtrf2000()`, a Snyder-series TM forward on the WGS84 ellipsoid). Gauss-Boaga / Cassini-Soldner / geocentric / elevations are intentionally omitted — not derivable from lat/lng without a datum-shift grid or ellipsoidal height.
- **Gestione PF** section (bottom of the left sidebar): bulk ops on OUR added PFs. `exportRilievoGeojson()` GETs all `/api/punti-rilievo` (no bbox) → downloads a GeoJSON FeatureCollection (Point geom, props: id/comune/seq/nome/createdAt; **no photos**). `importRilievoGeojson(file)` parses a GeoJSON and, for each `Point`, **dedups by proximity**: it first GETs existing PFs and if the incoming point is within `RILIEVO_DEDUP_M` (2 m, via `metersBetween()`) of an unused existing one it PUTs (updates name+position, `seq`/`comune` stay immutable per the contract) instead of POSTing — so re-importing your own export updates in place rather than duplicating. New points are POSTed (server assigns `seq`). `deleteAllRilievo()` fetches all then DELETEs them one by one (no bulk-delete endpoint), behind a `confirm()`.
- PF markers (both official `fiduciariPane` and our `rilievoPane`) are `L.circleMarker` radius 9 / weight 2. The raster panes (`agea/bing/google/parcel/building/label`) are set `pointer-events:none` so the label tiles (z 470, above the markers) don't steal clicks — markers must stay clickable.

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
- Offline tile caching: `saveOffline()` populates the `TILE_CACHE` via `fetch(req, {mode:'no-cors'}) + cache.put(req, resp)`. **Do not switch to `cache.add()`** — it rejects opaque (status 0) responses, which is why the original implementation silently cached nothing. The `no-cors` mode is required because Google/Bing tile servers don't return CORS headers; the trade-off is that responses are opaque and only readable via the SW's `fetch` handler, not from JS.
- `sw.js` is what makes the offline cache actually usable: Leaflet loads tiles via `<img>` tags, so without a SW intercepting the network request and serving from Cache, the cached entries would never be hit. If you add a new tile provider, also add its hostname pattern to `TILE_HOST_PATTERNS` in `sw.js`.
- The long-press timer is `720 ms` — tuned for touchscreens. Changing it will affect mobile UX.
