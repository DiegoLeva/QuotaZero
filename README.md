# App Rilievi Pro

Web-app per **rilievi catastali sul campo** nella provincia di Frosinone (Lazio).

Pensata per essere usata da smartphone o tablet durante i sopralluoghi: sovrappone le mappe catastali ufficiali dell'**Agenzia delle Entrate** alle ortofoto satellitari (Google, Bing, AGEA), permette di cercare una particella per *Comune / Foglio / Numero*, di disegnarne i confini reali sulla mappa, di importare rilievi KML/GeoJSON e di lavorare anche **offline** una volta scaricata l'area di interesse.

L'interfaccia è in stile HUD/cyberpunk (cyan neon, rosa, lime) con tutti i comandi a portata di pollice.

---

## Cosa fa

### Mappa e livelli
- **Sfondi satellitari** commutabili: Google Satellite (default), Bing Satellite, Ortofoto AGEA 2012 (Geoportale Nazionale).
- **Catasto Agenzia delle Entrate** via WMS, sovrapposto come tre livelli indipendenti:
  - **Particelle** (confini in bianco)
  - **Fabbricati** (sagome in rosso scuro)
  - **Numeri particella** (etichette gialle, visibili da zoom 18 in su)
- Slider per regolare l'opacità del catasto.
- Il catasto risponde solo a scala alta: i livelli si attivano automaticamente da zoom 16.

### Ricerca particella
Dal pannello laterale si sceglie il **Comune** della provincia di Frosinone (tutti gli ~80 comuni sono in elenco), si digitano **Foglio** e **Particella**, e l'app:

1. interroga il database geospaziale PostGIS;
2. centra la mappa sul centroide della particella;
3. disegna il poligono reale (non solo un marker) in rosa neon sopra la mappa;
4. mostra un popup con il riepilogo.

### Interrogazione interattiva
Tieni premuto sulla mappa (o tasto destro su desktop) sopra una particella: l'app interroga il WMS dell'Agenzia delle Entrate e mostra in un banner i dati di **Comune / Foglio / Particella**.

### Import dei rilievi
Carica uno o più file **KML** o **GeoJSON**: vengono aggiunti come livelli indipendenti, attivabili/disattivabili singolarmente. I KML con più cartelle (`<Folder>`) vengono splittati automaticamente in un livello per cartella. Ogni punto del rilievo ha un popup con il link a Google Maps per la navigazione.

### Strumenti sul campo
- **Misura distanza**: tocchi successivi sulla mappa creano una polilinea con il totale in metri/km.
- **La mia posizione (GPS)**: centra la mappa sulla posizione corrente con cerchio di accuratezza.
- **Modalità offline**: salva lo stato (KML importati, vista corrente) in `localStorage` e pre-scarica i tasselli di mappa satellitare e catastale dell'area dei KML caricati (zoom 17–18) nella Cache API del browser. Sul campo, senza connessione, basta "Ricarica offline".

---

## Architettura

```
index.html                      # Tutta l'app frontend (vanilla JS + Leaflet)
api/cerca-particella.js         # Funzione serverless: query spaziale PostGIS
api/wms-proxy.js                # Funzione serverless: proxy CORS per il WMS catastale
package.json
```

### Stack
- **Frontend**: HTML/CSS/JS senza framework, [Leaflet 1.9.4](https://leafletjs.com/), [leaflet-omnivore](https://github.com/mapbox/leaflet-omnivore) per il parsing KML, Material Symbols per le icone. Nessuna build step.
- **Backend**: due funzioni serverless Node.js su **Vercel**.
- **Database**: PostgreSQL + **PostGIS** su [Neon](https://neon.tech/), tabella `particelle_catastali` con le geometrie dei lotti.

### Servizi esterni utilizzati
| Servizio | Uso |
|---|---|
| WMS Agenzia delle Entrate (`wms.cartografia.agenziaentrate.gov.it`) | Particelle, fabbricati, numeri |
| WMS Geoportale Nazionale (`wms.pcn.minambiente.it`) | Ortofoto AGEA 2012 |
| Google Satellite tiles | Sfondo satellitare principale |
| Bing/Virtual Earth tiles | Sfondo satellitare alternativo |
| Neon Postgres + PostGIS | Ricerca particella per Foglio/Numero |

---

## Avvio in locale

L'app frontend è statica, ma le route `/api/*` richiedono Vercel.

```bash
npm install
npx vercel dev
```

Apri quindi `http://localhost:3000`.

> ⚠️ **GPS in locale**: i browser bloccano la geolocalizzazione sui file aperti via `file://`. Usa sempre `vercel dev` o un server HTTP, oppure pubblica l'app per testare il GPS dal cellulare.

### Variabili d'ambiente

Una sola, obbligatoria per la ricerca particella:

```
DATABASE_URL=postgresql://<user>:<pass>@<host>/<db>?sslmode=require
```

Va impostata sia in locale (`.env.local` letto da `vercel dev`) sia nelle Environment Variables del progetto Vercel in produzione.

Console Neon del progetto: <https://console.neon.tech/app/projects/holy-darkness-39302800>

### Schema del database (sintetico)

```sql
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE particelle_catastali (
  comune      text,         -- codice Belfiore, es. 'D810'
  foglio      text,
  particella  text,
  geometry    geometry(MultiPolygon, 4326)
);

CREATE INDEX ON particelle_catastali USING GIST (geometry);
CREATE INDEX ON particelle_catastali (comune, foglio, particella);
```

### Popolamento del DB dai file GML del Catasto

I dati partono dai file GML INSPIRE dell'Agenzia delle Entrate (`*_ple.gml`, uno per Comune). Per caricarli su Neon si usa `ogr2ogr` (incluso in QGIS) direttamente da PowerShell.

> **Nota**: le geometrie vengono **semplificate con tolleranza 1** (≈ 1 grado, di fatto un triangolo per particella). È una scelta deliberata per **risparmiare spazio sul DB** — l'app non disegna più il poligono, le serve solo il centroide per centrare la mappa. Se in futuro serviranno i confini reali, rifare l'import senza l'opzione `-simplify`.

```powershell
$ogr   = "C:\Program Files\QGIS 3.44.10\bin\ogr2ogr.exe"
$pg    = "PG:host=ep-old-glade-al3cw8um.c-3.eu-central-1.aws.neon.tech dbname=neondb user=DB_USER password=DB_PASSWORD sslmode=require"
$src   = "C:\path\alla\cartella\con\i\file_ple.gml"
$sql   = "SELECT msGeometry, ADMINISTRATIVEUNIT AS comune, ltrim(substr(NATIONALCADASTRALREFERENCE, instr(NATIONALCADASTRALREFERENCE,'_')+1, 4),'0') AS foglio, ltrim(LABEL,'0') AS particella FROM CadastralParcel"

$mode = "-overwrite"
Get-ChildItem -Path $src -Filter "*_ple.gml" | ForEach-Object {
    Write-Host "=== $($_.Name)  ($mode) ===" -ForegroundColor Cyan
    & $ogr -f PostgreSQL $pg $_.FullName -dialect SQLITE -sql $sql `
        -nln particelle_catastali -nlt PROMOTE_TO_MULTI -t_srs EPSG:4326 `
        -simplify 1 `
        -lco GEOMETRY_NAME=geometry -lco FID=id -lco SPATIAL_INDEX=GIST `
        $mode -progress
    $mode = "-append"
}
Write-Host "===== FATTO =====" -ForegroundColor Green
```

Cosa fa lo script, in breve:

- itera tutti i `*_ple.gml` nella cartella `$src`;
- usa il dialetto SQLite di OGR per estrarre da `CadastralParcel` il **codice Comune** (`ADMINISTRATIVEUNIT`), il **foglio** e la **particella** parsando il campo `NATIONALCADASTRALREFERENCE`, rimuovendo gli zeri iniziali con `ltrim`;
- riproietta le geometrie a **EPSG:4326** e le promuove a MultiPolygon;
- crea automaticamente la tabella `particelle_catastali` (con `-overwrite` al primo file) e poi appende i successivi (`-append`);
- crea l'indice spaziale GIST sulla colonna `geometry`.

Da rilanciare quando si aggiunge un Comune nuovo o quando l'Agenzia delle Entrate pubblica un aggiornamento dei GML.

---

## Deploy

Push sul branch principale: Vercel costruisce e pubblica automaticamente. Niente CI custom, niente Docker. Ricordati di settare `DATABASE_URL` nel pannello Vercel.

---

## Note operative

- Il catasto AdE è lento e rate-limited: usalo con moderazione, evita di richiederlo a ogni movimento della mappa.
- La cache offline è limitata a circa **1200 tasselli** per non saturare lo storage del browser. È sufficiente per qualche kmq a zoom 17–18.
- Le chiavi di `localStorage` (`georilievo_pro_state_v3`) e di Cache API (`georilievo-pro-tiles-v2`) sono versionate: cambia il suffisso se modifichi lo schema dello stato salvato, altrimenti i vecchi dispositivi si rompono.

---

## Licenza

Progetto privato. Tutti i diritti riservati.

I dati catastali e le ortofoto sono forniti da Agenzia delle Entrate, Ministero dell'Ambiente (Geoportale Nazionale), Google e Microsoft, ciascuno con le proprie condizioni d'uso.
