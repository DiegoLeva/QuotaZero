// scripts/import-fiduciali.mjs
//
// Importa i Punti Fiduciali (TAF) dal GeoJSON locale nel DB Neon/PostGIS.
// Lancialo una volta con DATABASE_URL nell'ambiente.
//
// Uso (PowerShell):
//   $env:DATABASE_URL="postgresql://..."; node scripts/import-fiduciali.mjs "C:\path\TAF_Punti_Fiduciali.geojson"
//
// Uso (bash):
//   DATABASE_URL="postgresql://..." node scripts/import-fiduciali.mjs ./TAF_Punti_Fiduciali.geojson

import fs from "node:fs";
import path from "node:path";
import { Pool } from "pg";

const DEFAULT_PATH = "C:/Users/dimitri.petrucci/Downloads/TAF_Punti_Fiduciali.geojson";
const BATCH_SIZE = 500;

const filePath = process.argv[2] || DEFAULT_PATH;
if (!fs.existsSync(filePath)) {
  console.error(`File non trovato: ${filePath}`);
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL non impostata.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

function extractNamefile(downloadUrl) {
  if (!downloadUrl) return null;
  const m = String(downloadUrl).match(/[?&]namefile=([^&]+)/i);
  return m ? decodeURIComponent(m[1]) : null;
}

async function main() {
  console.log(`Lettura ${path.basename(filePath)}...`);
  const raw = fs.readFileSync(filePath, "utf8");
  const gj = JSON.parse(raw);
  const features = Array.isArray(gj.features) ? gj.features : [];
  console.log(`Trovate ${features.length} features.`);

  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS punti_fiduciali (
        codice_pf   text PRIMARY KEY,
        comune      text NOT NULL,
        foglio      text,
        allegato    text,
        particella  text,
        descrizione text,
        namefile    text,
        geom        geography(Point, 4326)
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS punti_fiduciali_geom_idx ON punti_fiduciali USING GIST (geom);`);
    await client.query(`CREATE INDEX IF NOT EXISTS punti_fiduciali_comune_idx ON punti_fiduciali (comune);`);

    await client.query("TRUNCATE punti_fiduciali;");
    console.log("Tabella pronta, inserimento in corso...");

    let inserted = 0;
    for (let i = 0; i < features.length; i += BATCH_SIZE) {
      const batch = features.slice(i, i + BATCH_SIZE);
      const values = [];
      const params = [];
      let p = 1;

      for (const f of batch) {
        const props = f.properties || {};
        const coords = f.geometry && f.geometry.coordinates;
        if (!coords || coords.length < 2) continue;
        const lng = Number(coords[0]);
        const lat = Number(coords[1]);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

        const codice = props["Codice PF"] || props.nome_punto || props.name;
        if (!codice) continue;

        values.push(
          `($${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, ST_SetSRID(ST_MakePoint($${p++}, $${p++}), 4326)::geography)`
        );
        params.push(
          String(codice).trim(),
          String(props.Comune || "").toUpperCase().trim(),
          props.Foglio != null ? String(props.Foglio).trim() : null,
          props.Allegato != null ? String(props.Allegato).trim() : null,
          props.Particella != null ? String(props.Particella).trim() : null,
          props.Descrizione || null,
          extractNamefile(props.Download),
          lng,
          lat
        );
      }

      if (!values.length) continue;
      const sql = `
        INSERT INTO punti_fiduciali (codice_pf, comune, foglio, allegato, particella, descrizione, namefile, geom)
        VALUES ${values.join(", ")}
        ON CONFLICT (codice_pf) DO UPDATE SET
          comune = EXCLUDED.comune,
          foglio = EXCLUDED.foglio,
          allegato = EXCLUDED.allegato,
          particella = EXCLUDED.particella,
          descrizione = EXCLUDED.descrizione,
          namefile = EXCLUDED.namefile,
          geom = EXCLUDED.geom;
      `;
      await client.query(sql, params);
      inserted += batch.length;
      process.stdout.write(`\rInseriti ${inserted}/${features.length}`);
    }

    process.stdout.write("\n");
    const { rows } = await client.query("SELECT COUNT(*)::int AS n FROM punti_fiduciali;");
    console.log(`OK. Righe in tabella: ${rows[0].n}`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
