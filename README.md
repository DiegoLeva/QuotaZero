# QuotaZero

Web-app per **rilievi catastali sul campo** nella provincia di Frosinone (Lazio).

Pensata per essere usata da smartphone o tablet durante i sopralluoghi: sovrappone le mappe catastali ufficiali dell'**Agenzia delle Entrate** alle ortofoto satellitari (Google, Bing, AGEA), permette di cercare una particella per *Comune / Foglio / Numero*, di disegnarne i confini reali sulla mappa, di importare rilievi KML/GeoJSON e di lavorare anche **offline** una volta scaricata l'area di interesse.

L'interfaccia è in stile HUD/cyberpunk (cyan neon, rosa, lime) con tutti i comandi a portata di pollice.

---

## Cosa fa

### Mappa e livelli
- **Sfondi satellitari** commutabili: Google Satellite (default), Bing Satellite, Ortofoto AGEA 2012 (Geoportale Nazionale).
- **Isoipse (curve di livello)**: layer attivabile, fornito dal WMS del Geoportale Regione Lazio (`geonode:curve_livello`, salto di quota 5 m). Le polilinee sono renderizzate in giallo `#ffcc33` con il valore di quota (`cv_liv_q`) etichettato lungo la curva tramite `SLD_BODY` (LinePlacement + `followLine`, halo scuro per essere leggibili anche sopra l'ortofoto). Disegnato sopra al catasto, così resta visibile.
- **Catasto Agenzia delle Entrate** via WMS, sovrapposto come tre livelli indipendenti:
  - **Particelle** (confini in bianco)
  - **Fabbricati** (sagome in rosso scuro)
  - **Numeri particella** (etichette gialle, visibili da zoom 18 in su)
- **Punti Fiduciali (TAF)**: layer attivabile che mostra i punti fiduciali del Catasto sotto forma di pallini cyan, caricati dinamicamente in base al viewport (zoom minimo 14). Il popup di ogni punto mostra `Codice PF`, descrizione, foglio/particella e include due bottoni: **Naviga** (Google Maps) e **Monografia** (apre il PDF ufficiale dell'Agenzia delle Entrate in una nuova scheda — vedi nota sotto).
- Slider per regolare l'opacità del catasto.
- Il catasto risponde solo a scala alta: i livelli si attivano automaticamente da zoom 16.

### Ricerca particella
Dal pannello laterale si sceglie il **Comune** della provincia di Frosinone (tutti gli ~80 comuni sono in elenco), si digitano **Foglio** e **Particella**, e l'app:

1. interroga il database geospaziale PostGIS;
2. centra la mappa sul centroide della particella;
3. disegna il poligono reale (non solo un marker) in rosa neon sopra la mappa;
4. mostra un popup con il riepilogo.

C'è anche un pulsante separato **Vai al comune** che apre una ricerca per nome del comune e centra la mappa sul centroide complessivo.

### Monografie Punti Fiduciali
Il bottone "Monografia" del popup dei punti fiduciali non punta direttamente al PDF dell'Agenzia delle Entrate: il portale AdE genera la `key` di download dinamicamente per ogni sessione, quindi gli URL salvati nel GeoJSON di partenza sono già scaduti. Il bottone passa quindi per l'endpoint serverless `/api/monografia`, che fa scraping di `risultato.php` (pubblico, GET, senza cookies), estrae la key fresca e redireziona via HTTP 302 al PDF corretto. Tempo tipico: 0.5–1 s.

### Interrogazione interattiva
Tieni premuto sulla mappa (o tasto destro su desktop) sopra una particella: l'app interroga il WMS dell'Agenzia delle Entrate e mostra in un banner i dati di **Comune / Foglio / Particella**.

### Import dei rilievi
Carica uno o più file **KML** o **GeoJSON**: vengono aggiunti come livelli indipendenti, attivabili/disattivabili singolarmente. I KML con più cartelle (`<Folder>`) vengono splittati automaticamente in un livello per cartella. Ogni punto del rilievo ha un popup con il link a Google Maps per la navigazione.

Ogni livello con almeno **2 punti** mostra accanto al toggle un pulsante "percorso" (icona `alt_route`): genera un itinerario su **Google Maps** con i punti come waypoint **nell'ordine in cui appaiono nel KML** (perfetto per cartelle tipo *I USCITA / II USCITA* già ottimizzate). Come fermata di partenza viene usata la **posizione GPS corrente** se concessa, altrimenti il primo punto del rilievo. Se le fermate superano il limite di Google Maps (11 totali), il percorso viene **spezzato in più tratte**: ogni tratta riparte dall'ultima fermata della precedente, e un riquadro permette di aprire una tratta per volta in scheda separata.

### Strumenti sul campo
- **Misura distanza**: tocchi successivi sulla mappa creano una polilinea con il totale in metri/km.
- **La mia posizione (GPS)**: centra la mappa sulla posizione corrente con cerchio di accuratezza.
- **Modalità offline**: salva lo stato (KML importati, vista corrente) in `localStorage` e pre-scarica i tasselli di mappa satellitare Google e catastale (particelle, fabbricati, etichette) dell'area dei KML caricati (zoom 17–18) nella Cache API del browser. Quando si è senza rete, il service worker (`sw.js`) intercetta le richieste tile dei provider noti e le serve direttamente dalla cache. Sul campo, senza connessione, basta "Ricarica offline" per ripristinare i KML e la vista.

---

## Architettura

```
index.html                      # Tutta l'app frontend (vanilla JS + Leaflet)
sw.js                           # service worker: serve i tile dalla Cache quando si è offline
api/cerca-particella.js         # serverless: centroide di una particella (PostGIS)
api/cerca-comune.js             # serverless: centroide complessivo di un comune
api/punti-fiduciali.js          # serverless: punti fiduciali per bbox/comune
api/monografia.js               # serverless: risolve l'URL PDF AdE via scraping
api/wms-proxy.js                # serverless: proxy CORS per il WMS catastale
scripts/import-fiduciali.mjs    # importer one-shot del GeoJSON TAF nel DB
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
| WMS Geoportale Regione Lazio (`geoportale.regione.lazio.it`) | Isoipse (curve di livello a 5 m) |
| Google Satellite tiles | Sfondo satellitare principale |
| Bing/Virtual Earth tiles | Sfondo satellitare alternativo |
| Neon Postgres + PostGIS | Ricerca particella, ricerca comune, punti fiduciali |
| Portale Monografie AdE (`www1.agenziaentrate.gov.it/servizi/Monografie/`) | Scraping HTML per risolvere l'URL del PDF della monografia di un PF |

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

DROP TABLE IF EXISTS particelle_catastali;

CREATE TABLE particelle_catastali (
  comune      text,         -- codice Belfiore, es. 'D810'
  foglio      text,
  allegato    text,         -- lettera dell'allegato/sezione (A, B, ...), NULL se assente
  particella  text,
  geometry    geometry(MultiPolygon, 4326)
);

CREATE INDEX ON particelle_catastali USING GIST (geometry);
CREATE INDEX ON particelle_catastali (comune, foglio, particella, allegato);
```

Lo script è idempotente: rilanciarlo blocco intero ricrea la tabella da zero (`DROP` + `CREATE`), cancellando eventuali dati pregressi. Va eseguito **prima** del popolamento (sotto).

### Popolamento del DB dai file GML del Catasto

I dati partono dai file GML INSPIRE dell'Agenzia delle Entrate (`*_ple.gml`, uno per Comune). Per caricarli su Neon si usa `ogr2ogr` (incluso in QGIS) direttamente da PowerShell.

> **Prerequisito**: esegui prima il blocco SQL della sezione *Schema* sopra. Il `DROP TABLE IF EXISTS` rimuove eventuali dati pregressi e ricrea la tabella vuota con le colonne e gli indici corretti — lo script PowerShell qui sotto si limita ad appendere.

> **Nota**: le geometrie vengono **semplificate con tolleranza 1** (≈ 1 grado, di fatto un triangolo per particella). È una scelta deliberata per **risparmiare spazio sul DB** — l'app non disegna più il poligono, le serve solo il centroide per centrare la mappa. Se in futuro serviranno i confini reali, rifare l'import senza l'opzione `-simplify`.

```powershell
$ogr = "C:\Program Files\QGIS 3.44.10\bin\ogr2ogr.exe"
$pg  = "PG:host=ep-old-glade-al3cw8um.c-3.eu-central-1.aws.neon.tech dbname=neondb user=DB_USER password=DB_PASSWORD sslmode=require"
$src = "C:\path\alla\cartella\con\i\file_ple.gml"

$sql = @'
SELECT
  msGeometry,
  ADMINISTRATIVEUNIT AS comune,
  ltrim(substr(NATIONALCADASTRALREFERENCE, instr(NATIONALCADASTRALREFERENCE,'_')+1, 4),'0') AS foglio,
  NULLIF(rtrim(substr(NATIONALCADASTRALREFERENCE,
                      instr(NATIONALCADASTRALREFERENCE,'_')+5,
                      instr(NATIONALCADASTRALREFERENCE,'.') - instr(NATIONALCADASTRALREFERENCE,'_') - 5),
               '0123456789'),'') AS allegato,
  ltrim(LABEL,'0') AS particella
FROM CadastralParcel
'@

Get-ChildItem -Path $src -Filter "*_ple.gml" | ForEach-Object {
    Write-Host "=== $($_.Name) ===" -ForegroundColor Cyan
    & $ogr -f PostgreSQL $pg $_.FullName -dialect SQLITE -sql $sql `
        -nln particelle_catastali -nlt PROMOTE_TO_MULTI -t_srs EPSG:4326 `
        -simplify 1 `
        -append -progress
}
Write-Host "===== FATTO =====" -ForegroundColor Green
```

Cosa fa lo script, in breve:

- itera tutti i `*_ple.gml` nella cartella `$src`;
- usa il dialetto SQLite di OGR per estrarre da `CadastralParcel` il **codice Comune** (`ADMINISTRATIVEUNIT`), il **foglio**, l'eventuale **allegato** (lettera tra le 4 cifre del foglio e il `.`, es. `A` da `0005A0`) e la **particella** parsando il campo `NATIONALCADASTRALREFERENCE`, rimuovendo gli zeri iniziali con `ltrim`;
- riproietta le geometrie a **EPSG:4326** e le promuove a MultiPolygon;
- appende le righe nella tabella `particelle_catastali` (già creata dallo schema SQL).

Da rilanciare quando si aggiunge un Comune nuovo o quando l'Agenzia delle Entrate pubblica un aggiornamento dei GML.

### Tabella e import dei Punti Fiduciali

I Punti Fiduciali (TAF — Trigonometric & Anchor Frame) partono da un GeoJSON fornito a parte (es. `TAF_Punti_Fiduciali.geojson`). Tabella:

```sql
CREATE TABLE IF NOT EXISTS punti_fiduciali (
  codice_pf   text PRIMARY KEY,        -- es. "PF05/0010/A032"
  comune      text NOT NULL,           -- codice Belfiore, es. "A032"
  foglio      text,
  allegato    text,
  particella  text,
  descrizione text,
  namefile    text,                    -- solo il "namefile" dell'URL AdE, es. "A032-0010-05"
  geom        geography(Point, 4326)
);

CREATE INDEX IF NOT EXISTS punti_fiduciali_geom_idx ON punti_fiduciali USING GIST (geom);
CREATE INDEX IF NOT EXISTS punti_fiduciali_comune_idx ON punti_fiduciali (comune);
```

Lo schema viene creato automaticamente dallo script di import. Per popolare:

```powershell
npm install
$env:DATABASE_URL = "postgresql://...la tua connection string Neon..."
node scripts/import-fiduciali.mjs "C:\path\TAF_Punti_Fiduciali.geojson"
```

Lo script tronca la tabella e reinserisce in batch da 500. Salva **solo il `namefile`** (parte variabile dell'URL AdE), non l'URL intero: vedi più sotto perché.

> **Perché non salvare l'URL completo.** Nel GeoJSON ufficiale del TAF il campo `Download` è un URL del tipo `download.php?key=NNN&fs=15&dir=NNN&namefile=…`. La `key` è generata dal portale AdE per ogni sessione di ricerca: il file salvato ha la key valida solo al momento della generazione, dopo poco tempo il server la ignora e serve un PDF di fallback. L'URL viene quindi **ricostruito al volo dal backend** (`/api/monografia`) facendo scraping di `risultato.php`, che è pubblico e accetta `GET` senza cookies.

---

## Deploy

Push sul branch principale: Vercel costruisce e pubblica automaticamente. Niente CI custom, niente Docker. Ricordati di settare `DATABASE_URL` nel pannello Vercel.

---

## Note operative

- Il catasto AdE è lento e rate-limited: usalo con moderazione, evita di richiederlo a ogni movimento della mappa.
- La cache offline è limitata a circa **1200 tasselli** per non saturare lo storage del browser. È sufficiente per qualche kmq a zoom 17–18.
- Le chiavi di `localStorage` (`quotazero_state_v1`) e di Cache API (`quotazero-tiles-v1`) sono versionate: cambia il suffisso se modifichi lo schema dello stato salvato, altrimenti i vecchi dispositivi si rompono.

---

## Licenza

Progetto privato. Tutti i diritti riservati.

I dati catastali e le ortofoto sono forniti da Agenzia delle Entrate, Ministero dell'Ambiente (Geoportale Nazionale), Google e Microsoft, ciascuno con le proprie condizioni d'uso.
